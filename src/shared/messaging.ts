import { browser } from 'wxt/browser';
import type { FieldKey } from '@/core/profile/keys';
import type { Confidence } from '@/core/detect/classify';
import type { ProviderId, SkeletonField } from '@/core/ai/types';

/**
 * The typed message protocol.
 *
 * Three contexts talk to each other: the side panel (what the user sees), the
 * service worker (which owns the API key and storage), and the content script
 * (which owns the DOM). The panel never talks to a page directly, and the
 * content script never holds a credential.
 */

/** One field the panel offers to fill. */
export interface Proposal {
  /** Scan-local id. Stable only until the next scan. */
  fieldId: string;
  key: FieldKey;
  label: string;
  /** What will be written, after candidate resolution. */
  value: string;
  confidence: Confidence;
  /** Where the match came from, shown so a wrong guess is explicable. */
  via: 'autocomplete' | 'attribute' | 'label' | 'ai';
  /** Pre-ticked in the panel. Low-confidence matches are offered unticked. */
  recommended: boolean;
}

/** A field we deliberately did not offer, and why. */
export interface Omission {
  label: string;
  reason: string;
}

/** A repeating section, and how its rows compare to the profile. */
export interface SectionStatus {
  section: 'work' | 'education';
  label: string;
  /** Rows the form currently shows. */
  rows: number;
  /** Entries the profile holds. */
  entries: number;
  /** True when the form has an Add control we could click. */
  canAdd: boolean;
}

export interface ScanResult {
  url: string;
  proposals: Proposal[];
  /** Fields we refused outright. Shown so the user knows we saw them. */
  denied: Omission[];
  /** Recognised but with nothing in the profile to write. */
  missingValue: Omission[];
  /** Not recognised at all. These are what the AI fallback would be given. */
  unmatched: Omission[];
  /** True when something on the page is structurally unreachable. */
  hasClosedShadowRoot: boolean;
  /** Repeating sections that hold fewer rows than the profile has entries. */
  sections: SectionStatus[];
}

export interface ApplyResult {
  /** Verified by reading the value back, not counted from attempts. */
  filled: { fieldId: string; label: string; value: string }[];
  failed: { fieldId: string; label: string; reason: string }[];
  canUndo: boolean;
}

export interface UndoResult {
  restored: number;
}

export interface AiSettings {
  enabled: boolean;
  provider: ProviderId;
  model: string;
  /** Origins the user has opted in for. AI never runs on a site not listed. */
  allowedOrigins: string[];
}

/** Panel or content script -> service worker. */
export type ToBackground =
  | { type: 'scan-active-tab' }
  | { type: 'apply'; fieldIds: string[] }
  | { type: 'undo' }
  | { type: 'highlight'; fieldId: string }
  | { type: 'get-ai-settings' }
  | { type: 'set-ai-site-opt-in'; origin: string; enabled: boolean }
  | { type: 'run-ai'; fieldIds: string[] }
  | { type: 'expand-rows'; section: 'work' | 'education' };

/** Service worker -> content script. */
export type ToContent =
  | { type: 'scan'; profileJson: string; includeDemographics: boolean }
  | { type: 'apply'; fieldIds: string[] }
  | { type: 'undo' }
  | { type: 'highlight'; fieldId: string }
  | { type: 'collect-unmatched' }
  /** The model's raw reply, sent back for guarding against the live DOM. */
  | { type: 'guard-ai'; raw: string; sent: SkeletonField[] }
  /** Click the form's own Add control until it has room for every entry. */
  | { type: 'expand-rows'; section: 'work' | 'education'; target: number };

export type BackgroundReply =
  | { ok: true; scan: ScanResult }
  | { ok: true; apply: ApplyResult }
  | { ok: true; undo: UndoResult }
  | { ok: true; aiSettings: AiSettings }
  | { ok: true }
  | { ok: false; error: string };

export async function sendToBackground(message: ToBackground): Promise<BackgroundReply> {
  try {
    return (await browser.runtime.sendMessage(message)) as BackgroundReply;
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'The extension did not respond.',
    };
  }
}

export async function sendToTab(tabId: number, message: ToContent): Promise<unknown> {
  // frameId 0: the top frame drives, so an embedded Greenhouse iframe does not
  // produce a second, competing scan.
  return browser.tabs.sendMessage(tabId, message, { frameId: 0 });
}
