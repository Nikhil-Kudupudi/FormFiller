import type { FieldKey } from '@/core/profile/keys';
import { DICTIONARY, denyReason, type FieldRule } from './dictionary';
import { normalizeLabel } from './label';

export type Confidence = 'high' | 'medium' | 'low';

export interface Classification {
  key: FieldKey;
  score: number;
  confidence: Confidence;
  /** What produced the match, for the preview UI and for debugging. */
  via: 'autocomplete' | 'attribute' | 'label';
}

export interface ClassifyInput {
  label: string;
  /** `name`, `id`, `data-automation-id`, `data-testid`, `data-name`… */
  attributes: string[];
  autocomplete?: string | undefined;
  /** Input type, used to rule out obviously wrong matches. */
  type?: string | undefined;
}

export type ClassifyResult =
  | { kind: 'denied'; reason: string }
  | { kind: 'unmatched' }
  | { kind: 'matched'; classification: Classification; runnerUp?: Classification };

/** Aliases below this length match too much to be trusted on their own. */
const MIN_ALIAS_LENGTH = 3;

/**
 * Aliases that are genuinely ambiguous even on an exact match.
 *
 * "Name" could be a full name or a first name depending on whether a
 * "Last Name" sits beside it. "Address" could be line 1 or the whole block.
 * "Title" could be a job title or a salutation. Matching one of these caps
 * confidence at medium, so the field is previewed unchecked and the user
 * decides rather than us guessing.
 */
const WEAK_ALIASES = new Set([
  'name', 'address', 'title', 'role', 'position', 'company', 'organization',
  'organisation', 'state', 'country', 'city', 'region', 'location', 'street',
  'degree', 'school', 'grade', 'source', 'from', 'to', 'present',
]);

/**
 * A match must beat the next-best candidate by this much. A near-tie means the
 * label is genuinely ambiguous, and guessing is worse than asking.
 */
const REQUIRED_MARGIN = 0.15;

const HIGH = 0.8;
const MEDIUM = 0.5;

/** Word-boundary match. "name" must not hit inside "company name". */
function containsAlias(haystack: string, alias: string): boolean {
  if (alias.length < MIN_ALIAS_LENGTH) return false;
  const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i').test(haystack);
}

/** Split `data-automation-id` style values into matchable words. */
function tokenize(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2') // camelCase
    .replace(/[_\-.[\]]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function scoreRule(rule: FieldRule, input: ClassifyInput): Classification | undefined {
  const label = normalizeLabel(input.label);
  const attrText = input.attributes.map(tokenize).join(' ');

  // An autocomplete token is near-certain when present, but it is present on
  // well under a fifth of real job forms, so it is a bonus and not a strategy.
  if (input.autocomplete && rule.autocomplete) {
    const tokens = input.autocomplete.toLowerCase().split(/\s+/);
    if (rule.autocomplete.some((t) => tokens.includes(t))) {
      return { key: rule.key, score: 1, confidence: 'high', via: 'autocomplete' };
    }
  }

  const haystack = `${label} ${attrText}`;
  if (rule.negative?.some((n) => containsAlias(haystack, n))) return undefined;

  let best = 0;
  let via: Classification['via'] = 'label';
  let weak = false;

  for (const alias of rule.aliases) {
    if (label && containsAlias(label, alias)) {
      // An exact label match is worth more than a mention inside a longer one.
      const exact = label === alias;
      const ratio = alias.length / Math.max(label.length, 1);
      const s = exact ? 0.95 : 0.6 + 0.3 * Math.min(ratio, 1);
      if (s > best) {
        best = s;
        via = 'label';
        weak = WEAK_ALIASES.has(alias);
      }
    }
    if (attrText && containsAlias(attrText, alias)) {
      const s = attrText === alias ? 0.9 : 0.72;
      if (s > best) {
        best = s;
        via = 'attribute';
        weak = WEAK_ALIASES.has(alias);
      }
    }
  }

  if (best === 0) return undefined;

  // A match earned only through an ambiguous alias never reaches high
  // confidence, so it is previewed unchecked rather than filled silently.
  const ceiling = weak ? Math.min(best, HIGH - 0.01) : best;
  const confidence: Confidence =
    ceiling >= HIGH ? 'high' : ceiling >= MEDIUM ? 'medium' : 'low';
  return { key: rule.key, score: ceiling, confidence, via };
}

/**
 * Classify one field.
 *
 * Returns a key and a confidence, never a bare key. Everything below the
 * threshold is surfaced as "needs you" rather than filled, because a confident
 * wrong answer is worse than a blank.
 */
export function classify(input: ClassifyInput): ClassifyResult {
  // Tokenize attributes before the deny check: `_` is a word character, so
  // \bpassword\b would not fire inside `user_password` otherwise.
  const signals = [
    input.label,
    ...input.attributes,
    ...input.attributes.map(tokenize),
  ].filter(Boolean);

  const denied = denyReason(signals);
  if (denied) return { kind: 'denied', reason: denied };

  const scored = DICTIONARY.map((rule) => scoreRule(rule, input))
    .filter((c): c is Classification => c !== undefined)
    .sort((a, b) => b.score - a.score);

  const top = scored[0];
  if (!top) return { kind: 'unmatched' };

  const runnerUp = scored.find((c) => c.key !== top.key);

  // Near-tie between two different keys: demote rather than guess. This is
  // what stops "Company" resolving confidently to the wrong one of the two
  // companies on a referral form.
  if (runnerUp && top.score - runnerUp.score < REQUIRED_MARGIN) {
    return {
      kind: 'matched',
      classification: { ...top, confidence: 'low' },
      runnerUp,
    };
  }

  return { kind: 'matched', classification: top, runnerUp };
}
