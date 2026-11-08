/**
 * Repeating sections: employer 1, 2, 3 and the education equivalents.
 *
 * The profile stores these as arrays, but a form renders them as parallel
 * rows, so something has to decide that the second "Company" means the second
 * job rather than the first. Getting it wrong is worse than leaving the
 * fields blank: every row receives the same employer, and the application is
 * submitted with one job repeated three times.
 *
 * Two shapes exist in the wild. Some forms put the index in the field's own
 * name -- `experience[1][company]`, `workExperience-2-jobTitle` -- which is
 * authoritative. Others clone a block of markup with identical names in every
 * copy, where the only evidence is position in the document.
 */

/** A field's position within its repeating section, 0-based. */
export type RowIndex = number;

/**
 * Read a row index out of a field's own attributes.
 *
 * The four patterns below differ in where they start counting, which is the
 * whole reason this is not a single regex: `experience[0]` and `employer 1`
 * refer to the same row.
 */
export function inferIndexFromAttributes(signals: string[]): RowIndex | undefined {
  // Split camelCase and separators before matching, or an anchored keyword
  // never fires inside "workExperience-2-jobTitle".
  const text = signals
    .join(' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_.]+/g, ' ')
    .toLowerCase();

  // Bracketed, and 0-based as written: experience[1][company]
  const bracketed = /\[(\d{1,2})\]/.exec(text);
  if (bracketed?.[1]) return clamp(Number(bracketed[1]));

  // Ordinal phrasing, 1-based: "2nd most recent employer"
  const ordinal = /\b(\d{1,2})(?:st|nd|rd|th)\b/.exec(text);
  if (ordinal?.[1]) return clamp(Number(ordinal[1]) - 1);

  // A number attached to a section word, 1-based:
  // workExperience-2-jobTitle, job 2, employer #3, education_1_school
  const keyed =
    /\b(?:experience|employer|job|position|role|work|education|school|degree|exp|edu)\b[\s_#-]*(\d{1,2})\b/.exec(
      text,
    );
  if (keyed?.[1]) return clamp(Number(keyed[1]) - 1);

  return undefined;
}

/** Negative indices are nonsense; a huge one is a parse accident. */
function clamp(value: number): RowIndex | undefined {
  if (!Number.isInteger(value) || value < 0 || value > 50) return undefined;
  return value;
}

/**
 * Group elements into rows by their position in the document.
 *
 * Used when the markup carries no index. Walks up from each field to the
 * ancestor that is one of several similar siblings -- the repeated block --
 * then numbers those blocks in document order.
 *
 * "Similar" is deliberately loose: a cloned row usually keeps its tag and at
 * least one class, but a form may vary the rest.
 */
export function groupByContainer(elements: HTMLElement[]): Map<HTMLElement, RowIndex> {
  const out = new Map<HTMLElement, RowIndex>();
  if (elements.length < 2) {
    if (elements[0]) out.set(elements[0], 0);
    return out;
  }

  const containers = new Map<HTMLElement, HTMLElement[]>();

  const unplaced: HTMLElement[] = [];

  for (const el of elements) {
    const row = findRowContainer(el);
    if (!row) {
      // Nothing around this field repeats, so it is not part of a repeating
      // block -- which means it is the first and only entry, not an
      // unanswerable question.
      unplaced.push(el);
      continue;
    }
    const existing = containers.get(row);
    if (existing) existing.push(el);
    else containers.set(row, [el]);
  }

  for (const el of unplaced) out.set(el, 0);

  // Document order is the only ordering a form guarantees.
  const ordered = [...containers.keys()].sort((a, b) =>
    a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
  );

  ordered.forEach((row, index) => {
    for (const el of containers.get(row) ?? []) out.set(el, index);
  });

  return out;
}

/**
 * A container's contents, as the fields it holds.
 *
 * Two repeated rows hold the same fields under the same names -- that is what
 * makes them copies. Comparing tags and classes alone is not enough: the
 * columns *inside* one row are also same-tag siblings, so a School column and
 * a Degree column read as two rows and the second field of a row is taken for
 * the second entry.
 */
function fieldSignature(el: Element): string {
  return Array.from(el.querySelectorAll('input, select, textarea'))
    .map((field) => `${field.tagName}:${field.getAttribute('name') ?? ''}`)
    .sort()
    .join('|');
}

/** True when two elements look like copies of the same repeated block. */
function looksLikeSibling(a: Element, b: Element): boolean {
  if (a === b || a.tagName !== b.tagName) return false;

  const signature = fieldSignature(a);
  // A container with no fields in it is not a row of anything.
  if (signature === '') return false;

  return signature === fieldSignature(b);
}

/**
 * The repeated block a field sits in.
 *
 * Takes the *outermost* repeating ancestor rather than the first one found.
 * The columns inside a row are themselves siblings of the same shape -- two
 * class-less divs holding School and Degree look exactly like two repeated
 * rows -- so stopping at the first match splits one row into several and the
 * second field of a row is read as the second entry.
 *
 * The walk stops at a section boundary, since a fieldset repeated elsewhere
 * on the page is a different section, not another row of this one.
 */
function findRowContainer(el: HTMLElement): HTMLElement | undefined {
  let node: HTMLElement | null = el.parentElement;
  let outermost: HTMLElement | undefined;
  let hops = 0;

  while (node && hops < 6) {
    if (node.matches('fieldset, form, body')) break;

    const parent = node.parentElement;
    if (parent) {
      // looksLikeSibling excludes the element itself, so one match means one
      // other copy -- which is already a repeated block. Requiring two would
      // need three rows before any grouping happened at all.
      const hasCopy = Array.from(parent.children).some((child) =>
        looksLikeSibling(node as HTMLElement, child),
      );
      if (hasCopy) outermost = node;
    }

    node = parent;
    hops += 1;
  }

  return outermost;
}

/**
 * Find the control that adds another row to a section.
 *
 * Matched on the button's own words rather than its position, because the
 * button sits outside the rows it creates and there is no attribute that
 * reliably links the two.
 */
const ADD_PATTERN =
  /\badd\b.*\b(another|more|experience|employer|position|role|job|education|school|degree|entry|row)\b|\badd\b\s*\+?$|^\+\s*add\b/i;

export function findAddButton(section: HTMLElement): HTMLElement | undefined {
  const candidates = Array.from(
    section.querySelectorAll<HTMLElement>('button, [role="button"], a[href="#"]'),
  );

  for (const candidate of candidates) {
    const text = (candidate.textContent ?? '').replace(/\s+/g, ' ').trim();
    const label = candidate.getAttribute('aria-label') ?? '';
    if (ADD_PATTERN.test(text) || ADD_PATTERN.test(label)) return candidate;
  }

  return undefined;
}

/**
 * Never click Add more than this many times.
 *
 * An unbounded loop against a form that ignores the click leaves the user
 * dozens of empty rows to delete by hand, which is a worse outcome than an
 * unfilled section.
 */
export const MAX_ROWS = 8;
