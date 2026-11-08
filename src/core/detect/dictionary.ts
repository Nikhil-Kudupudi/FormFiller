import type { FieldKey } from '@/core/profile/keys';

export interface FieldRule {
  key: FieldKey;
  /** Matched against the normalised label and against name/id tokens. */
  aliases: string[];
  /** A hit on any of these rules the field out, however well it scored. */
  negative?: string[];
  /** Standard autocomplete tokens. A hit here is near-certain. */
  autocomplete?: string[];
}

/**
 * The matching dictionary.
 *
 * Aliases are matched on word boundaries, never as bare substrings: "name"
 * inside "company name" must not win the first-name field. Aliases shorter
 * than three characters are skipped entirely at match time.
 */
export const DICTIONARY: FieldRule[] = [
  {
    key: 'identity.firstName',
    aliases: ['first name', 'given name', 'forename', 'firstname', 'fname', 'prenom', 'vorname', 'nombre'],
    autocomplete: ['given-name'],
    negative: ['last', 'family', 'company', 'school', 'employer'],
  },
  {
    key: 'identity.lastName',
    aliases: ['last name', 'family name', 'surname', 'lastname', 'lname', 'nom de famille', 'nachname', 'apellidos'],
    autocomplete: ['family-name'],
    negative: ['first', 'given', 'company', 'school'],
  },
  {
    key: 'identity.middleName',
    aliases: ['middle name', 'middle initial', 'additional name', 'middlename'],
    autocomplete: ['additional-name'],
  },
  {
    key: 'identity.fullName',
    aliases: ['full name', 'your name', 'name', 'legal name', 'candidate name', 'applicant name'],
    autocomplete: ['name'],
    // "Name" alone is ambiguous; these neighbours mean it is not a full name.
    negative: ['first', 'last', 'middle', 'company', 'employer', 'school', 'university', 'file', 'user', 'referrer', 'reference'],
  },
  {
    key: 'identity.preferredName',
    aliases: ['preferred name', 'nickname', 'goes by', 'preferred first name'],
    autocomplete: ['nickname'],
  },
  { key: 'identity.pronouns', aliases: ['pronouns', 'preferred pronouns'] },

  {
    key: 'contact.email',
    aliases: ['email', 'e-mail', 'email address', 'courriel', 'correo'],
    autocomplete: ['email'],
    negative: ['confirm', 're-enter', 'reenter', 'verify', 'repeat'],
  },
  {
    key: 'contact.emailConfirm',
    aliases: ['confirm email', 're-enter email', 'reenter email', 'verify email', 'repeat email', 'email confirmation'],
  },
  {
    key: 'contact.phone',
    aliases: ['phone', 'telephone', 'mobile', 'cell', 'cell phone', 'phone number', 'contact number', 'telefon', 'telefono'],
    autocomplete: ['tel', 'tel-national'],
    negative: ['country code', 'extension', 'device type', 'type'],
  },
  {
    key: 'contact.phoneCountryCode',
    aliases: ['country phone code', 'phone country code', 'country code', 'dial code'],
    autocomplete: ['tel-country-code'],
  },
  {
    key: 'contact.phoneDeviceType',
    aliases: ['phone device type', 'device type', 'phone type'],
  },

  {
    key: 'address.line1',
    aliases: ['address line 1', 'address 1', 'street address', 'addressline1', 'street', 'address'],
    autocomplete: ['address-line1', 'street-address'],
    negative: ['line 2', 'line2', 'email', 'ip'],
  },
  {
    key: 'address.line2',
    aliases: ['address line 2', 'address 2', 'addressline2', 'apt', 'apartment', 'suite', 'unit'],
    autocomplete: ['address-line2'],
  },
  {
    key: 'address.city',
    aliases: ['city', 'town', 'city or town', 'locality', 'ville', 'stadt', 'ciudad'],
    autocomplete: ['address-level2'],
  },
  {
    key: 'address.state',
    aliases: ['state', 'province', 'state or province', 'region', 'county', 'state/province', 'country region'],
    autocomplete: ['address-level1'],
    negative: ['united states', 'statement', 'status'],
  },
  {
    key: 'address.postalCode',
    aliases: ['zip', 'zip code', 'postal code', 'postcode', 'post code', 'codigo postal'],
    autocomplete: ['postal-code'],
  },
  {
    key: 'address.country',
    aliases: ['country', 'country of residence', 'nation'],
    autocomplete: ['country', 'country-name'],
    negative: ['code', 'citizenship', 'phone'],
  },

  { key: 'links.linkedin', aliases: ['linkedin', 'linked in', 'linkedin profile', 'linkedin url'] },
  { key: 'links.github', aliases: ['github', 'git hub', 'github profile', 'github url'] },
  { key: 'links.portfolio', aliases: ['portfolio', 'portfolio url', 'personal site'] },
  { key: 'links.website', aliases: ['website', 'web site', 'personal website', 'homepage'] },
  { key: 'links.twitter', aliases: ['twitter', 'x profile', 'twitter handle'] },

  {
    key: 'work.company',
    aliases: ['company', 'employer', 'organization', 'organisation', 'company name', 'current employer', 'most recent employer'],
    autocomplete: ['organization'],
    // Guard against the field meaning the company being applied TO.
    negative: ['applying', 'our company', 'which office', 'hiring'],
  },
  {
    key: 'work.title',
    aliases: ['job title', 'position title', 'your title', 'role', 'position', 'current title', 'occupation'],
    autocomplete: ['organization-title'],
    // "Title" also means Mr/Ms/Dr. Honorific neighbours rule this out.
    negative: ['salutation', 'honorific', 'prefix', 'job posting', 'requisition'],
  },
  { key: 'work.location', aliases: ['work location', 'job location', 'employer location'] },
  { key: 'work.startDate', aliases: ['start date', 'employment start', 'date started'] },
  { key: 'work.endDate', aliases: ['end date', 'employment end', 'date ended'] },
  { key: 'work.isCurrent', aliases: ['currently work here', 'i currently work here', 'current position'] },
  { key: 'work.description', aliases: ['job description', 'responsibilities', 'duties', 'role description'] },

  { key: 'education.school', aliases: ['school', 'university', 'college', 'institution', 'school name', 'educational institution'] },
  { key: 'education.degree', aliases: ['degree', 'degree type', 'qualification', 'level of education'] },
  { key: 'education.field', aliases: ['field of study', 'major', 'discipline', 'concentration', 'course of study'] },
  { key: 'education.gpa', aliases: ['gpa', 'grade point average'] },
  {
    key: 'education.endDate',
    aliases: ['graduation date', 'graduated', 'date of graduation', 'completion date'],
  },
  { key: 'education.startDate', aliases: ['enrollment date', 'date enrolled'] },

  {
    key: 'eligibility.workAuthorized',
    aliases: [
      'legally authorized to work', 'authorized to work', 'work authorization',
      'eligible to work', 'right to work', 'legally eligible',
    ],
    // Must never collide with the sponsorship question, which is the inverse.
    negative: ['sponsorship', 'sponsor', 'visa support'],
  },
  {
    key: 'eligibility.requiresSponsorship',
    aliases: [
      'require sponsorship', 'need sponsorship', 'visa sponsorship',
      'require visa', 'immigration sponsorship', 'now or in the future require',
    ],
  },
  { key: 'eligibility.willRelocate', aliases: ['willing to relocate', 'open to relocation', 'relocate'] },

  { key: 'preferences.desiredSalary', aliases: ['desired salary', 'salary expectation', 'expected salary', 'compensation expectation'] },
  { key: 'preferences.noticePeriod', aliases: ['notice period'] },
  { key: 'preferences.earliestStartDate', aliases: ['earliest start date', 'available start date', 'when can you start', 'availability'] },
  { key: 'preferences.howDidYouHear', aliases: ['how did you hear', 'how did you find', 'referral source'] },

  { key: 'demographics.gender', aliases: ['gender', 'gender identity', 'sex'] },
  { key: 'demographics.race', aliases: ['race', 'ethnicity', 'race/ethnicity', 'racial'] },
  { key: 'demographics.hispanicLatino', aliases: ['hispanic or latino', 'hispanic/latino', 'hispanic'] },
  { key: 'demographics.veteranStatus', aliases: ['veteran status', 'protected veteran', 'military service'] },
  { key: 'demographics.disabilityStatus', aliases: ['disability status', 'disability', 'form cc-305', 'cc-305'] },
];

