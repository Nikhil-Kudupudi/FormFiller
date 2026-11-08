import { PROFILE_SCHEMA_VERSION } from './schema';

type Migration = (input: Record<string, unknown>) => Record<string, unknown>;

/**
 * Forward migrations, keyed by the version they upgrade *from*.
 *
 * Each runs exactly once and must be idempotent: a half-applied migration
 * followed by a retry has to land in the same place as a clean run.
 *
 * When adding one: bump PROFILE_SCHEMA_VERSION, add the entry here, and freeze
 * a fixture of the old shape under tests/unit/fixtures/profiles/ so the
 * upgrade path from every released version stays covered.
 */
const MIGRATIONS: Record<number, Migration> = {
  // 0 -> 1: anything stored before versioning existed. Treat the fields we
  // recognise as a best-effort salvage and let the schema fill the rest.
  0: (input) => ({ ...input, schemaVersion: 1 }),
};

export function migrate(
  raw: unknown,
  fromVersion: number,
): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null) {
    return { schemaVersion: PROFILE_SCHEMA_VERSION, updatedAt: Date.now() };
  }

  let current = stripPrototypePollution(raw as Record<string, unknown>);
  let version = fromVersion;

  while (version < PROFILE_SCHEMA_VERSION) {
    const step = MIGRATIONS[version];
    if (!step) {
      // No path from here. Don't guess -- hand back something the schema will
      // reject so the caller backs the data up rather than silently losing it.
      return { ...current, schemaVersion: -1 };
    }
    current = step(current);
    version += 1;
  }

  return { ...current, schemaVersion: PROFILE_SCHEMA_VERSION };
}

/**
 * Remove keys that would walk up the prototype chain.
 *
 * Imported profile JSON is untrusted: it may be a file a user was sent. A
 * `__proto__` key in a plain object literal is inert, but `Object.assign`-style
 * merges and some deep-clone helpers will happily apply it.
 */
export function stripPrototypePollution<T>(value: T, depth = 0): T {
  if (depth > 20 || typeof value !== 'object' || value === null) return value;

  if (Array.isArray(value)) {
    return value.map((v) => stripPrototypePollution(v, depth + 1)) as T;
  }

  const out: Record<string, unknown> = Object.create(null);
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
    out[k] = stripPrototypePollution(v, depth + 1);
  }
  // Back to a normal object so structuredClone and JSON round-trips behave.
  return { ...out } as T;
}
