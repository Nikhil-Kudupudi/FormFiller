/**
 * Custom dropdowns: the div-and-listbox widgets that every ATS except Lever
 * uses instead of a `<select>`.
 *
 * These are reported as the single field type autofill tools most often get
 * wrong, and the reasons are all timing and identity rather than logic:
 * the menu is usually portalled to `<body>` rather than nested in the field,
 * the widget frequently opens on `mousedown` and closes on the blur a plain
 * `.click()` causes, and an async one shows a "Loading…" row that is a
 * perfectly clickable option.
 *
 * The rule that keeps this honest: a fill only counts if an option was
 * actually chosen. Typing text that merely looks right leaves the widget's
 * hidden companion field empty, and the form submits with no value at all.
 */

/** Text a widget shows when nothing is selected. */
const PLACEHOLDERS = new Set([
  '',
  'select',
  'select...',
  'select…',
  'select one',
  'select an option',
  'choose',
  'choose...',
  'choose an option',
  'please select',
  'search',
  'start typing',
  '-',
  '--',
]);

/** Rows that are status messages, not choices. */
const NOT_AN_OPTION = /^\s*(loading|searching|no results|no options|type to search)/i;

/**
 * Containers that hold already-chosen chips rather than available options.
 *
 * Workday's multiselect renders its selections in a `selectedItemList` that
 * also carries `role="listbox"`, so searching it would "select" whatever the
 * user had already picked.
 */
const CHIP_CONTAINERS = [
  '[data-automation-id="selectedItemList"]',
  '[class*="multiValue" i]',
  '[class*="selectedItem" i]',
  '[class*="chip" i]',
];

const CONTROL_SELECTOR = [
  '[role="combobox"]',
  '[aria-haspopup="listbox"]',
  '.select__control',
  '[class*="select__control"]',
  '.sr-select',
  '.ant-select',
  '.fab-Select__trigger',
  '[class*="Select__trigger"]',
  '.sapMComboBox',
  '.oj-select-single',
  '[data-automation-id*="elect" i]',
].join(', ');

const LISTBOX_SELECTOR = [
  '[role="listbox"]',
  '.select__menu',
  '[class*="select__menu"]',
  '.ant-select-dropdown',
  '.oj-listbox-drop:not([hidden])',
  '[class*="Dropdown"][class*="menu" i]',
].join(', ');

const OPTION_SELECTOR = [
  '[role="option"]',
  '[data-automation-id="promptOption"]',
  '.select__option',
  '[class*="select__option"]',
  '.ant-select-item',
  '.oj-listbox-result-label',
  'li',
].join(', ');

export interface ComboboxResult {
  ok: boolean;
  /** The option text we settled on, for the panel to display. */
  chosen?: string;
  reason?: string;
}

export interface ComboboxTiming {
  /** How long to wait for a menu to appear after each open attempt. */
  openWaitMs?: number;
  /** Total budget for an async list to load and settle. */
  loadTimeoutMs?: number;
  /** How long the option list must stop changing before we trust it. */
  stableForMs?: number;
}

const DEFAULTS: Required<ComboboxTiming> = {
  openWaitMs: 220,
  loadTimeoutMs: 4000,
  stableForMs: 120,
};

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** True when this element is a custom dropdown rather than a plain field. */
export function isCombobox(el: HTMLElement): boolean {
  if (el instanceof HTMLSelectElement) return false;
  if (el.matches(CONTROL_SELECTOR)) return true;
  return el.closest(CONTROL_SELECTOR) !== null;
}

/** The widget root, which is often an ancestor of the focusable input. */
export function controlRoot(el: HTMLElement): HTMLElement {
  const owned = el.closest<HTMLElement>(CONTROL_SELECTOR);
  return owned ?? el;
}

/**
 * The editable input of a widget.
 *
 * On a typeahead the control root often *is* the input, in which case
 * `querySelector('input')` finds nothing -- and the query never gets typed,
 * so the menu never opens and the field is reported unfillable.
 */
function editableInput(root: HTMLElement): HTMLInputElement | undefined {
  if (root instanceof HTMLInputElement) return root;
  const nested = root.querySelector('input');
  return nested instanceof HTMLInputElement ? nested : undefined;
}

