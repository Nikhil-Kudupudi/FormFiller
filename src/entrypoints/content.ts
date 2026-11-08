import { defineContentScript } from 'wxt/utils/define-content-script';
import { browser } from 'wxt/browser';
import { ATS_HOSTS, isNeverRunHost } from '@/shared/hosts';
import type {
  Omission,
  Proposal,
  ScanResult,
  SectionStatus,
  ToContent,
} from '@/shared/messaging';
import { collectFields, detectFields, type DetectedField } from '@/core/detect/collect';
import { MAX_ROWS, findAddButton } from '@/core/detect/repeater';
import { FillSession } from '@/core/fill/session';
import { clearMarkers, focusElement, markElement, trackMarkers } from '@/core/fill/highlight';
import { profileSchema, type Profile } from '@/core/profile/schema';
import { resolveValue } from '@/core/profile/resolve';
import { buildSkeleton } from '@/core/ai/skeleton';
import { guardResponse } from '@/core/ai/guard';

/**
 * Page-side agent.
 *
 * Runs in the isolated world. Detects fields, applies fills, and draws the
 * markers. It never holds the API key and never calls a provider: it hands a
 * sanitized field description to the service worker and gets a mapping back.
 */
export default defineContentScript({
  matches: [...ATS_HOSTS],
  runAt: 'document_idle',
  // iCIMS renders its portal inside iframes, and Greenhouse and Workable are
  // commonly embedded as an iframe on the employer's own careers page. Note
  // this matches on the *iframe's* origin, so the inner host must be listed.
  allFrames: true,

  main() {
    if (isNeverRunHost(location.hostname)) return;

    // Guard against a second copy. The manifest registers this script on the
    // ATS hosts, and the service worker also injects it on demand elsewhere;
    // on a page covered by both, two listeners would each hold half the fill
    // state and Undo would restore the wrong half.
    const root = document.documentElement;
    if (root.dataset.fwActive === '1') return;
    root.dataset.fwActive = '1';
    root.dataset.fwInstances = String(Number(root.dataset.fwInstances ?? '0') + 1);

    const session = new FillSession();
    /** What we last drew, so scroll and resize can redraw it. */
    let drawn: { fieldId: string; note: string }[] = [];

    const redraw = () => {
      clearMarkers();
      for (const { fieldId, note } of drawn) {
        const candidate = session.get(fieldId);
        if (candidate?.element.isConnected) markElement(candidate.element, note);
      }
    };

    const stopTracking = trackMarkers(redraw);
    addEventListener('pagehide', stopTracking, { once: true });

    /** Build the panel's view of this page. */
    function scan(profile: Profile, includeDemographics: boolean): ScanResult {
      const candidates = collectFields();
      session.setCandidates(candidates);

      const detected = detectFields(candidates, { includeDemographics });

      const proposals: Proposal[] = [];
      const denied: Omission[] = [];
      const missingValue: Omission[] = [];
      const unmatched: Omission[] = [];

      for (const field of detected) {
        const label = field.candidate.label || '(no label)';

        if (field.status === 'denied') {
          denied.push({ label, reason: field.reason });
          continue;
        }
        if (field.status === 'skipped') {
          // A honeypot is not worth telling the user about; it is noise, and
          // naming it would invite them to override the one check that keeps
          // them from being flagged as a bot.
          if (field.reason !== 'honeypot' && field.reason !== 'not visible') {
            missingValue.push({ label, reason: field.reason });
          }
          continue;
        }
        if (field.status === 'unmatched') {
          unmatched.push({ label, reason: 'not recognised' });
          continue;
        }

        const values = resolveValue(profile, field.key, {
          index: field.rowIndex,
          ...(field.candidate.datePart ? { datePart: field.candidate.datePart } : {}),
        });
        if (values.length === 0 || !values[0]) {
          missingValue.push({
            label,
            reason:
              field.rowIndex > 0
                ? `you have no entry ${field.rowIndex + 1} for this section`
                : 'nothing in your profile for this',
          });
          continue;
        }

        proposals.push({
          fieldId: field.candidate.id,
          key: field.key,
          // Three fields all labelled "Company" are indistinguishable in the
          // panel otherwise, and the user cannot tell whether the right job
          // landed in the right row.
          label: field.rowIndex > 0 ? `${label} (entry ${field.rowIndex + 1})` : label,
          value: values[0],
          confidence: field.match.confidence,
          via: field.match.via,
          // Only high-confidence matches are pre-ticked. Everything else is
          // offered unticked, so an ambiguous guess needs a human to accept it.
          recommended: field.match.confidence === 'high',
        });
      }

      return {
        url: location.href,
        proposals,
        denied,
        missingValue,
        unmatched,
        hasClosedShadowRoot: hasClosedRoot(),
        sections: sectionStatus(detected, profile),
      };
    }

    /**
     * How each repeating section compares to the profile.
     *
     * Reported rather than acted on: adding rows changes the page, and
     * nothing should change before the user has confirmed anything.
     */
    function sectionStatus(detected: DetectedField[], profile: Profile): SectionStatus[] {
      const out: SectionStatus[] = [];

      for (const [section, label, entries] of [
        ['work', 'Work history', profile.work.length],
        ['education', 'Education', profile.education.length],
      ] as const) {
        const fields = detected.filter(
          (f) => f.status === 'matched' && f.key.startsWith(`${section}.`),
        );
        if (fields.length === 0) continue;

        const rows = new Set(
          fields.map((f) => (f.status === 'matched' ? f.rowIndex : 0)),
        ).size;

        if (entries > rows) {
          out.push({
            section,
            label,
            rows,
            entries: Math.min(entries, MAX_ROWS),
            canAdd: findSectionAddButton(fields) !== undefined,
          });
        }
      }

      return out;
    }

    /** The Add control belonging to a section, found from one of its fields. */
    function findSectionAddButton(fields: DetectedField[]): HTMLElement | undefined {
      for (const field of fields) {
        let node: HTMLElement | null = field.candidate.element.parentElement;
        let hops = 0;
        while (node && hops < 8) {
          const button = findAddButton(node);
          if (button) return button;
          node = node.parentElement;
          hops += 1;
        }
      }
      return undefined;
    }

    /**
     * Click the form's own Add control until it has room for every entry.
     *
     * Capped, and each click waits for the row to appear: a form that ignores
     * the click would otherwise be left with dozens of empty rows for the
     * user to delete by hand, which is worse than an unfilled section.
     */
    async function expandRows(section: 'work' | 'education', target: number) {
      const countRows = () => {
        const detected = detectFields(collectFields(), { includeDemographics: true });
        const fields = detected.filter(
          (f) => f.status === 'matched' && f.key.startsWith(`${section}.`),
        );
        return {
          rows: new Set(fields.map((f) => (f.status === 'matched' ? f.rowIndex : 0))).size,
          fields,
        };
      };

      let { rows, fields } = countRows();
      let added = 0;

      while (rows < Math.min(target, MAX_ROWS) && added < MAX_ROWS) {
        const button = findSectionAddButton(fields);
        if (!button) break;

        const before = rows;
        button.click();
        await new Promise((resolve) => setTimeout(resolve, 250));

        ({ rows, fields } = countRows());
        added += 1;

        // The click did nothing. Stop rather than keep poking it.
        if (rows === before) break;
      }

      return { rows, added };
    }

    /** Fill the fields the user ticked, and mark what landed. */
    async function apply(fieldIds: string[], profile: Profile) {
      const filled: { fieldId: string; label: string; value: string }[] = [];
      const failed: { fieldId: string; label: string; reason: string }[] = [];
      drawn = [];

      // Detect once, over every field on the page. Re-running detection per
      // field would hand the row grouping a single element to look at, and
      // every row would come back as the first one -- so each row of a
      // repeating section would receive the same entry.
      const detectedAll = detectFields(session.all(), { includeDemographics: true });
      const byId = new Map(detectedAll.map((f) => [f.candidate.id, f]));

      for (const fieldId of orderForFilling(fieldIds, byId)) {
        const candidate = session.get(fieldId);
        if (!candidate) {
          failed.push({ fieldId, label: '(gone)', reason: 'field is no longer on the page' });
          continue;
        }

        const detected = byId.get(fieldId);
        if (!detected || detected.status !== 'matched') {
          failed.push({
            fieldId,
            label: candidate.label,
            reason: 'no longer recognised',
          });
          continue;
        }

        const values = resolveValue(profile, detected.key, {
          index: detected.rowIndex,
          ...(candidate.datePart ? { datePart: candidate.datePart } : {}),
        });
        const outcome = await session.fill(fieldId, candidate.label || '(no label)', values);

        if (outcome.ok) {
          filled.push({ fieldId, label: outcome.label, value: outcome.value });
          drawn.push({ fieldId, note: outcome.value });
        } else {
          failed.push({
            fieldId,
            label: outcome.label,
            reason: outcome.reason ?? 'could not be filled',
          });
        }
      }

      redraw();
      return { filled, failed, canUndo: session.canUndo() };
    }

    browser.runtime.onMessage.addListener((raw, _sender, sendResponse) => {
      const message = raw as ToContent;

      // Only the top frame answers, so an embedded application iframe does not
      // produce a second competing scan for the same page.
      if (window.top !== window) return false;

      switch (message.type) {
        case 'scan': {
          const parsed = profileSchema.safeParse(JSON.parse(message.profileJson));
          if (!parsed.success) {
            sendResponse({ ok: false, error: 'Your profile could not be read.' });
            return true;
          }
          sendResponse({ ok: true, scan: scan(parsed.data, message.includeDemographics) });
          return true;
        }

        case 'apply': {
          // The profile is requested fresh rather than cached in this script:
          // page context is the wrong place to keep the user's address sitting
          // around between interactions.
          void browser.runtime.sendMessage({ type: 'get-profile' }).then((reply) => {
            const parsed = profileSchema.safeParse(
              JSON.parse((reply as { profileJson: string }).profileJson),
            );
            if (!parsed.success) {
              sendResponse({ ok: false, error: 'Your profile could not be read.' });
              return;
            }
            void apply(message.fieldIds, parsed.data).then((result) =>
              sendResponse({ ok: true, apply: result }),
            );
          });
          return true;
        }

        case 'undo': {
          const restored = session.undo();
          drawn = [];
          clearMarkers();
          sendResponse({ ok: true, undo: { restored } });
          return true;
        }

        case 'highlight': {
          const candidate = session.get(message.fieldId);
          if (candidate?.element.isConnected) {
            focusElement(candidate.element, candidate.label || 'this field');
          }
          sendResponse({ ok: true });
          return true;
        }

        case 'collect-unmatched': {
          // Only unmatched, visible fields go to the model. There is no point
          // paying a provider to re-derive what a regex already settled.
          const detected = detectFields(session.all(), { includeDemographics: false });
          const unmatched = detected
            .filter((f) => f.status === 'unmatched')
            .map((f) => f.candidate);
          sendResponse({ ok: true, skeleton: buildSkeleton(unmatched) });
          return true;
        }

        case 'expand-rows': {
          void expandRows(message.section, message.target).then((result) =>
            sendResponse({ ok: true, expanded: result }),
          );
          return true;
        }

        case 'guard-ai': {
          // The model's answer is re-checked here, in the one context that
          // holds the live elements. A suggestion that would land on a
          // honeypot, a denied field, or something no longer on the page is
          // dropped no matter how confident the model was.
          const guarded = guardResponse(message.raw, {
            sent: message.sent,
            candidates: new Map(session.all().map((c) => [c.id, c])),
            includeDemographics: false,
          });

          void browser.runtime.sendMessage({ type: 'get-profile' }).then((reply) => {
            const parsed = profileSchema.safeParse(
              JSON.parse((reply as { profileJson: string }).profileJson),
            );
            if (!parsed.success) {
              sendResponse({ ok: false, error: 'Your profile could not be read.' });
              return;
            }

            const proposals: Proposal[] = [];
            for (const mapping of guarded.mappings) {
              const candidate = session.get(mapping.fieldId);
              const values = resolveValue(parsed.data, mapping.key);
              if (!candidate || values.length === 0 || !values[0]) continue;

              proposals.push({
                fieldId: mapping.fieldId,
                key: mapping.key,
                label: candidate.label || '(no label)',
                value: values[0],
                confidence: mapping.confidence >= 0.8 ? 'medium' : 'low',
                via: 'ai',
                // An AI suggestion is never pre-ticked. It is the weakest
                // signal we have, so accepting it is always a human decision.
                recommended: false,
              });
            }

            sendResponse({ ok: true, aiProposals: proposals, rejected: guarded.rejected });
          });
          return true;
        }

        default:
          return false;
      }
    });
  },
});

