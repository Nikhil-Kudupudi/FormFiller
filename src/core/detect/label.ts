/**
 * Resolve a field's human-readable label.
 *
 * Strategies run in order of trust. Placeholder is last because placeholders
 * routinely hold example values rather than names ("e.g. Jane Doe").
 */

export interface ResolvedLabel {
  text: string;
  source: LabelSource;
}

export type LabelSource =
  | 'label[for]'
  | 'wrapping-label'
  | 'aria-labelledby'
  | 'aria-label'
  | 'definition-list'
  | 'table-cell'
  | 'sibling-text'
  | 'container-heading'
  | 'placeholder'
  | 'title'
  | 'none';

/**
 * A label longer than this is a consent paragraph or a legal disclosure, not
 * a field name. Matching against it produces nonsense.
 */
const MAX_LABEL_LENGTH = 220;

function clean(raw: string | null | undefined): string {
  if (!raw) return '';
  return raw
    .replace(/[\u200B-\u200D\uFEFF]/g, '') // zero-width characters
    .replace(/\s+/g, ' ')
    .trim();
}

/** Text of an element, ignoring nested inputs and visually-hidden helper text. */
function ownText(el: Element): string {
  const clone = el.cloneNode(true) as Element;
  clone.querySelectorAll('input, select, textarea, button, svg').forEach((n) => n.remove());
  return clean(clone.textContent);
}

function viaLabelFor(el: HTMLElement): string {
  const id = el.id;
  if (!id) return '';
  // CSS.escape: ids on React forms contain colons (":r3:").
  const esc = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(id) : id;
  const root = el.getRootNode() as Document | ShadowRoot;
  let found = '';
  try {
    const label = root.querySelector(`label[for="${esc}"]`);
    if (label) found = ownText(label);
  } catch {
    // Malformed id that even CSS.escape cannot save.
  }
  return found;
}

function viaWrappingLabel(el: HTMLElement): string {
  const label = el.closest('label');
  return label ? ownText(label) : '';
}

function viaAriaLabelledBy(el: HTMLElement): string {
  const ids = (el.getAttribute('aria-labelledby') ?? '').split(/\s+/).filter(Boolean);
  if (ids.length === 0) return '';
  const root = el.getRootNode() as Document | ShadowRoot;
  // Concatenated in the order given -- "First" + "name" is one label.
  return clean(
    ids
      .map((id) => {
        // aria-labelledby ids are scoped to the element's own root, so
        // resolve within that root rather than the top-level document.
        const esc = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(id) : id;
        let target: Element | null = null;
        try {
          target = root.querySelector(`#${esc}`);
        } catch {
          target = null;
        }
        return target ? ownText(target) : '';
      })
      .filter(Boolean)
      .join(' '),
  );
}

/** Jobvite and similar use definition lists; the label is a <dt>. */
function viaDefinitionList(el: HTMLElement): string {
  const dd = el.closest('dd');
  if (!dd) return '';
  let prev = dd.previousElementSibling;
  while (prev && prev.tagName !== 'DT') prev = prev.previousElementSibling;
  return prev ? ownText(prev) : '';
}

/** Legacy iCIMS is table-based; the label sits in a sibling or header cell. */
function viaTableCell(el: HTMLElement): string {
  const cell = el.closest('td, th');
  if (!cell) return '';

  // Sibling cell to the left.
  const prevCell = cell.previousElementSibling;
  if (prevCell && ownText(prevCell)) return ownText(prevCell);

  // Column header, for grid layouts like an education table.
  const table = cell.closest('table');
  const row = cell.closest('tr');
  if (table && row) {
    const index = Array.from(row.children).indexOf(cell);
    const header = table.querySelector('thead tr');
    const headerCell = header?.children[index];
    if (headerCell) return ownText(headerCell);
  }
  return '';
}

function viaSiblingText(el: HTMLElement): string {
  // A label rendered as a plain div/span immediately before the input.
  let prev = el.previousElementSibling;
  let hops = 0;
  while (prev && hops < 3) {
    if (!prev.querySelector('input, select, textarea')) {
      const text = ownText(prev);
      if (text) return text;
    }
    prev = prev.previousElementSibling;
    hops += 1;
  }
  return '';
}

function viaContainerHeading(el: HTMLElement): string {
  const container = el.closest(
    '[class*="question"], [class*="field" i], [class*="form-group" i], fieldset',
  );
  if (!container) return '';
  const heading = container.querySelector('label, legend, h1, h2, h3, h4, h5, h6');
  // Only if the heading isn't itself wrapping another input.
  if (heading && !heading.querySelector('input, select, textarea')) {
    return ownText(heading);
  }
  return '';
}

export function resolveLabel(el: HTMLElement): ResolvedLabel {
  const strategies: [LabelSource, () => string][] = [
    ['label[for]', () => viaLabelFor(el)],
    ['wrapping-label', () => viaWrappingLabel(el)],
    ['aria-labelledby', () => viaAriaLabelledBy(el)],
    ['aria-label', () => clean(el.getAttribute('aria-label'))],
    ['definition-list', () => viaDefinitionList(el)],
    ['table-cell', () => viaTableCell(el)],
    ['sibling-text', () => viaSiblingText(el)],
    ['container-heading', () => viaContainerHeading(el)],
    ['placeholder', () => clean(el.getAttribute('placeholder'))],
    ['title', () => clean(el.getAttribute('title'))],
  ];

  for (const [source, run] of strategies) {
    const text = run();
    if (text && text.length <= MAX_LABEL_LENGTH) return { text, source };
  }

  return { text: '', source: 'none' };
}

/**
 * Normalise a label for matching: strip the required marker, parenthetical
 * hints, trailing punctuation and accents, then lowercase.
 */
export function normalizeLabel(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // combining accents
    // Zero-width characters, which some i18n frameworks inject into labels.
    // Stripped here too, not only in the DOM extractor, so this function is
    // safe to call on a raw string from anywhere.
    .replace(/[\u200b-\u200d\ufeff]/g, '')
    .replace(/\(\s*(required|optional)\s*\)/gi, '')
    .replace(/[*\u2217]/g, '')
    .replace(/[:：]\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}