/**
 * What the widget currently shows.
 *
 * Returns undefined for a placeholder, so "Select..." is not mistaken for a
 * real selection when we verify the fill afterwards.
 */
export function displayedValue(el: HTMLElement): string | undefined {
  const root = controlRoot(el);

  const input = editableInput(root);
  if (input && input.value.trim()) {
    const text = input.value.trim();
    if (!PLACEHOLDERS.has(text.toLowerCase())) return text;
  }

  const rendered =
    root.querySelector(
      '[class*="single-value" i], [class*="SelectedOption" i], .sr-select__selected, .ant-select-selection-item, [class*="Select__value" i]',
    ) ?? root;

  // Read around the chip tray. A multiselect renders its existing choices
  // inside the control, so including them would report "Rust Already chosen
  // Rust" as the current value.
  const copy = rendered.cloneNode(true) as HTMLElement;
  for (const selector of CHIP_CONTAINERS) {
    copy.querySelectorAll(selector).forEach((n) => n.remove());
  }

  const text = (copy.textContent ?? '').replace(/\s+/g, ' ').trim();
  if (!text || PLACEHOLDERS.has(text.toLowerCase())) return undefined;
  return text;
}

/**
 * Open the menu.
 *
 * Three strategies, because widgets disagree about what opening means:
 * react-select listens for `mousedown` and treats the blur from a plain click
 * as a reason to close again, while some keyboard-first widgets ignore mouse
 * events entirely.
 */
async function open(root: HTMLElement, timing: Required<ComboboxTiming>): Promise<HTMLElement | undefined> {
  const target = editableInput(root) ?? root.querySelector<HTMLElement>('button') ?? root;

  const attempts: (() => void)[] = [
    () => target.click(),
    () => {
      for (const type of ['mousedown', 'mouseup', 'click'] as const) {
        target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }));
      }
    },
    () => {
      target.focus();
      target.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowDown', code: 'ArrowDown', bubbles: true }),
      );
    },
  ];

  for (const attempt of attempts) {
    attempt();
    await sleep(timing.openWaitMs);
    const listbox = findListbox(root);
    if (listbox) return listbox;
  }

  return undefined;
}

/**
 * Find the open menu.
 *
 * Searches the field's own subtree first, then the whole document: menus are
 * routinely portalled to `<body>`, where they are nowhere near the control
 * that owns them.
 */
export function findListbox(root: HTMLElement): HTMLElement | undefined {
  const controls = root.getAttribute('aria-controls') ?? root.querySelector('input')?.getAttribute('aria-controls');
  if (controls) {
    const owned = document.getElementById(controls);
    if (owned && isUsableListbox(owned)) return owned;
  }

  const nested = root.querySelector<HTMLElement>(LISTBOX_SELECTOR);
  if (nested && isUsableListbox(nested)) return nested;

  // Portalled. Take the last one in the document, which is the most recently
  // opened when a page leaves closed menus mounted.
  const candidates = Array.from(document.querySelectorAll<HTMLElement>(LISTBOX_SELECTOR))
    .filter(isUsableListbox);
  return candidates[candidates.length - 1];
}

function isUsableListbox(el: HTMLElement): boolean {
  if (CHIP_CONTAINERS.some((selector) => el.matches(selector) || el.closest(selector))) {
    return false;
  }
  if (el.hasAttribute('hidden') || el.getAttribute('aria-hidden') === 'true') return false;
  const style = getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden') return false;
  return el.getBoundingClientRect().height > 0;
}

/** The choices in a menu, ignoring status rows like "Loading…". */
export function readOptions(listbox: HTMLElement): HTMLElement[] {
  return Array.from(listbox.querySelectorAll<HTMLElement>(OPTION_SELECTOR)).filter((option) => {
    if (option.getAttribute('aria-disabled') === 'true') return false;
    const text = (option.textContent ?? '').trim();
    // A "Loading…" row is clickable and would otherwise be chosen as the
    // user's city.
    return text !== '' && !NOT_AN_OPTION.test(text);
  });
}

/**
 * Wait for the list to finish changing.
 *
 * An async widget may show stale results from the previous keystroke before
 * the current query lands, so we wait for the set of option labels to stop
 * changing rather than for the first non-empty render.
 */
