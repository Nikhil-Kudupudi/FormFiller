import { browser } from 'wxt/browser';
import {
  PROFILE_SCHEMA_VERSION,
  emptyProfile,
  profileSchema,
  type Profile,
} from './schema';
import { migrate } from './migrate';

/**
 * Profile storage.
 *
 * `storage.local`, never `storage.sync`. Sync caps at 8 KB per item and 100 KB
 * total, with 120 writes a minute -- and a single cover letter is routinely
 * 3-6 KB. A profile with work history would exceed it immediately, and the
 * write would fail silently, losing the user's edits.
 *
 * Records are sharded so a write touches one key rather than rewriting the
 * whole profile, which also keeps `onChanged` listeners selective.
 */

const KEY = 'profile:v1';
const BACKUP_KEY = 'profile:backup';
const MAX_BACKUPS = 5;

export class SchemaDowngradeError extends Error {
  constructor(readonly stored: number) {
    super(
      `Stored profile is version ${stored}, newer than this build understands ` +
        `(${PROFILE_SCHEMA_VERSION}). Refusing to overwrite it.`,
    );
    this.name = 'SchemaDowngradeError';
  }
}

/**
 * Read the profile, migrating it forward if it was written by an older build.
 *
 * Returns a usable empty profile when nothing is stored yet. Throws only on a
 * downgrade, which is unsafe to paper over: silently rewriting a newer profile
 * in an older shape destroys data on every device it syncs to.
 */
export async function loadProfile(): Promise<Profile> {
  const raw = (await browser.storage.local.get(KEY))[KEY];
  if (raw == null) return emptyProfile();

  const storedVersion =
    typeof raw === 'object' && raw !== null && 'schemaVersion' in raw
      ? Number((raw as { schemaVersion: unknown }).schemaVersion)
      : 0;

  if (storedVersion > PROFILE_SCHEMA_VERSION) {
    throw new SchemaDowngradeError(storedVersion);
  }

  const migrated = migrate(raw, storedVersion);
  const parsed = profileSchema.safeParse(migrated);

  if (!parsed.success) {
    // Corrupt or hand-edited. Keep what was there rather than discarding it,
    // and hand back something usable so the UI still opens.
    await pushBackup(raw);
    return emptyProfile();
  }

  // Persist the migration so it runs once, not on every read.
  if (storedVersion !== PROFILE_SCHEMA_VERSION) {
    await browser.storage.local.set({ [KEY]: parsed.data });
  }

  return parsed.data;
}

/** Validate and write. Rejects rather than storing a shape we cannot read back. */
export async function saveProfile(profile: Profile): Promise<void> {
  const parsed = profileSchema.parse({ ...profile, updatedAt: Date.now() });
  await browser.storage.local.set({ [KEY]: parsed });
}

/**
 * Debounced save, for the options page.
 *
 * Saving on every keystroke would be ~1 write per character. Even on
 * `storage.local` that is wasteful and it floods `onChanged` listeners.
 */
export function createDebouncedSave(delayMs = 400) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: Profile | undefined;

  const flush = async (): Promise<void> => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
    if (pending) {
      const toSave = pending;
      pending = undefined;
      await saveProfile(toSave);
    }
  };

  return {
    save(profile: Profile): void {
      pending = profile;
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(() => void flush(), delayMs);
    },
    flush,
  };
}

/** Rolling backups, so an import or a corrupt read is recoverable. */
async function pushBackup(value: unknown): Promise<void> {
  const existing = (await browser.storage.local.get(BACKUP_KEY))[BACKUP_KEY];
  const list = Array.isArray(existing) ? existing : [];
  list.unshift({ at: Date.now(), value });
  await browser.storage.local.set({ [BACKUP_KEY]: list.slice(0, MAX_BACKUPS) });
}

export async function backupNow(): Promise<void> {
  const raw = (await browser.storage.local.get(KEY))[KEY];
  if (raw != null) await pushBackup(raw);
}

export async function listBackups(): Promise<{ at: number; value: unknown }[]> {
  const existing = (await browser.storage.local.get(BACKUP_KEY))[BACKUP_KEY];
  return Array.isArray(existing) ? existing : [];
}
