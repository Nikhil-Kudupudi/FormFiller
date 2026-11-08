import { defineBackground } from 'wxt/utils/define-background';
import { browser } from 'wxt/browser';
import { loadProfile } from '@/core/profile/storage';
import { getKey, LockedError, redact } from '@/core/ai/keystore';
import { ADAPTERS } from '@/core/ai';
import { FIELD_KEYS } from '@/core/profile/keys';
import type { AiSettings, ToBackground } from '@/shared/messaging';
import type { SkeletonField } from '@/core/ai/types';

const AI_SETTINGS_KEY = 'ai:settings';

const DEFAULT_AI_SETTINGS: AiSettings = {
  // Off until the user turns it on, and then only for sites they name.
  enabled: false,
  provider: 'gemini',
  model: ADAPTERS.gemini.defaultModel,
  allowedOrigins: [],
};

/**
 * Service worker.
 *
 * Owns the API key and storage, and is the only place a provider request is
 * made. That is not merely tidiness: since Chrome 85 a content script's
 * `fetch` carries the *page's* origin and is subject to CORS even when the
 * extension holds host permissions, so the call could not work from there --
 * and a credential in page context is one bug away from the ATS vendor's JS.
 */
export default defineBackground(() => {
  // Clicking the toolbar icon opens the side panel rather than a popup. A
  // popup closes the moment focus moves to the page, which would make
  // "preview, correct a field, then apply" impossible.
  browser.sidePanel?.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {
    // Firefox has no sidePanel; its sidebar_action opens on its own.
  });

  browser.runtime.onMessage.addListener((raw, _sender, sendResponse) => {
    void handle(raw as ToBackground | { type: 'get-profile' })
      .then(sendResponse)
      .catch((error: unknown) => {
        sendResponse({
          ok: false,
          error: redact(error instanceof Error ? error.message : 'Something went wrong.'),
        });
      });
    return true; // reply asynchronously
  });
});

/**
 * Talk to the content script, injecting it first if it is not there.
 *
 * The manifest only matches the ATS hosts we support out of the box, which
 * keeps the install-time permission prompt narrow -- broad host access on an
 * extension that reads form data is the single biggest cause of store review
 * friction in this category. Everywhere else the user opts in per site, and
 * we inject on demand.
 *
 * `activeTab` covers the common case: the user clicked the toolbar icon to
 * open the panel, which grants access to that tab for the session. If that is
 * not enough we ask for the origin explicitly rather than failing silently.
 */
async function withContentScript<T>(
  tabId: number,
  send: (tabId: number) => Promise<T>,
): Promise<T> {
  try {
    return await send(tabId);
  } catch (error) {
    if (!isNoReceiver(error)) throw error;
  }

  try {
    await browser.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: ['content-scripts/content.js'],
    });
  } catch {
    const tab = await browser.tabs.get(tabId);
    const origin = tab.url ? new URL(tab.url).origin : '';
    throw new Error(
      origin
        ? `fieldwise needs your permission to read ${origin}. Click the toolbar icon on that page and try again.`
        : 'fieldwise cannot read this page.',
    );
  }

  return send(tabId);
}

/** The "no content script on the other end" error, which is worth retrying. */
function isNoReceiver(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes('Receiving end does not exist') ||
    message.includes('Could not establish connection')
  );
}

/**
 * The tab the panel acts on.
 *
 * Deliberately simple. Filtering by URL would need the `tabs` permission,
 * which shows users a "read your browsing history" warning -- too high a price
 * for a check that buys nothing in practice, since a real side panel is not
 * itself a tab and so is never the active one. If the active tab turns out to
 * be unreachable, the send fails and the panel says so.
 */
async function activeTabId(): Promise<number> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error('Open a job application page, then scan again.');
  return tab.id;
}

async function getAiSettings(): Promise<AiSettings> {
  const stored = (await browser.storage.local.get(AI_SETTINGS_KEY))[AI_SETTINGS_KEY];
  return { ...DEFAULT_AI_SETTINGS, ...(stored as Partial<AiSettings> | undefined) };
}

