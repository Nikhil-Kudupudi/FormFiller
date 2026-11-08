import { z } from 'zod';

/**
 * Bump when a stored shape changes incompatibly, and add a migration in
 * `migrate.ts`. A stored profile always carries its version so an older build
 * can refuse to clobber a newer one.
 */
export const PROFILE_SCHEMA_VERSION = 1;

/** Trim, and treat a blank string as "not set" so empty inputs never fill. */
const text = z
  .string()
  .trim()
  .transform((s) => (s === '' ? undefined : s))
  .optional();

/** A month-precision date, as job forms almost always want. `YYYY-MM`. */
const monthDate = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'expected YYYY-MM')
  .optional();

const url = z
  .string()
  .trim()
  .transform((s) => (s === '' ? undefined : s))
  .optional()
  .refine(
    (s) => s === undefined || /^https?:\/\/\S+$/i.test(s),
    'expected an http(s) URL',
  );

export const identitySchema = z.object({
  firstName: text,
  middleName: text,
  lastName: text,
  preferredName: text,
  pronouns: text,
});

export const contactSchema = z.object({
  email: z
    .string()
    .trim()
    .transform((s) => (s === '' ? undefined : s))
    .optional()
    .refine((s) => s === undefined || z.email().safeParse(s).success, 'invalid email'),
  phone: text,
  /** Stored separately because Workday splits these into two controls. */
  phoneCountryCode: text,
  /** Workday asks Mobile / Home / Work, and wants it set before the number. */
  phoneDeviceType: z.enum(['Mobile', 'Home', 'Work']).optional(),
});

export const addressSchema = z.object({
  line1: text,
  line2: text,
  city: text,
  state: text,
  postalCode: text,
  country: text,
});

export const linksSchema = z.object({
  linkedin: url,
  github: url,
  portfolio: url,
  website: url,
  twitter: url,
  other: url,
});

export const workEntrySchema = z.object({
  id: z.string(),
  company: text,
  title: text,
  location: text,
  startDate: monthDate,
  endDate: monthDate,
  isCurrent: z.boolean().default(false),
  description: text,
});

export const educationEntrySchema = z.object({
  id: z.string(),
  school: text,
  degree: text,
  field: text,
  location: text,
  startDate: monthDate,
  endDate: monthDate,
  gpa: text,
});

export const eligibilitySchema = z.object({
  /**
   * Deliberately two independent flags, not one derived from the other.
   * "Are you authorized to work?" and "Will you require sponsorship?" are
   * worded almost identically and mean opposite things; deriving one from
   * the other is how applications end up contradicting themselves.
   */
  workAuthorized: z.boolean().optional(),
  requiresSponsorship: z.boolean().optional(),
  willRelocate: z.boolean().optional(),
  hasDriversLicense: z.boolean().optional(),
});

export const preferencesSchema = z.object({
  desiredSalary: text,
  noticePeriod: text,
  earliestStartDate: text,
  preferredLocations: z.array(z.string().trim().min(1)).default([]),
  howDidYouHear: text,
});

export const documentsSchema = z.object({
  resume: z
    .object({
      filename: z.string(),
      /** Stored base64; a service worker cannot hold a Blob across restarts. */
      data: z.string(),
      mimeType: z.string(),
      updatedAt: z.number(),
    })
    .optional(),
  coverLetterTemplate: text,
});

/** US self-identification options. Defaults to declining, never to an answer. */
const DECLINE = 'Prefer not to answer' as const;

export const demographicsSchema = z.object({
  /** Off unless the user explicitly turns it on. Gates all of the below. */
  enabled: z.boolean().default(false),
  gender: z.string().default(DECLINE),
  race: z.string().default(DECLINE),
  hispanicLatino: z.string().default(DECLINE),
  veteranStatus: z.string().default(DECLINE),
  disabilityStatus: z.string().default(DECLINE),
});

export const profileSchema = z.object({
  schemaVersion: z.literal(PROFILE_SCHEMA_VERSION),
  updatedAt: z.number(),
  identity: identitySchema.default({}),
  contact: contactSchema.default({}),
  address: addressSchema.default({}),
  links: linksSchema.default({}),
  work: z.array(workEntrySchema).default([]),
  education: z.array(educationEntrySchema).default([]),
  eligibility: eligibilitySchema.default({}),
  preferences: preferencesSchema.prefault({}),
  documents: documentsSchema.default({}),
  demographics: demographicsSchema.prefault({}),
});

export type Profile = z.infer<typeof profileSchema>;
export type WorkEntry = z.infer<typeof workEntrySchema>;
export type EducationEntry = z.infer<typeof educationEntrySchema>;

export const DECLINE_TO_ANSWER = DECLINE;

export function emptyProfile(): Profile {
  return profileSchema.parse({
    schemaVersion: PROFILE_SCHEMA_VERSION,
    updatedAt: Date.now(),
  });
}
