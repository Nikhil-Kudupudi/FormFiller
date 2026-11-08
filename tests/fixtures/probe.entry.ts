/**
 * Test harness entry point.
 *
 * Bundled into the fixture directory so the real detection and fill engines
 * can be exercised in a browser without loading the whole extension. The
 * extension's own E2E suite loads the packed build; this is for driving the
 * engine directly and asserting on what it decided.
 */
import { collectFields, detectFields, type DetectedField } from '@/core/detect/collect';
import { buildSkeleton } from '@/core/ai/skeleton';
import type { SkeletonField } from '@/core/ai/types';
import { selectOption, setValue } from '@/core/fill/setValue';
import type { FieldKey } from '@/core/profile/keys';

/** A fixed profile, with sentinel values that are easy to spot in the DOM. */
const PROFILE: Partial<Record<FieldKey, string>> = {
  'identity.firstName': 'Ada',
  'identity.lastName': 'Lovelace',
  'identity.preferredName': 'Ada',
  'contact.email': 'ada@example.com',
  'contact.emailConfirm': 'ada@example.com',
  'contact.phone': '617-555-0101',
  'address.line1': '12 Analytical Way',
  'address.line2': 'Unit 4',
  'address.city': 'Cambridge',
  'address.state': 'Massachusetts',
  'address.postalCode': '02139',
  'address.country': 'United States of America',
  'work.company': 'Analytical Engines Ltd',
  'work.title': 'Principal Engineer',
  'links.linkedin': 'https://linkedin.com/in/ada',
  'eligibility.workAuthorized': 'Yes',
  'eligibility.requiresSponsorship': 'No',
};

export interface FillReport {
  filled: { id: string; key: string; label: string; value: string; confidence: string }[];
  failed: { id: string; key: string; label: string; reason: string }[];
  denied: { id: string; label: string; reason: string }[];
  skipped: { id: string; label: string; reason: string }[];
  unmatched: { id: string; label: string }[];
}

function run(): FillReport {
  const report: FillReport = {
    filled: [], failed: [], denied: [], skipped: [], unmatched: [],
  };

  const detected: DetectedField[] = detectFields(collectFields());

  for (const field of detected) {
    const { candidate } = field;
    const base = { id: candidate.id, label: candidate.label };

    if (field.status === 'denied') {
      report.denied.push({ ...base, reason: field.reason });
      continue;
    }
    if (field.status === 'skipped') {
      report.skipped.push({ ...base, reason: field.reason });
      continue;
    }
    if (field.status === 'unmatched') {
      report.unmatched.push(base);
      continue;
    }

    const value = PROFILE[field.key];
    if (value === undefined) {
      report.skipped.push({ ...base, reason: 'no profile value' });
      continue;
    }

    const el = candidate.element;
    let ok = false;

    if (el instanceof HTMLSelectElement) {
      // Ordered candidates: different forms label the same answer differently.
      ok = selectOption(el, [value, ...alternatives(value)]);
    } else if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      ok = setValue(el, value);
    }

    const entry = { ...base, key: field.key, value };
    if (ok) {
      report.filled.push({ ...entry, confidence: field.match.confidence });
    } else {
      report.failed.push({ ...entry, reason: 'value did not survive read-back' });
    }
  }

  return report;
}

/** Common alternate spellings, standing in for the real normalizer. */
function alternatives(value: string): string[] {
  const map: Record<string, string[]> = {
    'United States of America': ['United States', 'USA', 'US'],
    Massachusetts: ['MA'],
    Yes: ['Y', 'true'],
    No: ['N', 'false'],
  };
  return map[value] ?? [];
}

declare global {
  interface Window {
    __fieldwise: { run: () => FillReport };
    /** Exposes the outgoing AI payload so tests can assert on what leaves. */
    __fwSkeleton: () => SkeletonField[];
  }
}

window.__fieldwise = { run };
window.__fwSkeleton = () => buildSkeleton(collectFields());