async function handle(message: ToBackground | { type: 'get-profile' }): Promise<unknown> {
  switch (message.type) {
    case 'get-profile': {
      const profile = await loadProfile();
      return { profileJson: JSON.stringify(profile) };
    }

    case 'scan-active-tab': {
      const profile = await loadProfile();
      const tabId = await activeTabId();
      return withContentScript(tabId, (id) =>
        browser.tabs.sendMessage(
          id,
          {
            type: 'scan',
            profileJson: JSON.stringify(profile),
            includeDemographics: profile.demographics.enabled,
          },
          { frameId: 0 },
        ),
      );
    }

    case 'apply':
      return withContentScript(await activeTabId(), (id) =>
        browser.tabs.sendMessage(id, { type: 'apply', fieldIds: message.fieldIds }, { frameId: 0 }),
      );

    case 'undo':
      return withContentScript(await activeTabId(), (id) =>
        browser.tabs.sendMessage(id, { type: 'undo' }, { frameId: 0 }),
      );

    case 'highlight':
      return withContentScript(await activeTabId(), (id) =>
        browser.tabs.sendMessage(id, { type: 'highlight', fieldId: message.fieldId }, { frameId: 0 }),
      );

    case 'get-ai-settings':
      return { ok: true, aiSettings: await getAiSettings() };

    case 'set-ai-site-opt-in': {
      const settings = await getAiSettings();
      const origins = new Set(settings.allowedOrigins);
      if (message.enabled) origins.add(message.origin);
      else origins.delete(message.origin);
      const next = { ...settings, allowedOrigins: [...origins] };
      await browser.storage.local.set({ [AI_SETTINGS_KEY]: next });
      return { ok: true, aiSettings: next };
    }

    case 'run-ai':
      return runAi();

    default:
      return { ok: false, error: 'Unknown request.' };
  }
}

/**
 * Ask the model about the fields the heuristics could not place.
 *
 * The content script builds the payload, because only it can see the DOM. The
 * key never travels in the other direction.
 */
async function runAi(): Promise<unknown> {
  const settings = await getAiSettings();
  if (!settings.enabled) {
    return { ok: false, error: 'The AI fallback is switched off.' };
  }

  const tabId = await activeTabId();
  const tab = await browser.tabs.get(tabId);
  const origin = tab.url ? new URL(tab.url).origin : '';

  // Opt-in is per site, so enabling the feature once does not silently send
  // every later page to a provider.
  if (!settings.allowedOrigins.includes(origin)) {
    return { ok: false, error: `AI is not enabled for ${origin}.` };
  }

  const adapter = ADAPTERS[settings.provider];

  // Firefox lets the user revoke a host permission at any time from
  // about:addons, so this is checked per call rather than assumed at install.
  const granted = await browser.permissions.contains({ origins: [`${adapter.origin}/*`] });
  if (!granted) {
    return { ok: false, error: `Access to ${adapter.label} has not been granted.` };
  }

  let apiKey: string | undefined;
  try {
    apiKey = await getKey(settings.provider);
  } catch (error) {
    if (error instanceof LockedError) {
      return { ok: false, error: 'Unlock your API key in Options first.' };
    }
    throw error;
  }
  if (!apiKey) {
    return { ok: false, error: `No API key saved for ${adapter.label}.` };
  }

  const collected = (await browser.tabs.sendMessage(
    tabId,
    { type: 'collect-unmatched' },
    { frameId: 0 },
  )) as { ok: boolean; skeleton?: SkeletonField[] };

  const skeleton = collected.skeleton ?? [];
  if (skeleton.length === 0) {
    return { ok: true, mappings: [], rejected: [] };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);

  try {
    const result = await adapter.complete(
      { fields: skeleton, allowedKeys: FIELD_KEYS, signal: controller.signal },
      apiKey,
      { model: settings.model },
    );

    if (!result.ok) {
      // redact(): a provider error can echo the request, and the request
      // carries the key in a header.
      return { ok: false, error: redact(result.message) };
    }

    // The guard runs in the content script, which holds the live elements
    // needed to re-check a suggestion against the DOM.
    return browser.tabs.sendMessage(
      tabId,
      { type: 'guard-ai', raw: result.text, sent: skeleton },
      { frameId: 0 },
    );
  } finally {
    clearTimeout(timer);
  }
}
