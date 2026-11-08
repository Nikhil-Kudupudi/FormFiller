import type { FieldKey } from '@/core/profile/keys';
import { classify, type Classification } from './classify';
import { resolveLabel, type LabelSource, type ResolvedLabel } from './label';
import { assessVisibility } from './visibility';
import { isCombobox } from '@/core/fill/combobox';
import { classifyDatePart, type DatePart } from '@/core/fill/date';
import { groupByContainer, inferIndexFromAttributes } from './repeater';
import { isRepeatingKey } from '@/core/profile/keys';

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
  /**
   * Which part of a date this control holds, when a date is split across
   * several of them. All parts of one date classify to the same profile key,
   * and this says which piece of it to write here.
   */
  datePart?: DatePart;
}

export type DetectedField =
  | { candidate: FieldCandidate; status: 'denied'; reason: string }
  | { candidate: FieldCandidate; status: 'skipped'; reason: string }
  | { candidate: FieldCandidate; status: 'unmatched' }
  | {
      candidate: FieldCandidate;
      status: 'matched';
      key: FieldKey;
      match: Classification;
      /** Which entry of a repeating section this belongs to. 0 when single. */
      rowIndex: number;
    };

/** Words that name a part of a date rather than the date itself. */
const PART_LABEL = /^(month|day|year|mm|dd|yyyy|yy)([^a-z]|$)/i;

/**
 * The label of the date group a control belongs to.
 *
 * Walks up looking for a container holding at least two date parts -- one
 * select alone is a date in its own right, but three together are pieces of
 * one -- then reads that container's heading, skipping any label that merely
 * names a part.
 */
export function dateGroupLabel(el: HTMLElement): ResolvedLabel | undefined {
  let node: HTMLElement | null = el.parentElement;
  let hops = 0;

  while (node && hops < 4) {
    const parts = Array.from(node.querySelectorAll<HTMLElement>('select, input')).filter(
      (candidate) => classifyDatePart(candidate) !== undefined,
    );

    if (parts.length >= 2) {
      for (const heading of Array.from(
        node.querySelectorAll<HTMLElement>('legend, h1, h2, h3, h4, h5, h6, label, [class*="label" i]'),
      )) {
        const text = (heading.textContent ?? '').replace(/\s+/g, ' ').trim();
        if (text && !PART_LABEL.test(text)) {
          return { text, source: 'container-heading' };
        }
      }
      // The row holding the parts often has no name of its own -- the date is
      // named by the fieldset around it -- so keep going rather than give up.
    }

    node = node.parentElement;
    hops += 1;
  }

  return undefined;
}

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
    const datePart = classifyDatePart(node);

    // A split date's parts are labelled "Month", "Day" and "Year", which say
    // nothing about *which* date they belong to. The surrounding group's
    // label -- "Start Date" -- is what the classifier needs, so it is used in
    // their place when one can be found.
    const label = datePart
      ? (dateGroupLabel(node) ?? resolveLabel(node))
      : resolveLabel(node);
    // "Does this already hold something?" is a different question for a
    // toggle: a checkbox's `value` is "on" whether or not it is ticked, so
    // reading `value` here marks every checkbox as pre-filled and the
    // detector skips it before it is ever offered.
    const isToggle =
      node instanceof HTMLInputElement &&
      (node.type === 'checkbox' || node.type === 'radio');

    const value = isToggle
      ? (node as HTMLInputElement).checked
        ? 'on'
        : ''
      : node instanceof HTMLInputElement ||
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
      ...(datePart ? { datePart } : {}),
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

/** Keys whose value is a date. */
function isDateKey(key: FieldKey): boolean {
  return key.endsWith('.startDate') || key.endsWith('.endDate');
}

export function detectFields(
  candidates: FieldCandidate[],
  options: DetectOptions = {},
): DetectedField[] {
  const { overwriteExisting = false, includeDemographics = false } = options;

  const detected = candidates.map((candidate): DetectedField => {
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

    // A control holding a month or a year cannot be a job title, however the
    // surrounding text reads. Without this, a month select under a "Current
    // Role" heading resolves to work.title and writes "March" into it.
    if (candidate.datePart && !isDateKey(classification.key)) {
      return { candidate, status: 'unmatched' };
    }

    return {
      candidate,
      status: 'matched',
      key: classification.key,
      match: classification,
      // Filled in by the pass below, which needs to see every field at once.
      rowIndex: 0,
    };
  });

  return assignRowIndices(detected);
}

/** Identity for a section container, stable within one scan. */
const containerIds = new WeakMap<Element, string>();
let containerCounter = 0;

function containerKey(el: Element | undefined): string {
  if (!el) return 'page';
  let id = containerIds.get(el);
  if (!id) {
    id = `s${containerCounter++}`;
    containerIds.set(el, id);
  }
  return id;
}

/** The block a repeating section lives in, usually a fieldset. */
function sectionContainer(el: HTMLElement): Element | undefined {
  return (
    el.closest('fieldset') ??
    el.closest('section') ??
    el.closest('[class*="section" i]') ??
    undefined
  );
}

/**
 * Work out which entry of a repeating section each field belongs to.
 *
 * Runs after classification because it needs the key: a field is only part of
 * a repeating section if it resolves to one, and the grouping is per section
 * rather than per page.
 *
 * An index written into the markup wins outright. Only when a section carries
 * none does position in the document decide, and then the whole section is
 * grouped together so a row missing one field does not shift the rest.
 */
function assignRowIndices(detected: DetectedField[]): DetectedField[] {
  const sections = new Map<string, DetectedField[]>();

  for (const field of detected) {
    if (field.status !== 'matched' || !isRepeatingKey(field.key)) continue;

    // Scoped to the enclosing section, not to the whole page. A form can
    // carry two work-history blocks -- "Work Experience" and "Previous
    // Roles" -- and numbering them together would give two different fields
    // the same row, so both receive the same job.
    const container = sectionContainer(field.candidate.element);
    const section = `${field.key.split('.')[0] ?? ''}:${containerKey(container)}`;

    const existing = sections.get(section);
    if (existing) existing.push(field);
    else sections.set(section, [field]);
  }

  for (const fields of sections.values()) {
    const inferred = new Map<DetectedField, number>();
    for (const field of fields) {
      const index = inferIndexFromAttributes([
        ...field.candidate.attributes,
        field.candidate.label,
      ]);
      if (index !== undefined) inferred.set(field, index);
    }

    if (inferred.size > 0) {
      // The markup says which row each field is in; trust it, and leave
      // anything it does not name in row 0 rather than inventing a position.
      for (const field of fields) {
        if (field.status === 'matched') field.rowIndex = inferred.get(field) ?? 0;
      }
      continue;
    }

    const byContainer = groupByContainer(fields.map((f) => f.candidate.element));
    for (const field of fields) {
      if (field.status === 'matched') {
        field.rowIndex = byContainer.get(field.candidate.element) ?? 0;
      }
    }
  }

  return detected;
}
