/**
 * Dates, which job forms express in at least four incompatible shapes.
 *
 *   `<input type="date">`   wants YYYY-MM-DD as the *value*, whatever the
 *                           browser displays, so a locale-formatted string
 *                           is silently discarded and the field stays empty
 *   `<input type="month">`  wants YYYY-MM
 *   masked text             MM/YYYY or MM/DD/YYYY, per the page's own mask
 *   three separate controls one each for month, day and year, where the
 *                           month may be "January", "Jan", "01" or "1"
 *
 * The profile stores month precision (`YYYY-MM`), which is what employment
 * and education dates actually ask for. A day is only ever supplied when a
 * form insists on one, and then it is the first of the month rather than an
 * invented date.
 */

export type DatePart = 'month' | 'day' | 'year';

export interface StoredDate {
  year: number;
  /** 1-12. */
  month: number;
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** Parse the `YYYY-MM` the profile stores. */
export function parseStoredDate(value: string): StoredDate | undefined {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(value.trim());
  if (!match) return undefined;
  return { year: Number(match[1]), month: Number(match[2]) };
}

/**
 * Ways a form might label this month, most specific first.
 *
 * A dropdown may offer full names, three-letter abbreviations, zero-padded
 * numbers or bare numbers, and there is no way to know which until the option
 * list is read -- so all four are offered and the matcher picks.
 */
export function monthCandidates(month: number): string[] {
  const name = MONTH_NAMES[month - 1];
  const padded = String(month).padStart(2, '0');
  const out = [padded, String(month)];
  if (name) out.unshift(name, name.slice(0, 3));
  return out;
}

export function yearCandidates(year: number): string[] {
  return [String(year)];
}

export function dayCandidates(day: number): string[] {
  return [String(day).padStart(2, '0'), String(day)];
}

/** Candidates for one part of a split date. */
export function candidatesForPart(date: StoredDate, part: DatePart): string[] {
  switch (part) {
    case 'month':
      return monthCandidates(date.month);
    case 'year':
      return yearCandidates(date.year);
    case 'day':
      // The profile holds month precision. Where a form demands a day, the
      // first of the month is the honest answer rather than a guess at one.
      return dayCandidates(1);
  }
}

/* ------------------------------------------------------------------ parts */

const MONTH_WORDS = /\b(month|mm|mois|monat|mes)\b/i;
const DAY_WORDS = /\b(day|dd|jour|tag|dia)\b/i;
const YEAR_WORDS = /\b(year|yyyy|yy|ann[eé]e|jahr|a[nñ]o)\b/i;

/** True when these option labels look like a list of years. */
function optionsLookLikeYears(labels: string[]): boolean {
  const numeric = labels.filter((l) => /^(19|20)\d{2}$/.test(l.trim()));
  return numeric.length >= 5 && numeric.length / labels.length > 0.7;
}

function optionsLookLikeMonths(labels: string[]): boolean {
  // Length first: a day list from 1 to 31 also contains twelve values in the
  // 1-12 range, so counting matches alone reads it as a month list.
  if (labels.length > 13) return false;

  const asMonths = labels.filter((l) => {
    const text = l.trim().toLowerCase();
    if (MONTH_NAMES.some((m) => m.toLowerCase() === text || m.slice(0, 3).toLowerCase() === text)) {
      return true;
    }
    const n = Number(text);
    return Number.isInteger(n) && n >= 1 && n <= 12;
  });
  // Twelve months, plus at most a placeholder row.
  return asMonths.length >= 11;
}

function optionsLookLikeDays(labels: string[]): boolean {
  const asDays = labels.filter((l) => {
    const n = Number(l.trim());
    return Number.isInteger(n) && n >= 1 && n <= 31;
  });
  return asDays.length >= 28;
}

/**
 * Which part of a date this control holds, if any.
 *
 * Option contents are checked before labels, because they are harder to
 * misread: a list of twelve month names is unambiguous where a label reading
 * "From" is not. A day list and a month list overlap on 1-12, so months are
 * tested first and days require a count only a day list reaches.
 */
export function classifyDatePart(el: HTMLElement): DatePart | undefined {
  if (el instanceof HTMLSelectElement) {
    const labels = Array.from(el.options)
      .map((o) => (o.textContent ?? '').trim())
      .filter((t) => t !== '');

    if (optionsLookLikeYears(labels)) return 'year';
    if (optionsLookLikeMonths(labels)) return 'month';
    if (optionsLookLikeDays(labels)) return 'day';
  }

  // A control that holds a whole date is not a part of one. "MM/YYYY" in a
  // placeholder contains "MM", so matching on words alone reads a complete
  // masked date input as a month box.
  if (holdsWholeDate(el)) return undefined;

  // Tokenized before matching: underscore is a word character, so a
  // word-boundary-anchored match never fires inside "start_month".
  const signals = [
    el.getAttribute('name') ?? '',
    el.getAttribute('id') ?? '',
    el.getAttribute('aria-label') ?? '',
    el.getAttribute('placeholder') ?? '',
    el.getAttribute('data-automation-id') ?? '',
  ]
    .join(' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_\-.[\]/]+/g, ' ');

  if (MONTH_WORDS.test(signals)) return 'month';
  if (DAY_WORDS.test(signals)) return 'day';
  if (YEAR_WORDS.test(signals)) return 'year';

  return undefined;
}

/** True when this one control expresses a complete date. */
function holdsWholeDate(el: HTMLElement): boolean {
  if (el instanceof HTMLInputElement && (el.type === 'date' || el.type === 'month')) {
    return true;
  }

  const hint = `${el.getAttribute('placeholder') ?? ''} ${el.getAttribute('aria-label') ?? ''}`
    .toUpperCase();

  // Two components or more named together: MM/YYYY, YYYY-MM-DD, MM/DD/YYYY.
  const named = ['MM', 'DD', 'YYYY'].filter((token) => hint.includes(token));
  if (named.length >= 2) return true;

  // Room for more than one component.
  if (el instanceof HTMLInputElement && el.maxLength > 4) return true;

  return false;
}

/* ------------------------------------------------------------------ masks */

export type DateMask = 'YYYY-MM-DD' | 'YYYY-MM' | 'MM/DD/YYYY' | 'MM/YYYY' | 'YYYY';

/**
 * The format this control expects.
 *
 * `type` is authoritative where it is set, because the browser enforces it:
 * a `type=date` holding anything but `YYYY-MM-DD` ends up empty. Otherwise
 * the page's own placeholder or pattern is the best evidence of its mask.
 */
export function detectMask(el: HTMLElement): DateMask {
  if (el instanceof HTMLInputElement) {
    if (el.type === 'date') return 'YYYY-MM-DD';
    if (el.type === 'month') return 'YYYY-MM';
  }

  const hint = [
    el.getAttribute('placeholder') ?? '',
    el.getAttribute('pattern') ?? '',
    el.getAttribute('aria-label') ?? '',
    el.getAttribute('title') ?? '',
  ]
    .join(' ')
    .toUpperCase();

  if (/YYYY[^A-Z]*MM[^A-Z]*DD/.test(hint)) return 'YYYY-MM-DD';
  if (/MM[^A-Z]*DD[^A-Z]*YYYY/.test(hint)) return 'MM/DD/YYYY';
  if (/MM[^A-Z]*YYYY/.test(hint)) return 'MM/YYYY';
  if (/YYYY[^A-Z]*MM/.test(hint)) return 'YYYY-MM';
  if (/^\s*YYYY\s*$/.test(hint)) return 'YYYY';

  // A two-character limit cannot hold a year, so it is a month box.
  if (el instanceof HTMLInputElement && el.maxLength === 2) return 'MM/YYYY';

  // Month and year is what employment and education dates ask for.
  return 'MM/YYYY';
}

/** Render a stored date in the given mask, using the page's own separator. */
export function formatForMask(date: StoredDate, mask: DateMask, separator = '/'): string {
  const month = String(date.month).padStart(2, '0');
  const year = String(date.year);

  switch (mask) {
    case 'YYYY-MM-DD':
      // Always hyphens: this is the value a native date input requires,
      // regardless of how the browser chooses to display it.
      return `${year}-${month}-01`;
    case 'YYYY-MM':
      return `${year}-${month}`;
    case 'MM/DD/YYYY':
      return [month, '01', year].join(separator);
    case 'MM/YYYY':
      return [month, year].join(separator);
    case 'YYYY':
      return year;
  }
}

/** The separator a masked field already shows, so we match its own style. */
export function detectSeparator(el: HTMLElement): string {
  const hint = `${el.getAttribute('placeholder') ?? ''} ${el.getAttribute('aria-label') ?? ''}`;
  if (hint.includes('-')) return '-';
  if (hint.includes('.')) return '.';
  return '/';
}

/**
 * Candidate strings for a single date control.
 *
 * The detected mask first, then the other plausible renderings: a page's
 * placeholder can lie, and the fill is verified by reading the value back,
 * so offering alternatives costs nothing and rescues a mis-detected mask.
 */
export function candidatesForInput(el: HTMLElement, stored: string): string[] {
  const date = parseStoredDate(stored);
  if (!date) return [stored];

  const separator = detectSeparator(el);
  const mask = detectMask(el);

  const ordered: DateMask[] = [mask, 'YYYY-MM', 'MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD'];
  const seen = new Set<string>();
  const out: string[] = [];

  for (const candidate of ordered) {
    const text = formatForMask(date, candidate, separator);
    if (!seen.has(text)) {
      seen.add(text);
      out.push(text);
    }
  }

  // A native input accepts exactly one format; offering others would let a
  // later candidate overwrite a correct value with an empty one.
  if (el instanceof HTMLInputElement && (el.type === 'date' || el.type === 'month')) {
    return [out[0]!];
  }

  return out;
}
