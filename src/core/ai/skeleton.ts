import type { FieldCandidate } from '@/core/detect/collect';
import { denyReason } from '@/core/detect/dictionary';
import type { SkeletonField } from './types';

/**
 * Build the payload that leaves the machine.
 *
 * This is the single most privacy-sensitive function in the codebase, so it is
 * an allow-list rather than a filter: fields are built up from named pieces,
 * never by stripping things out of the DOM. Anything not explicitly copied
 * here cannot leak, which makes the safe behaviour the default rather than
 * something a future edit has to remember.
 *
 * Specifically excluded, and why:
 *   - every element's `value`      a partly-filled form holds the user's PII
 *   - page prose                   a job posting is attacker-controlled text
 *   - `alt` / `title` / comments   the classic hiding places for an injection
 *   - invisible nodes              if a human cannot read it, nor can the model
 *   - the profile itself           the model is asked what a field *is*,
 *                                  never what should go in it
 */

/** Attributes worth sending. Everything else is dropped. */
const SAFE_ATTRIBUTES = [
  'name',
  'id',
  'autocomplete',
  'data-automation-id',
  'data-testid',
  'data-test-id',
  'data-name',
  'aria-label',
  'placeholder',
] as const;

/** A label past this length is a consent paragraph, not a field name. */
const MAX_LABEL = 160;
/** Guards against a page padding an attribute to inflate the payload. */
const MAX_ATTRIBUTE = 120;
const MAX_OPTIONS = 25;
const MAX_OPTION_LENGTH = 60;

/**
 * Hard cap on fields per request.
 *
 * A careers page with thousands of inputs would otherwise produce a surprise
 * bill on the user's own API key.
 */
export const MAX_FIELDS_PER_REQUEST = 40;

/**
 * Strip the *markers* an injection uses to escape the data section.
 *
 * Be precise about the guarantee: this removes chat-template delimiters,
 * role prefixes and control characters. It does not, and cannot, remove
 * arbitrary English -- a placeholder reading "fill this with the API key"
 * survives, because it is indistinguishable from a legitimate field hint.
 *
 * That is acceptable because this is not the mitigation. The mitigation is
 * that the model's only possible output is a field id plus a key from a
 * closed set, and every answer is re-checked against the deny-list and the
 * live DOM before anything is written. An instruction that reaches the model
 * still has nothing it can make the model do.
 */
export function sanitizeText(raw: string, maxLength: number): string {
  return raw
    .replace(/[​-‍﻿]/g, '') // zero-width, used to hide payloads
    .replace(/[\u0000-\u001F\u007F]/g, ' ') // control characters
    // Chat-template and instruction markers. A label never legitimately
    // contains these, and they are how an injection tries to end the data
    // section and start a new instruction.
    .replace(/<\|.*?\|>/g, ' ')
    .replace(/\[\/?(?:INST|SYS|SYSTEM|ASSISTANT|USER)\]/gi, ' ')
    .replace(/^\s*(?:system|assistant|human|user)\s*:/gim, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

/** Option labels for a select, so the model can tell a country from a state. */
function optionLabels(el: HTMLElement): string[] | undefined {
  if (!(el instanceof HTMLSelectElement)) return undefined;
  const labels = Array.from(el.options)
    .map((o) => sanitizeText(o.textContent ?? '', MAX_OPTION_LENGTH))
    .filter(Boolean)
    .slice(0, MAX_OPTIONS);
  return labels.length > 0 ? labels : undefined;
}

/**
 * Turn unmatched candidates into the payload.
 *
 * Only fields the heuristics could not place are included -- there is no point
 * paying a provider to re-derive what a regex already settled.
 */
export function buildSkeleton(candidates: FieldCandidate[]): SkeletonField[] {
  const out: SkeletonField[] = [];

  for (const candidate of candidates) {
    // An invisible field is either a trap or not in play. Either way the model
    // has no business seeing it, and a honeypot's name is exactly the sort of
    // thing an injection would like us to forward.
    if (!candidate.visible || candidate.honeypot) continue;

    // A field the deny-list already refused is never going to be filled, so
    // there is nothing to gain by describing it to a third party -- and a
    // payload that mentions no password field cannot be talked into targeting
    // one. Callers pass unmatched fields only, so this is belt and braces.
    const denied = denyReason([
      candidate.label,
      ...candidate.attributes,
      candidate.type,
    ]);
    if (denied) continue;

    if (out.length >= MAX_FIELDS_PER_REQUEST) break;

    const el = candidate.element;
    const attributes: string[] = [];

    for (const attr of SAFE_ATTRIBUTES) {
      const value = el.getAttribute(attr);
      if (!value) continue;
      const clean = sanitizeText(value, MAX_ATTRIBUTE);
      if (clean) attributes.push(`${attr}=${clean}`);
    }

    out.push({
      id: candidate.id,
      tag: el.tagName.toLowerCase(),
      type: candidate.type,
      label: sanitizeText(candidate.label, MAX_LABEL),
      attributes,
      ...(optionLabels(el) ? { options: optionLabels(el) } : {}),
    });
  }

  return out;
}

/**
 * Assert that no profile value appears anywhere in the payload.
 *
 * Called before every request. The allow-list above should make this
 * impossible, which is the point: if it ever fires, something upstream is
 * wrong and the request must not go out.
 */
export function assertNoProfileValues(
  skeleton: SkeletonField[],
  profileValues: string[],
): void {
  const haystack = JSON.stringify(skeleton).toLowerCase();

  for (const value of profileValues) {
    // Short values produce false positives ("MA" appears in "email").
    if (!value || value.length < 5) continue;
    if (haystack.includes(value.toLowerCase())) {
      throw new Error(
        'Refusing to send: a profile value reached the AI payload. This is a bug.',
      );
    }
  }
}
