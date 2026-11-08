/**
 * Writing a value into a field so that it actually sticks.
 *
 * `el.value = x` is not enough on a framework-controlled input. React records
 * the last value it saw on `el._valueTracker`; assigning `.value` goes through
 * React's own instance accessor, which updates that tracker as a side effect.
 * When the `input` event then fires, React compares the DOM value to the
 * tracker, sees no change, and swallows the event. `onChange` never runs,
 * state never updates, and the next render overwrites what was written.
 *
 * The fix is three parts: reset the tracker, call the *prototype* setter to
 * bypass the instance accessor, then dispatch bubbling events.
 */

export type FillableElement = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

interface TrackedElement {
  _valueTracker?: { setValue(value: string): void };
}

/**
 * The native value setter for this element's own type.
 *
 * Using `HTMLInputElement.prototype` on a textarea silently does nothing --
 * a classic bug, which is why the branch is explicit and tested per type.
 */
function nativeValueSetter(el: FillableElement): ((v: string) => void) | undefined {
  const proto =
    el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : el instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype;

  const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
  const setter = descriptor?.set;
  return setter ? (v: string) => setter.call(el, v) : undefined;
}

export interface SetValueOptions {
  /**
   * Fire a full key sequence per character rather than a single value write.
   * Needed by widgets that build their value from `keydown` alone, and by
   * typeaheads that only query on real keystrokes.
   */
  simulateTyping?: boolean;
  /** Blur afterwards. Many validators only run on blur. */
  blur?: boolean;
}

/**
 * Write `value` into `el` and return whether it survived.
 *
 * The return is a read-back, not an assumption: the caller must be able to
 * report "filled 24 fields" truthfully rather than counting write attempts.
 */
export function setValue(
  el: FillableElement,
  value: string,
  options: SetValueOptions = {},
): boolean {
  const { simulateTyping = false, blur = true } = options;

  el.focus();

  if (simulateTyping) {
    typeCharacters(el, value);
  } else {
    writeValue(el, value);
  }

  if (blur) el.blur();

  // `maxlength` constrains typed input but not a programmatic assignment, so
  // the value sits in the DOM looking fine and is truncated or rejected at
  // submit. Treat over-length as a failure the user needs to hear about.
  const limit = 'maxLength' in el ? el.maxLength : -1;
  if (limit > 0 && value.length > limit) return false;

  // Read back. A controlled input that reverted and a `type=number` that
  // rejected a formatted string both look identical to a successful write
  // until you actually look.
  return el.value === value;
}

function writeValue(el: FillableElement, value: string): void {
  // Reset React's tracker so it cannot swallow the event we are about to fire.
  const tracked = el as unknown as TrackedElement;
  tracked._valueTracker?.setValue('');

  const setter = nativeValueSetter(el);
  if (setter) {
    setter(value);
  } else {
    el.value = value;
  }

  dispatchInput(el);
  dispatchChange(el);
}

function typeCharacters(el: FillableElement, value: string): void {
  writeValue(el, '');
  let soFar = '';
  for (const char of value) {
    soFar += char;
    el.dispatchEvent(new KeyboardEvent('keydown', { key: char, bubbles: true }));
    writeValue(el, soFar);
    el.dispatchEvent(new KeyboardEvent('keyup', { key: char, bubbles: true }));
  }
}

function dispatchInput(el: Element): void {
  el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
}

function dispatchChange(el: Element): void {
  // Angular's ControlValueAccessor listens for `change` on selects, checkboxes
  // and radios; React treats it as part of the same path for text.
  el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
}

/**
 * Set a checkbox or radio.
 *
 * Clicking the associated label first, because React and Vue frequently bind
 * the handler there and ignore a synthetic click on the input itself.
 */
export function setChecked(el: HTMLInputElement, checked: boolean): boolean {
  if (el.checked === checked) return true;

  const label =
    el.closest('label') ??
    (el.id ? el.ownerDocument.querySelector(`label[for="${CSS.escape(el.id)}"]`) : null);

  if (label instanceof HTMLElement) {
    label.click();
    if (el.checked === checked) return true;
  }

  el.click();
  if (el.checked === checked) return true;

  // Last resort: force it through the prototype setter and fire the events
  // ourselves, the same reasoning as for text values.
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'checked');
  descriptor?.set?.call(el, checked);
  dispatchInput(el);
  dispatchChange(el);

  return el.checked === checked;
}

/**
 * Choose an option in a native `<select>`.
 *
 * Only ever selects an option that exists. Writing a value with no matching
 * option leaves the select silently on index 0, which is how a wrong answer
 * gets submitted without anyone noticing.
 */
export function selectOption(el: HTMLSelectElement, candidates: string[]): boolean {
  const options = Array.from(el.options);
  const norm = (s: string) => s.trim().toLowerCase();

  for (const candidate of candidates) {
    const target = norm(candidate);
    if (!target) continue;

    const exact =
      options.find((o) => norm(o.value) === target) ??
      options.find((o) => norm(o.textContent ?? '') === target);
    if (exact) return commitSelection(el, exact);
  }

  // Prefix match, but only when it is unambiguous. "United States" must not
  // resolve to "United States Minor Outlying Islands" just because it is
  // alphabetically first.
  for (const candidate of candidates) {
    const target = norm(candidate);
    if (!target) continue;
    const matches = options.filter((o) => norm(o.textContent ?? '').startsWith(target));
    if (matches.length === 1 && matches[0]) return commitSelection(el, matches[0]);
  }

  return false;
}

function commitSelection(el: HTMLSelectElement, option: HTMLOptionElement): boolean {
  el.value = option.value;
  dispatchInput(el);
  dispatchChange(el);
  return el.value === option.value;
}
