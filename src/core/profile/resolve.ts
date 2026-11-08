import type { FieldKey } from './keys';
import type { Profile } from './schema';
import { candidatesForPart, parseStoredDate, type DatePart } from '@/core/fill/date';

/**
 * Turn a canonical key into the string (or strings) to try writing.
 *
 * Returns an *ordered candidate list* rather than one value, because the same
 * answer is labelled differently on every ATS: a country dropdown may offer
 * "United States of America", "United States", "USA" or "US", and only one of
 * them will match. The fill engine tries them in order and writes the first
 * that corresponds to a real option.
 *
 * An empty array means "we have nothing for this field", which is different
 * from "we have an empty value" and is reported to the user as such.
 */

/** Row index for a repeating key, e.g. the second employer. */
export interface ResolveContext {
  /** 0-based index within a repeating section. */
  index?: number;
  /**
   * Set when the form splits a date across several controls. The key is the
   * same for all of them; this says which piece this one wants.
   */
  datePart?: DatePart;
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** US state names to their postal abbreviations, for selects that use either. */
const STATE_ABBREVIATIONS: Record<string, string> = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA',
  colorado: 'CO', connecticut: 'CT', delaware: 'DE', florida: 'FL', georgia: 'GA',
  hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA',
  kansas: 'KS', kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD',
  massachusetts: 'MA', michigan: 'MI', minnesota: 'MN', mississippi: 'MS',
  missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV',
  'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY',
  'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK',
  oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
  'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT',
  virginia: 'VA', washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI',
  wyoming: 'WY', 'district of columbia': 'DC',
};

/** Alternate spellings for a country, longest-first so exact matches win. */
function countryCandidates(value: string): string[] {
  const normalized = value.trim().toLowerCase();
  if (['united states', 'usa', 'us', 'united states of america'].includes(normalized)) {
    return ['United States of America', 'United States', 'USA', 'US'];
  }
  if (['united kingdom', 'uk', 'great britain', 'gb'].includes(normalized)) {
    return ['United Kingdom', 'United Kingdom of Great Britain and Northern Ireland', 'UK', 'GB'];
  }
  return [value];
}

function stateCandidates(value: string): string[] {
  const abbreviation = STATE_ABBREVIATIONS[value.trim().toLowerCase()];
  return abbreviation ? [value, abbreviation] : [value];
}

/** A boolean answer, in the several ways forms word Yes and No. */
function booleanCandidates(value: boolean): string[] {
  return value ? ['Yes', 'Y', 'true', 'True'] : ['No', 'N', 'false', 'False'];
}

/**
 * Dates as job forms want them.
 *
 * `YYYY-MM` is what an `<input type=month>` needs; the long and short month
 * forms cover split month/year dropdowns and masked text inputs.
 */
function dateCandidates(stored: string | undefined): string[] {
  if (!stored) return [];
  const [year, month] = stored.split('-');
  if (!year || !month) return [stored];

  const monthName = MONTHS[Number(month) - 1];
  // Ordered by how specific each form is, and verified by read-back: a
  // `type=month` takes the first, a `type=date` silently rejects everything
  // until the full ISO form, and a masked text box takes whichever matches
  // its own mask. Offering all of them costs nothing because a rejected
  // value leaves the field empty rather than wrong.
  const out = [stored, `${month}/${year}`];
  if (monthName) out.push(`${monthName} ${year}`, `${monthName.slice(0, 3)} ${year}`);
  out.push(`${stored}-01`, year);
  return out;
}

function nonEmpty(...values: (string | undefined)[]): string[] {
  return values.filter((v): v is string => typeof v === 'string' && v.trim() !== '');
}

/**
 * Resolve a key to candidate values.
 *
 * Repeating keys (`work.*`, `education.*`) read from the row named by
 * `context.index`; an index past the end of the profile yields nothing rather
 * than falling back to row 0, which would silently duplicate one job across
 * every row on the form.
 */
