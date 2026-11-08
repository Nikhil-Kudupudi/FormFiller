import type { FieldCandidate } from '@/core/detect/collect';
import { selectOption, setChecked, setValue, type FillableElement } from './setValue';
import { assessVisibility } from '@/core/detect/visibility';
import { writeViaMainWorld } from './bridge';
import { displayedValue, fillCombobox, isCombobox } from './combobox';

/**
 * One scan-and-fill session on a page.
 *
 * Holds the mapping from scan-local ids to live elements, and the snapshot of
 * what every field contained before we touched it. The snapshot is the only
 * reason Undo can work: a programmatic write creates no entry in the browser's
 * native undo stack, so Ctrl+Z will not bring a draft back.
 */

interface Snapshot {
  element: FillableElement | HTMLElement;
  previousValue: string;
  previousChecked?: boolean;
  /** Set for a custom dropdown, which has no `.value` to put back. */
  combobox?: boolean;
}

/** True only for inputs where `checked` is the value that matters. */
function isToggle(el: Element): el is HTMLInputElement {
  return (
    el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')
  );
}

export interface FillOutcome {
  fieldId: string;
  label: string;
  value: string;
  ok: boolean;
  reason?: string;
}

export class FillSession {
  private candidates = new Map<string, FieldCandidate>();
  private snapshots = new Map<string, Snapshot>();
  /** Values we wrote, so a second run can tell our text from the user's. */
  private written = new Map<string, string>();

  setCandidates(candidates: FieldCandidate[]): void {
    this.candidates.clear();
    for (const candidate of candidates) this.candidates.set(candidate.id, candidate);
  }

  get(fieldId: string): FieldCandidate | undefined {
    return this.candidates.get(fieldId);
  }

  all(): FieldCandidate[] {
    return [...this.candidates.values()];
  }

  /**
   * Write one field, trying each candidate value in order.
   *
   * Refuses a field the user has since edited by hand. Without that check a
   * second click of Fill would quietly undo their correction, which is worse
   * than not filling at all.
   */
  async fill(fieldId: string, label: string, candidateValues: string[]): Promise<FillOutcome> {
    const candidate = this.candidates.get(fieldId);
    const base = { fieldId, label, value: candidateValues[0] ?? '' };

    if (!candidate) {
      return { ...base, ok: false, reason: 'field is no longer on the page' };
    }
    if (candidateValues.length === 0) {
      return { ...base, ok: false, reason: 'nothing in your profile for this' };
    }

    // Re-check immediately before writing, not at scan time: CSS applied after
    // our scan could have turned this into a trap.
    const visibility = assessVisibility(candidate.element);
    if (visibility.honeypot) {
      return { ...base, ok: false, reason: 'honeypot' };
    }
    if (!visibility.visible) {
      return { ...base, ok: false, reason: 'no longer visible' };
    }

    const el = candidate.element;

    // A custom dropdown is usually a div with a portalled menu, so it is
    // handled before the plain-element check below -- which would otherwise
    // reject it as unfillable.
    if (isCombobox(el)) {
      if (displayedValue(el) && !this.written.has(fieldId)) {
        return { ...base, ok: false, reason: 'you have chosen here, left alone' };
      }
      this.snapshotCombobox(fieldId, el);

      const result = await fillCombobox(el, candidateValues, {
        typeInto: candidate.isTypeahead,
      });

      if (result.ok && result.chosen !== undefined) {
        this.written.set(fieldId, result.chosen);
        return { fieldId, label, value: result.chosen, ok: true };
      }
      return { ...base, ok: false, reason: result.reason ?? 'could not be chosen' };
    }

    if (
      !(el instanceof HTMLInputElement) &&
      !(el instanceof HTMLTextAreaElement) &&
      !(el instanceof HTMLSelectElement)
    ) {
      return { ...base, ok: false, reason: 'this control needs to be filled by hand' };
    }

    // "Has the user already put something here?" is a different question for
    // a toggle: a checkbox's `value` is "on" whether or not it is ticked, so
    // reading `value` here would make every checkbox look pre-filled and
    // silently skip it.
    if (!isToggle(el)) {
      const current = el.value;
      const ourLastWrite = this.written.get(fieldId);
      if (current.trim() !== '' && current !== ourLastWrite) {
        return { ...base, ok: false, reason: 'you have typed here, left alone' };
      }
    }

    this.snapshot(fieldId, el);

    let wrote: string | undefined;
    let ok = false;

    if (el instanceof HTMLSelectElement) {
      ok = selectOption(el, candidateValues);
      if (ok) wrote = el.value;
    } else if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')) {
      const first = candidateValues[0]?.toLowerCase();
      const want = first === 'yes' || first === 'true' || first === 'y';
      ok = setChecked(el, want);
      if (ok) wrote = el.value;
    } else {
      for (const value of candidateValues) {
        // Try the page's own world first. On a framework-controlled input
        // that is the only write that survives the next render; on a plain
        // one it behaves identically, so there is no reason to branch on
        // what the page is built with.
        const viaPage = await writeViaMainWorld(el, value);
        if (viaPage.ok) {
          ok = true;
          wrote = value;
          break;
        }
        // No helper answered -- this page is outside the MAIN-world script's
        // matches, or it has not loaded. The isolated-world write still works
        // for anything that is not framework-controlled.
        if (setValue(el, value)) {
          ok = true;
          wrote = value;
          break;
        }
      }
    }

