import { describe, expect, it } from 'vitest';
import { classify, type ClassifyInput } from '@/core/detect/classify';
import { normalizeLabel } from '@/core/detect/label';

function run(input: Partial<ClassifyInput> & { label: string }) {
  return classify({ attributes: [], ...input });
}

/** The key a field resolved to, or null when it was denied or unmatched. */
function keyOf(input: Partial<ClassifyInput> & { label: string }): string | null {
  const r = run(input);
  return r.kind === 'matched' ? r.classification.key : null;
}

describe('label normalisation', () => {
  it('strips required markers, colons and accents', () => {
    expect(normalizeLabel('First Name *')).toBe('first name');
    expect(normalizeLabel('Email (required)')).toBe('email');
    expect(normalizeLabel('Ville :')).toBe('ville');
    expect(normalizeLabel('Prénom')).toBe('prenom');
  });

  it('removes zero-width characters', () => {
    expect(normalizeLabel('Ema​il')).toBe('email');
  });
});

describe('unambiguous fields', () => {
  const cases: [string, string][] = [
    ['First Name', 'identity.firstName'],
    ['Last Name', 'identity.lastName'],
    ['Email Address', 'contact.email'],
    ['Zip Code', 'address.postalCode'],
    ['Address Line 2', 'address.line2'],
    ['LinkedIn Profile', 'links.linkedin'],
    ['Field of Study', 'education.field'],
  ];

  for (const [label, expected] of cases) {
    it(`maps "${label}" to ${expected}`, () => {
      expect(keyOf({ label })).toBe(expected);
    });
  }
});

describe('autocomplete is trusted when present', () => {
  it('wins outright', () => {
    const r = run({ label: 'Vorname', autocomplete: 'given-name' });
    expect(r.kind).toBe('matched');
    if (r.kind === 'matched') {
      expect(r.classification.key).toBe('identity.firstName');
      expect(r.classification.via).toBe('autocomplete');
      expect(r.classification.confidence).toBe('high');
    }
  });

  it('resolves city and state from the non-obvious tokens', () => {
    expect(keyOf({ label: '', autocomplete: 'address-level2' })).toBe('address.city');
    expect(keyOf({ label: '', autocomplete: 'address-level1' })).toBe('address.state');
  });
});

describe('attributes when there is no label', () => {
  it('reads Workday data-automation-id', () => {
    expect(keyOf({ label: '', attributes: ['legalNameSection_firstName'] }))
      .toBe('identity.firstName');
    expect(keyOf({ label: '', attributes: ['addressSection_addressLine1'] }))
      .toBe('address.line1');
  });

  it('reads Rails-style bracketed names from legacy Greenhouse', () => {
    expect(keyOf({ label: '', attributes: ['job_application[email]'] }))
      .toBe('contact.email');
  });
});

describe('ambiguity is demoted, not guessed', () => {
  it('does not confidently map a bare "Name"', () => {
    const r = run({ label: 'Name' });
    // It may resolve to fullName, but never at high confidence, because on a
    // form with a neighbouring "Last Name" this is the first-name field.
    if (r.kind === 'matched') {
      expect(r.classification.confidence).not.toBe('high');
    }
  });

  it('keeps "Company Name" away from the name fields', () => {
    const key = keyOf({ label: 'Company Name' });
    expect(key).toBe('work.company');
  });

  it('does not read "School Name" as a person name', () => {
    expect(keyOf({ label: 'School Name' })).toBe('education.school');
  });

  it('separates country from phone country code', () => {
    expect(keyOf({ label: 'Country' })).toBe('address.country');
    expect(keyOf({ label: 'Country Phone Code' })).toBe('contact.phoneCountryCode');
  });

  it('separates email from confirm email', () => {
    expect(keyOf({ label: 'Email' })).toBe('contact.email');
    expect(keyOf({ label: 'Confirm Email' })).toBe('contact.emailConfirm');
    expect(keyOf({ label: 'Re-enter Email' })).toBe('contact.emailConfirm');
  });

  it('does not treat a salutation dropdown as a job title', () => {
    expect(keyOf({ label: 'Title', attributes: ['salutation'] })).not.toBe('work.title');
  });
});

describe('work authorization and sponsorship are never conflated', () => {
  // These are worded near-identically on real forms and mean opposite things.
  it('maps the authorization question', () => {
    expect(keyOf({ label: 'Are you legally authorized to work in the United States?' }))
      .toBe('eligibility.workAuthorized');
  });

  it('maps the sponsorship question', () => {
    expect(keyOf({ label: 'Will you now or in the future require sponsorship?' }))
      .toBe('eligibility.requiresSponsorship');
  });

  it('never lets the sponsorship wording reach the authorization key', () => {
    const key = keyOf({ label: 'Do you require visa sponsorship to work here?' });
    expect(key).not.toBe('eligibility.workAuthorized');
    expect(key).toBe('eligibility.requiresSponsorship');
  });
});

describe('the deny-list is absolute', () => {
  const denied: [string, string][] = [
    ['Password', 'password'],
    ['Confirm Password', 'password'],
    ['Card Number', 'payment'],
    ['Social Security Number', 'government id'],
    ['Search jobs', 'search'],
    ['Subscribe to our newsletter', 'newsletter'],
    ['Who referred you?', 'referral we cannot invent'],
    ['I agree to the terms and conditions', 'consent'],
    ['I consent to a background check', 'consent'],
    ['Cover Letter', 'free-text essay'],
    ['Enter the captcha', 'captcha'],
  ];

  for (const [label, reason] of denied) {
    it(`refuses "${label}"`, () => {
      const r = run({ label });
      expect(r.kind).toBe('denied');
      if (r.kind === 'denied') expect(r.reason).toBe(reason);
    });
  }

  it('catches a denied field by attribute even when the label is innocent', () => {
    const r = run({ label: 'Enter value', attributes: ['user_password'] });
    expect(r.kind).toBe('denied');
  });
});

describe('unmatched fields are reported, not guessed', () => {
  it('returns unmatched for a question we have no key for', () => {
    expect(run({ label: 'What is your favourite programming language?' }).kind)
      .toBe('unmatched');
  });

  it('returns unmatched for an empty field with no signals', () => {
    expect(run({ label: '' }).kind).toBe('unmatched');
  });
});
