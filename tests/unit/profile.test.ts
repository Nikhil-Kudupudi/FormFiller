import { describe, expect, it } from 'vitest';
import {
  DECLINE_TO_ANSWER,
  PROFILE_SCHEMA_VERSION,
  emptyProfile,
  profileSchema,
} from '@/core/profile/schema';
import { migrate, stripPrototypePollution } from '@/core/profile/migrate';
import {
  FIELD_KEYS,
  isDemographicKey,
  isFieldKey,
  isRepeatingKey,
} from '@/core/profile/keys';

describe('profile schema', () => {
  it('builds a valid empty profile', () => {
    const p = emptyProfile();
    expect(p.schemaVersion).toBe(PROFILE_SCHEMA_VERSION);
    expect(p.work).toEqual([]);
    expect(p.education).toEqual([]);
  });

  it('defaults every demographic answer to declining', () => {
    const p = emptyProfile();
    expect(p.demographics.enabled).toBe(false);
    expect(p.demographics.gender).toBe(DECLINE_TO_ANSWER);
    expect(p.demographics.race).toBe(DECLINE_TO_ANSWER);
    expect(p.demographics.veteranStatus).toBe(DECLINE_TO_ANSWER);
    expect(p.demographics.disabilityStatus).toBe(DECLINE_TO_ANSWER);
  });

  it('treats a blank string as unset so empty inputs never fill', () => {
    const p = profileSchema.parse({
      schemaVersion: 1,
      updatedAt: 0,
      identity: { firstName: '   ', lastName: 'Doe' },
    });
    expect(p.identity.firstName).toBeUndefined();
    expect(p.identity.lastName).toBe('Doe');
  });

  it('rejects a malformed email but accepts a blank one', () => {
    expect(
      profileSchema.safeParse({
        schemaVersion: 1,
        updatedAt: 0,
        contact: { email: 'not-an-email' },
      }).success,
    ).toBe(false);

    expect(
      profileSchema.safeParse({
        schemaVersion: 1,
        updatedAt: 0,
        contact: { email: '' },
      }).success,
    ).toBe(true);
  });

  it('requires YYYY-MM for dates', () => {
    const mk = (startDate: string) =>
      profileSchema.safeParse({
        schemaVersion: 1,
        updatedAt: 0,
        work: [{ id: 'a', startDate }],
      });

    expect(mk('2024-03').success).toBe(true);
    expect(mk('03/2024').success).toBe(false);
    expect(mk('2024-13').success).toBe(false);
  });

  it('keeps workAuthorized and requiresSponsorship independent', () => {
    // The pair is worded near-identically on real forms but means opposite
    // things. Deriving one from the other is the classic way to submit a
    // self-contradicting application.
    const p = profileSchema.parse({
      schemaVersion: 1,
      updatedAt: 0,
      eligibility: { workAuthorized: true, requiresSponsorship: false },
    });
    expect(p.eligibility.workAuthorized).toBe(true);
    expect(p.eligibility.requiresSponsorship).toBe(false);
  });
});

describe('field keys', () => {
  it('has no duplicates', () => {
    expect(new Set(FIELD_KEYS).size).toBe(FIELD_KEYS.length);
  });

  it('recognises only known keys', () => {
    expect(isFieldKey('identity.firstName')).toBe(true);
    expect(isFieldKey('identity.socialSecurityNumber')).toBe(false);
    expect(isFieldKey('__proto__')).toBe(false);
    expect(isFieldKey(null)).toBe(false);
  });

  it('classifies repeating and demographic keys', () => {
    expect(isRepeatingKey('work.company')).toBe(true);
    expect(isRepeatingKey('education.school')).toBe(true);
    expect(isRepeatingKey('identity.firstName')).toBe(false);
    expect(isDemographicKey('demographics.race')).toBe(true);
    expect(isDemographicKey('contact.email')).toBe(false);
  });

  it('has no key for data we refuse to store', () => {
    // A field we never hold cannot be leaked or mis-filled.
    for (const forbidden of ['ssn', 'socialSecurity', 'password', 'creditCard', 'dateOfBirth']) {
      expect(FIELD_KEYS.some((k) => k.toLowerCase().includes(forbidden.toLowerCase()))).toBe(false);
    }
  });
});

describe('migration', () => {
  it('upgrades an unversioned profile to the current version', () => {
    const out = migrate({ identity: { firstName: 'Ada' } }, 0);
    expect(out.schemaVersion).toBe(PROFILE_SCHEMA_VERSION);
    expect(out.identity).toEqual({ firstName: 'Ada' });
  });

  it('is idempotent', () => {
    const once = migrate({ identity: { firstName: 'Ada' } }, 0);
    const twice = migrate(once, PROFILE_SCHEMA_VERSION);
    expect(twice).toEqual(once);
  });

  it('handles a non-object gracefully', () => {
    expect(migrate(null, 0).schemaVersion).toBe(PROFILE_SCHEMA_VERSION);
    expect(migrate('nonsense', 0).schemaVersion).toBe(PROFILE_SCHEMA_VERSION);
  });

  it('strips prototype-polluting keys from imported data', () => {
    const hostile = JSON.parse('{"identity":{"firstName":"Ada"},"__proto__":{"polluted":true}}');
    const clean = stripPrototypePollution(hostile) as Record<string, unknown>;

    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.keys(clean)).not.toContain('__proto__');
    expect((clean.identity as Record<string, unknown>).firstName).toBe('Ada');
  });

  it('strips nested constructor and prototype keys', () => {
    const hostile = JSON.parse(
      '{"work":[{"id":"a","constructor":{"x":1},"prototype":{"y":2},"company":"Acme"}]}',
    );
    const clean = stripPrototypePollution(hostile) as { work: Record<string, unknown>[] };
    expect(Object.keys(clean.work[0]!)).toEqual(['id', 'company']);
  });

  it('bounds recursion on a deeply nested payload', () => {
    let deep: Record<string, unknown> = { v: 1 };
    for (let i = 0; i < 100; i++) deep = { nested: deep };
    expect(() => stripPrototypePollution(deep)).not.toThrow();
  });
});