async function waitForStableOptions(
  root: HTMLElement,
  timing: Required<ComboboxTiming>,
): Promise<HTMLElement[]> {
  const deadline = Date.now() + timing.loadTimeoutMs;
  let previous = '';
  let stableSince = 0;

  while (Date.now() < deadline) {
    const listbox = findListbox(root);
    const options = listbox ? readOptions(listbox) : [];
    const signature = options.map((o) => o.textContent?.trim() ?? '').join('\u0000');

    if (options.length > 0 && signature === previous) {
      if (stableSince === 0) stableSince = Date.now();
      if (Date.now() - stableSince >= timing.stableForMs) return options;
    } else {
      stableSince = 0;
      previous = signature;
    }

    await sleep(40);
  }

  const listbox = findListbox(root);
  return listbox ? readOptions(listbox) : [];
}

const normalize = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * Pick the option matching one of our candidate values.
 *
 * Exact match first across all candidates, then an unambiguous prefix. The
 * ambiguity rule matters: "United States" prefix-matches both "United States
 * of America" and "United States Minor Outlying Islands", and silently
 * choosing the first would submit the wrong country.
 */
export function matchOption(
  options: HTMLElement[],
  candidates: string[],
): HTMLElement | undefined {
  const labelled = options.map((el) => ({ el, text: normalize(el.textContent ?? '') }));

  for (const candidate of candidates) {
    const want = normalize(candidate);
    if (!want) continue;
    const exact = labelled.find((o) => o.text === want);
    if (exact) return exact.el;
  }

  for (const candidate of candidates) {
    const want = normalize(candidate);
    if (!want) continue;
    const prefixed = labelled.filter((o) => o.text.startsWith(want));
    if (prefixed.length === 1) return prefixed[0]!.el;
  }

  return undefined;
}

/** Choose an option, using the event sequence widgets actually listen for. */
async function choose(option: HTMLElement): Promise<void> {
  option.scrollIntoView({ block: 'nearest' });
  for (const type of ['mouseover', 'mousedown', 'mouseup', 'click'] as const) {
    option.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }));
  }
  await sleep(120);
}

/** Dismiss an open menu we could not use, so the page is left as we found it. */
async function dismiss(root: HTMLElement): Promise<void> {
  root.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  await sleep(60);
}

/**
 * Fill a custom dropdown.
 *
 * `typeInto` is for async widgets -- school, employer, location -- which only
 * query once something is typed. The text is a query, never the answer: the
 * fill still only succeeds if an option gets chosen, because the value the
 * form submits lives in a hidden companion field that typing does not touch.
 */
export async function fillCombobox(
  el: HTMLElement,
  candidates: string[],
  options: { typeInto?: boolean; timing?: ComboboxTiming } = {},
): Promise<ComboboxResult> {
  const timing = { ...DEFAULTS, ...options.timing };
  const root = controlRoot(el);

  if (candidates.length === 0) return { ok: false, reason: 'nothing to choose' };

  let listbox = await open(root, timing);

  if (options.typeInto) {
    const input = editableInput(root);
    if (input) {
      const query = candidates[0] ?? '';
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      (input as unknown as { _valueTracker?: { setValue(v: string): void } })._valueTracker?.setValue('');
      if (setter) setter.call(input, query);
      else input.value = query;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      // Some widgets only query on a real key event.
      input.dispatchEvent(new KeyboardEvent('keyup', { key: query.slice(-1), bubbles: true }));
    }
  }

  const available = await waitForStableOptions(root, timing);
  if (available.length === 0) {
    await dismiss(root);
    return { ok: false, reason: listbox ? 'no options offered' : 'could not open this dropdown' };
  }

  const match = matchOption(available, candidates);
  if (!match) {
    await dismiss(root);
    return { ok: false, reason: 'no matching option in this dropdown' };
  }

  const chosen = (match.textContent ?? '').replace(/\s+/g, ' ').trim();
  await choose(match);

  // Verify from what the widget now displays, not from the fact we clicked.
  const shown = displayedValue(el);
  if (!shown) {
    return { ok: false, reason: 'the selection did not take' };
  }

  listbox = findListbox(root);
  if (listbox) await dismiss(root);

  return { ok: true, chosen };
}
