import type { FieldKey } from '@/core/profile/keys';
import { classify, type Classification } from './classify';
import { resolveLabel, type LabelSource } from './label';
import { assessVisibility } from './visibility';
import { isCombobox } from '@/core/fill/combobox';

/**
 * Walk the document and classify every candidate field.
 */

/** Attributes that carry a stable per-ATS key, in order of trust. */
const KEY_ATTRIBUTES = [
  'data-automation-id', // Workday
  'data-testid', // Ashby
  'data-name', // SmartRecruiters
  'data-test-id', // Eightfold
  'name',
  'id',
] as const;

/** Framework-generated ids carry no meaning and actively mislead the matcher. */
const GENERATED_ID = /^(wd-|:r|react-|ember\d|mui-|radix-|headlessui-)/i;

/** Generic automation ids that say nothing about which field this is. */
const GENERIC_KEYS = new Set(['input', 'textinput', 'formfield', 'wrapper', 'field']);

const FIELD_SELECTOR = [
  'input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=reset]):not([type=image])',
  'select',
  'textarea',
  '[role="combobox"]',
].join(', ');

export interface FieldCandidate {
  element: HTMLElement;
  /** Stable within one scan. The AI fallback sees only this, never a selector. */
  id: string;
  label: string;
  labelSource: LabelSource;
  attributes: string[];
  type: string;
  visible: boolean;
  honeypot: boolean;
  /** Already has a value the user or the site put there. */
  prefilled: boolean;
  /** A custom dropdown rather than a plain field or a native select. */
  isCombobox: boolean;
  /**
   * A dropdown that only loads its options once something is typed.
   *
   * Worth knowing separately: these hold the submitted value in a hidden
   * companion field, so typing text that looks right but choosing nothing
   * submits an empty answer.
   */
  isTypeahead: boolean;
}

export type DetectedField =
  | { candidate: FieldCandidate; status: 'denied'; reason: string }
  | { candidate: FieldCandidate; status: 'skipped'; reason: string }
  | { candidate: FieldCandidate; status: 'unmatched' }
  | { candidate: FieldCandidate; status: 'matched'; key: FieldKey; match: Classification };

/** Collect the attribute values worth matching against. */
function keyAttributes(el: HTMLElement): string[] {
  const out: string[] = [];
  for (const attr of KEY_ATTRIBUTES) {
    const value = el.getAttribute(attr);
    if (!value) continue;
    if (attr === 'id' && GENERATED_ID.test(value)) continue;
    if (GENERIC_KEYS.has(value.toLowerCase())) continue;
    out.push(value);
  }
  return out;
}

/**
 * Walk into open shadow roots as well as the light DOM.
 *
 * Closed roots are unreachable by design; the caller reports those rather
 * than silently finding zero fields.
 */
function* deepQuery(root: Document | ShadowRoot | Element, selector: string): Generator<Element> {
  yield* Array.from(root.querySelectorAll(selector));
  for (const el of Array.from(root.querySelectorAll('*'))) {
    if (el.shadowRoot) yield* deepQuery(el.shadowRoot, selector);
  }
}

/**
 * A dropdown that queries as you type.
 *
 * `aria-autocomplete="list"` is the standard signal; the class-name checks
 * cover widgets that implement the behaviour without the attribute.
 */
function looksLikeTypeahead(el: HTMLElement): boolean {
  if (!isCombobox(el)) return false;
  const root = el.closest('[role="combobox"]') ?? el;
  const input = root.querySelector('input') ?? (el instanceof HTMLInputElement ? el : null);
  const autocomplete = input?.getAttribute('aria-autocomplete') ?? el.getAttribute('aria-autocomplete');
  if (autocomplete === 'list' || autocomplete === 'both') return true;
  return /typeahead|autocomplete|async|search/i.test(el.className);
}

/** Fields inside a <template> are a blueprint, never a real field. */
function inTemplate(el: Element): boolean {
  return el.closest('template') !== null;
}

export function collectFields(root: Document | ShadowRoot = document): FieldCandidate[] {
  const out: FieldCandidate[] = [];
  let index = 0;

  for (const node of deepQuery(root, FIELD_SELECTOR)) {
    if (!(node instanceof HTMLElement) || inTemplate(node)) continue;

    const visibility = assessVisibility(node);
    const label = resolveLabel(node);
    const value =
      node instanceof HTMLInputElement ||
      node instanceof HTMLTextAreaElement ||
      node instanceof HTMLSelectElement
        ? node.value
        : '';

    out.push({
      element: node,
      id: `f_${index++}`,
      label: label.text,
      labelSource: label.source,
      attributes: keyAttributes(node),
      type: node.getAttribute('type') ?? node.tagName.toLowerCase(),
      visible: visibility.visible,
      honeypot: visibility.honeypot,
      prefilled: value.trim() !== '',
      isCombobox: isCombobox(node),
      isTypeahead: looksLikeTypeahead(node),
    });
  }

  return out;
}

export interface DetectOptions {
  /**
   * Overwrite fields that already hold a value.
   *
   * Off by default and deliberately so. Sites restore drafts and Workday
   * pre-fills from a parsed resume; overwriting that is unrecoverable.
   */
  overwriteExisting?: boolean;
  /** Fill voluntary self-identification questions. Off unless opted in. */
  includeDemographics?: boolean;
}

export function detectFields(
  candidates: FieldCandidate[],
  options: DetectOptions = {},
): DetectedField[] {
  const { overwriteExisting = false, includeDemographics = false } = options;

  return candidates.map((candidate): DetectedField => {
    // A honeypot is never written to, whatever else we conclude. This is the
    // check that keeps the user from being flagged as a bot.
    if (candidate.honeypot) {
      return { candidate, status: 'skipped', reason: 'honeypot' };
    }
    if (!candidate.visible) {
      return { candidate, status: 'skipped', reason: 'not visible' };
    }
    if (candidate.prefilled && !overwriteExisting) {
      return { candidate, status: 'skipped', reason: 'already filled' };
    }

    const result = classify({
      label: candidate.label,
      attributes: candidate.attributes,
      autocomplete: candidate.element.getAttribute('autocomplete') ?? undefined,
      type: candidate.type,
    });

    if (result.kind === 'denied') {
      return { candidate, status: 'denied', reason: result.reason };
    }
    if (result.kind === 'unmatched') {
      return { candidate, status: 'unmatched' };
    }

    const { classification } = result;

    if (!includeDemographics && classification.key.startsWith('demographics.')) {
      return { candidate, status: 'skipped', reason: 'demographics not enabled' };
    }

    return {
      candidate,
      status: 'matched',
      key: classification.key,
      match: classification,
    };
  });
}