export function resolveValue(
  profile: Profile,
  key: FieldKey,
  context: ResolveContext = {},
): string[] {
  const index = context.index ?? 0;

  // A split date resolves to one piece of itself. Done here rather than at
  // the call site so every date key behaves the same way without each one
  // having to remember.
  if (context.datePart) {
    const whole = resolveValue(profile, key, { index });
    for (const value of whole) {
      const parsed = parseStoredDate(value);
      if (parsed) return candidatesForPart(parsed, context.datePart);
    }
    return [];
  }

  switch (key) {
    case 'identity.firstName':
      return nonEmpty(profile.identity.firstName);
    case 'identity.middleName':
      return nonEmpty(profile.identity.middleName);
    case 'identity.lastName':
      return nonEmpty(profile.identity.lastName);
    case 'identity.preferredName':
      return nonEmpty(profile.identity.preferredName, profile.identity.firstName);
    case 'identity.pronouns':
      return nonEmpty(profile.identity.pronouns);
    case 'identity.fullName': {
      const parts = nonEmpty(
        profile.identity.firstName,
        profile.identity.middleName,
        profile.identity.lastName,
      );
      return parts.length > 0 ? [parts.join(' ')] : [];
    }

    case 'contact.email':
    case 'contact.emailConfirm':
      return nonEmpty(profile.contact.email);
    case 'contact.phone':
      return nonEmpty(profile.contact.phone);
    case 'contact.phoneCountryCode':
      return nonEmpty(profile.contact.phoneCountryCode);
    case 'contact.phoneDeviceType':
      return nonEmpty(profile.contact.phoneDeviceType);

    case 'address.line1':
      return nonEmpty(profile.address.line1);
    case 'address.line2':
      return nonEmpty(profile.address.line2);
    case 'address.city':
      return nonEmpty(profile.address.city);
    case 'address.state':
      return profile.address.state ? stateCandidates(profile.address.state) : [];
    case 'address.postalCode':
      return nonEmpty(profile.address.postalCode);
    case 'address.country':
      return profile.address.country ? countryCandidates(profile.address.country) : [];
    case 'address.full': {
      const parts = nonEmpty(
        profile.address.line1,
        profile.address.line2,
        profile.address.city,
        profile.address.state,
        profile.address.postalCode,
      );
      return parts.length > 0 ? [parts.join(', ')] : [];
    }

    case 'links.linkedin':
      return nonEmpty(profile.links.linkedin);
    case 'links.github':
      return nonEmpty(profile.links.github);
    case 'links.portfolio':
      return nonEmpty(profile.links.portfolio);
    case 'links.website':
      return nonEmpty(profile.links.website);
    case 'links.twitter':
      return nonEmpty(profile.links.twitter);
    case 'links.other':
      return nonEmpty(profile.links.other);

    case 'work.company':
    case 'work.title':
    case 'work.location':
    case 'work.description':
    case 'work.startDate':
    case 'work.endDate':
    case 'work.isCurrent': {
      const entry = profile.work[index];
      if (!entry) return [];
      switch (key) {
        case 'work.company':
          return nonEmpty(entry.company);
        case 'work.title':
          return nonEmpty(entry.title);
        case 'work.location':
          return nonEmpty(entry.location);
        case 'work.description':
          return nonEmpty(entry.description);
        case 'work.startDate':
          return dateCandidates(entry.startDate);
        case 'work.endDate':
          // A current role has no end date; forms want the word, not a blank.
          return entry.isCurrent ? ['Present', 'Current'] : dateCandidates(entry.endDate);
        default:
          return booleanCandidates(entry.isCurrent);
      }
    }

    case 'education.school':
    case 'education.degree':
    case 'education.field':
    case 'education.gpa':
    case 'education.location':
    case 'education.startDate':
    case 'education.endDate': {
      const entry = profile.education[index];
      if (!entry) return [];
      switch (key) {
        case 'education.school':
          return nonEmpty(entry.school);
        case 'education.degree':
          return nonEmpty(entry.degree);
        case 'education.field':
          return nonEmpty(entry.field);
        case 'education.gpa':
          return nonEmpty(entry.gpa);
        case 'education.location':
          return nonEmpty(entry.location);
        case 'education.startDate':
          return dateCandidates(entry.startDate);
        default:
          return dateCandidates(entry.endDate);
      }
    }

    case 'eligibility.workAuthorized':
      return profile.eligibility.workAuthorized === undefined
        ? []
        : booleanCandidates(profile.eligibility.workAuthorized);
    case 'eligibility.requiresSponsorship':
      // Deliberately read from its own flag, never inverted from the one
      // above. The two questions are worded almost identically and mean
      // opposite things; deriving one is how an application contradicts itself.
      return profile.eligibility.requiresSponsorship === undefined
        ? []
        : booleanCandidates(profile.eligibility.requiresSponsorship);
    case 'eligibility.willRelocate':
      return profile.eligibility.willRelocate === undefined
        ? []
        : booleanCandidates(profile.eligibility.willRelocate);
    case 'eligibility.hasDriversLicense':
      return profile.eligibility.hasDriversLicense === undefined
        ? []
        : booleanCandidates(profile.eligibility.hasDriversLicense);

    case 'preferences.desiredSalary':
      return nonEmpty(profile.preferences.desiredSalary);
    case 'preferences.noticePeriod':
      return nonEmpty(profile.preferences.noticePeriod);
    case 'preferences.earliestStartDate':
      return nonEmpty(profile.preferences.earliestStartDate);
    case 'preferences.preferredLocations':
      return profile.preferences.preferredLocations.length > 0
        ? [profile.preferences.preferredLocations.join(', ')]
        : [];
    case 'preferences.howDidYouHear':
      return nonEmpty(profile.preferences.howDidYouHear);

    case 'documents.coverLetter':
      return nonEmpty(profile.documents.coverLetterTemplate);
    case 'documents.resume':
      // Handled by the file-attach path, not by writing a string.
      return [];

    case 'demographics.gender':
    case 'demographics.race':
    case 'demographics.hispanicLatino':
    case 'demographics.veteranStatus':
    case 'demographics.disabilityStatus': {
      // Gated: unless the user explicitly turned these on, we answer nothing.
      if (!profile.demographics.enabled) return [];
      const field = key.slice('demographics.'.length) as keyof typeof profile.demographics;
      const value = profile.demographics[field];
      return typeof value === 'string' ? nonEmpty(value) : [];
    }

    default:
      return [];
  }
}
