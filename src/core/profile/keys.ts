/**
 * Canonical field keys.
 *
 * This list is the contract between three things that must never disagree:
 *   1. the profile schema (what we store),
 *   2. the detection dictionary (what we match a DOM element to),
 *   3. the AI fallback's response schema (what the model is allowed to return).
 *
 * The model picks a key from this closed set and nothing else. It never returns
 * a selector and never returns a value, so a malicious job posting cannot talk
 * the model into routing a write somewhere we did not intend.
 */
export const FIELD_KEYS = [
  // --- identity -----------------------------------------------------------
  'identity.firstName',
  'identity.middleName',
  'identity.lastName',
  'identity.fullName',
  'identity.preferredName',
  'identity.pronouns',

  // --- contact ------------------------------------------------------------
  'contact.email',
  'contact.emailConfirm',
  'contact.phone',
  'contact.phoneCountryCode',
  'contact.phoneDeviceType',

  // --- address ------------------------------------------------------------
  'address.line1',
  'address.line2',
  'address.city',
  'address.state',
  'address.postalCode',
  'address.country',
  'address.full',

  // --- links --------------------------------------------------------------
  'links.linkedin',
  'links.github',
  'links.portfolio',
  'links.website',
  'links.twitter',
  'links.other',

  // --- work history (indexed at match time) -------------------------------
  'work.company',
  'work.title',
  'work.location',
  'work.startDate',
  'work.endDate',
  'work.isCurrent',
  'work.description',

  // --- education ----------------------------------------------------------
  'education.school',
  'education.degree',
  'education.field',
  'education.startDate',
  'education.endDate',
  'education.gpa',
  'education.location',

  // --- eligibility --------------------------------------------------------
  // workAuthorized and requiresSponsorship are deliberately separate keys.
  // Forms word them near-identically but they mean opposite things, and
  // answering both from one flag without inverting is a classic failure.
  'eligibility.workAuthorized',
  'eligibility.requiresSponsorship',
  'eligibility.willRelocate',
  'eligibility.hasDriversLicense',

  // --- preferences --------------------------------------------------------
  'preferences.desiredSalary',
  'preferences.noticePeriod',
  'preferences.earliestStartDate',
  'preferences.preferredLocations',
  'preferences.howDidYouHear',

  // --- documents ----------------------------------------------------------
  'documents.resume',
  'documents.coverLetter',

  // --- demographics -------------------------------------------------------
  // Voluntary self-identification. Never inferred, never filled unless the
  // user explicitly opted in, and defaulted to decline when unset.
  'demographics.gender',
  'demographics.race',
  'demographics.hispanicLatino',
  'demographics.veteranStatus',
  'demographics.disabilityStatus',
] as const;

export type FieldKey = (typeof FIELD_KEYS)[number];

const FIELD_KEY_SET: ReadonlySet<string> = new Set(FIELD_KEYS);

export function isFieldKey(value: unknown): value is FieldKey {
  return typeof value === 'string' && FIELD_KEY_SET.has(value);
}

/**
 * Keys belonging to a repeating section, which are matched per row rather than
 * once per page.
 */
export const REPEATING_PREFIXES = ['work.', 'education.'] as const;

export function isRepeatingKey(key: FieldKey): boolean {
  return REPEATING_PREFIXES.some((p) => key.startsWith(p));
}

/**
 * Keys that are voluntary self-identification.
 *
 * Gated behind their own opt-in, excluded from the AI payload entirely, and
 * defaulted to "prefer not to answer" when the user has set no value.
 */
export const DEMOGRAPHIC_PREFIX = 'demographics.';

export function isDemographicKey(key: FieldKey): boolean {
  return key.startsWith(DEMOGRAPHIC_PREFIX);
}

/**
 * Keys that must never be included in a payload leaving this machine, even as
 * a key name, and never auto-filled without an explicit per-site opt-in.
 */
export const SENSITIVE_KEYS: ReadonlySet<FieldKey> = new Set([
  'demographics.gender',
  'demographics.race',
  'demographics.hispanicLatino',
  'demographics.veteranStatus',
  'demographics.disabilityStatus',
  'preferences.desiredSalary',
]);
