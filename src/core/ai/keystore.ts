import { browser } from 'wxt/browser';
import type { ProviderId } from './types';

/**
 * API key storage.
 *
 * There is no true secret storage in a browser extension, and nothing here
 * pretends otherwise. What this module does is make the honest choices:
 *
 *   - `storage.local`, never `storage.sync`. Syncing would replicate a
 *     billable credential to Google's servers and to every device the user is
 *     signed into, which they did not ask for.
 *   - The key never leaves the service worker. A content script shares a
 *     process with the page; one slip there and the ATS vendor's JavaScript
 *     has the user's credential.
 *   - It is never logged, never placed in a URL, and never echoed in an error.
 *
 * Passphrase mode encrypts the key at rest. That genuinely protects against
 * someone reading the profile directory offline or recovering it from a
 * backup. It does **not** protect against malware running as the user while
 * the extension is unlocked, and the UI says so rather than implying more.
 */

const PLAIN_KEY = 'ai:keys';
const WRAPPED_KEY = 'ai:keys:wrapped';
const SALT_KEY = 'ai:keys:salt';
/** Session-only: cleared when the browser closes, so the user re-unlocks. */
const SESSION_KEY = 'ai:unlocked';

/** OWASP guidance for PBKDF2-SHA256. */
const PBKDF2_ITERATIONS = 600_000;

type KeyMap = Partial<Record<ProviderId, string>>;

export class LockedError extends Error {
  constructor() {
    super('The API key is protected by a passphrase. Unlock it first.');
    this.name = 'LockedError';
  }
}

async function deriveKey(
  passphrase: string,
  salt: Uint8Array<ArrayBuffer>,
): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  );

  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt'],
  );
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
}

export async function isPassphraseProtected(): Promise<boolean> {
  const stored = await browser.storage.local.get(WRAPPED_KEY);
  return stored[WRAPPED_KEY] != null;
}

/** Plain mode: readable by anything that can read the profile directory. */
export async function saveKeysPlain(keys: KeyMap): Promise<void> {
  await browser.storage.local.set({ [PLAIN_KEY]: keys });
  await browser.storage.local.remove([WRAPPED_KEY, SALT_KEY]);
}

/** Turn on passphrase protection, replacing any plaintext copy. */
export async function enablePassphrase(keys: KeyMap, passphrase: string): Promise<void> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt);

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(JSON.stringify(keys)),
  );

  await browser.storage.local.set({
    [WRAPPED_KEY]: { iv: toBase64(iv), data: toBase64(new Uint8Array(ciphertext)) },
    [SALT_KEY]: toBase64(salt),
  });
  // The plaintext copy must go, or the encryption is theatre.
  await browser.storage.local.remove(PLAIN_KEY);
}

/**
 * Unlock for this browser session.
 *
 * The decrypted keys go in `storage.session`, which is memory-only, cleared on
 * browser close, and -- at its default access level -- unreachable from a
 * content script. It also survives service-worker suspension, which a module
 * global would not: MV3 workers are torn down after ~30s idle, and a key
 * cached in a variable would simply vanish mid-session.
 */
export async function unlock(passphrase: string): Promise<boolean> {
  const stored = await browser.storage.local.get([WRAPPED_KEY, SALT_KEY]);
  const wrapped = stored[WRAPPED_KEY] as { iv: string; data: string } | undefined;
  const saltRaw = stored[SALT_KEY] as string | undefined;
  if (!wrapped || !saltRaw) return false;

  try {
    const key = await deriveKey(passphrase, fromBase64(saltRaw));
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64(wrapped.iv) },
      key,
      fromBase64(wrapped.data),
    );
    const keys = JSON.parse(new TextDecoder().decode(plaintext)) as KeyMap;
    await browser.storage.session.set({ [SESSION_KEY]: keys });
    return true;
  } catch {
    // AES-GCM authentication failed: wrong passphrase, or tampered ciphertext.
    // Indistinguishable by design, and nothing is written either way.
    return false;
  }
}

export async function lock(): Promise<void> {
  await browser.storage.session.remove(SESSION_KEY);
}

/**
 * Read the key for one provider.
 *
 * Throws rather than returning undefined when locked, so a caller cannot
 * accidentally send a request with an empty Authorization header and surface
 * a confusing 401 instead of "unlock first".
 */
export async function getKey(provider: ProviderId): Promise<string | undefined> {
  if (await isPassphraseProtected()) {
    const session = await browser.storage.session.get(SESSION_KEY);
    const keys = session[SESSION_KEY] as KeyMap | undefined;
    if (!keys) throw new LockedError();
    return keys[provider];
  }

  const stored = await browser.storage.local.get(PLAIN_KEY);
  return (stored[PLAIN_KEY] as KeyMap | undefined)?.[provider];
}

export async function clearAllKeys(): Promise<void> {
  await browser.storage.local.remove([PLAIN_KEY, WRAPPED_KEY, SALT_KEY]);
  await browser.storage.session.remove(SESSION_KEY);
}

/**
 * Redact anything key-shaped from a string before it is shown or logged.
 *
 * Provider errors sometimes echo the request, and the request carries the key.
 */
export function redact(text: string): string {
  return text
    .replace(/sk-[A-Za-z0-9_-]{10,}/g, 'sk-***')
    .replace(/AIza[A-Za-z0-9_-]{10,}/g, 'AIza***')
    .replace(/xai-[A-Za-z0-9_-]{10,}/g, 'xai-***')
    .replace(/Bearer\s+[A-Za-z0-9._-]{10,}/gi, 'Bearer ***');
}