/**
 * Fields we refuse to touch, checked before the classifier runs.
 *
 * This is a hard deny-list, not a low score. Several of these are legal acts
 * (a consent checkbox), irreversible (a search box that submits on input and
 * navigates away mid-fill), or simply none of our business.
 */
export const DENY_PATTERNS: { pattern: RegExp; reason: string }[] = [
  { pattern: /\b(password|passwd|pwd)\b/i, reason: 'password' },
  { pattern: /(cc-number|card ?number|\bcvv\b|\bcvc\b|security code|expiry|expiration)/i, reason: 'payment' },
  { pattern: /\b(ssn|social security|national id|passport|licence number|license number)\b/i, reason: 'government id' },
  { pattern: /\b(captcha|recaptcha|hcaptcha)\b/i, reason: 'captcha' },
  { pattern: /\b(search|query)\b/i, reason: 'search' },
  { pattern: /\b(newsletter|subscribe|mailing list|marketing)\b/i, reason: 'newsletter' },
  { pattern: /\b(referr(ed|er|al)|who referred)\b/i, reason: 'referral we cannot invent' },
  { pattern: /\b(cover letter|why do you want|tell us about|describe a)\b/i, reason: 'free-text essay' },
  { pattern: /\b(i agree|i certify|i consent|terms and conditions|arbitration|background check|privacy policy)\b/i, reason: 'consent' },
  { pattern: /\b(security question|security answer|maiden name)\b/i, reason: 'security question' },
];

/** Deny-list check against every signal a field exposes. */
export function denyReason(signals: string[]): string | undefined {
  for (const { pattern, reason } of DENY_PATTERNS) {
    if (signals.some((s) => pattern.test(s))) return reason;
  }
  return undefined;
}