    if (ok && wrote !== undefined) {
      this.written.set(fieldId, el.value);
      return { fieldId, label, value: wrote, ok: true };
    }

    return {
      ...base,
      ok: false,
      reason:
        el instanceof HTMLSelectElement
          ? 'no matching option in this dropdown'
          : 'the value did not stick',
    };
  }

  /**
   * Record what a dropdown showed before we touched it.
   *
   * Undo for these is best-effort: a widget's own API is the only reliable way
   * to clear a selection, and there is no standard one. We record what it
   * displayed so the panel can tell the user what to put back by hand.
   */
  private snapshotCombobox(fieldId: string, el: HTMLElement): void {
    if (this.snapshots.has(fieldId)) return;
    this.snapshots.set(fieldId, {
      element: el,
      previousValue: displayedValue(el) ?? '',
      combobox: true,
    });
  }

  private snapshot(fieldId: string, el: FillableElement): void {
    if (this.snapshots.has(fieldId)) return;
    this.snapshots.set(fieldId, {
      element: el,
      previousValue: el.value,
      // Only for inputs whose checked state is meaningful. Recording it for
      // every HTMLInputElement would make a text field look like a checkbox
      // to the undo path, which would then "restore" it without touching its
      // value -- and report success.
      ...(isToggle(el) ? { previousChecked: el.checked } : {}),
    });
  }

  canUndo(): boolean {
    return this.snapshots.size > 0;
  }

  /**
   * Put every touched field back the way it was.
   *
   * Goes through the same write path as a fill, so a framework-controlled
   * input is genuinely restored rather than left showing stale text over
   * reverted state.
   */
  undo(): number {
    let restored = 0;

    for (const [fieldId, snapshot] of this.snapshots) {
      const el = snapshot.element;
      if (!el.isConnected) continue;

      if (snapshot.combobox) {
        // Nothing safe to write back: clearing a custom dropdown means driving
        // its own UI, and getting that wrong leaves a worse state than the one
        // we are trying to undo. Reported rather than guessed at.
        continue;
      }

      if (isToggle(el) && snapshot.previousChecked !== undefined) {
        if (setChecked(el, snapshot.previousChecked)) restored += 1;
      } else if (el instanceof HTMLSelectElement) {
        el.value = snapshot.previousValue;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        restored += 1;
      } else if (
        (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) &&
        setValue(el, snapshot.previousValue, { blur: false })
      ) {
        restored += 1;
      }

      this.written.delete(fieldId);
    }

    this.snapshots.clear();
    return restored;
  }

  reset(): void {
    this.snapshots.clear();
    this.written.clear();
    this.candidates.clear();
  }
}