/**
 * Put dependent fields in an order that works.
 *
 * Some fields change what else exists on the page, so filling them late is
 * the same as not filling them at all:
 *
 *   "I currently work here" hides the end-date fields once ticked, so an end
 *   date written first is thrown away along with the inputs holding it.
 *
 *   Workday reformats a phone number on blur according to the device type, so
 *   setting the type afterwards discards the number.
 *
 * Everything else keeps the order the panel listed it in.
 */
function orderForFilling(
  fieldIds: string[],
  byId: Map<string, DetectedField>,
): string[] {
  const weight = (fieldId: string): number => {
    const detected = byId.get(fieldId);
    if (!detected || detected.status !== 'matched') return 1;

    if (detected.key === 'contact.phoneDeviceType') return 0;
    if (detected.key === 'work.isCurrent') return 0;
    if (detected.key === 'work.endDate') return 2;
    return 1;
  };

  return [...fieldIds].sort((a, b) => weight(a) - weight(b));
}

/**
 * Detect a closed shadow root anywhere on the page.
 *
 * Nothing can be read inside one from a content script, so the panel says
 * "part of this form can't be read" rather than reporting zero fields and
 * letting the user think the page simply has none.
 */
function hasClosedRoot(): boolean {
  for (const el of Array.from(document.querySelectorAll('*'))) {
    // An element with no open shadowRoot that nonetheless renders nothing of
    // its own is the observable signature of a closed root.
    if (el.shadowRoot === null && el.tagName.includes('-') && el.childElementCount === 0) {
      return true;
    }
  }
  return false;
}
