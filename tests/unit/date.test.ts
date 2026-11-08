import { beforeEach, describe, expect, it } from 'vitest';
import {
  candidatesForInput,
  candidatesForPart,
  classifyDatePart,
  detectMask,
  formatForMask,
  monthCandidates,
  parseStoredDate,
} from '@/core/fill/date';

beforeEach(() => {
  document.body.innerHTML = '';
});

function el(html: string): HTMLElement {
  document.body.innerHTML = html;
  return document.body.firstElementChild as HTMLElement;
}

function select(options: string[], attrs = ''): HTMLSelectElement {
  return el(
    `<select ${attrs}>${options.map((o) => `<option>${o}</option>`).join('')}</select>`,
  ) as HTMLSelectElement;
}

describe('parsing stored dates', () => {
  it('reads YYYY-MM', () => {
    expect(parseStoredDate('2022-03')).toEqual({ year: 2022, month: 3 });
  });

  it('rejects anything else', () => {
    for (const bad of ['03/2022', '2022', '2022-13', '2022-3', '']) {
      expect(parseStoredDate(bad)).toBeUndefined();
    }
  });
});

describe('month candidates', () => {
  it('offers every way a form might label a month', () => {
    // There is no way to know which form a dropdown uses until its options
    // are read, so all four are offered and the matcher decides.
    expect(monthCandidates(3)).toEqual(['March', 'Mar', '03', '3']);
  });

  it('pads single digits', () => {
    expect(monthCandidates(9)).toContain('09');
  });
});

describe('classifying a date part', () => {
  it('reads a month list by its options', () => {
    expect(classifyDatePart(select(['January', 'February', 'March', 'April', 'May',
      'June', 'July', 'August', 'September', 'October', 'November', 'December']))).toBe('month');
  });

  it('reads a numeric month list', () => {
    const months = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0'));
    expect(classifyDatePart(select(months))).toBe('month');
  });

  it('distinguishes a day list from a month list', () => {
    // A 1-31 day list also holds twelve values in the 1-12 range, so counting
    // matches alone reads it as a month list. Length is what separates them.
    const days = Array.from({ length: 31 }, (_, i) => String(i + 1));
    expect(classifyDatePart(select(days))).toBe('day');
  });

  it('reads a year list', () => {
    const years = Array.from({ length: 8 }, (_, i) => String(2019 + i));
    expect(classifyDatePart(select(years))).toBe('year');
  });

  it('falls back to the field name', () => {
    expect(classifyDatePart(el('<input name="start_month">'))).toBe('month');
    expect(classifyDatePart(el('<input name="grad_year">'))).toBe('year');
    expect(classifyDatePart(el('<input aria-label="Day">'))).toBe('day');
  });

  it('does not treat a whole-date control as a part', () => {
    // "MM/YYYY" contains "MM", so matching on words alone reads a complete
    // masked date input as a month box and writes only the month into it.
    expect(classifyDatePart(el('<input placeholder="MM/YYYY" maxlength="7">'))).toBeUndefined();
    expect(classifyDatePart(el('<input placeholder="MM/DD/YYYY" maxlength="10">'))).toBeUndefined();
    expect(classifyDatePart(el('<input type="date">'))).toBeUndefined();
    expect(classifyDatePart(el('<input type="month">'))).toBeUndefined();
  });

  it('returns nothing for an unrelated field', () => {
    expect(classifyDatePart(el('<input name="first_name">'))).toBeUndefined();
    expect(classifyDatePart(select(['Canada', 'Mexico']))).toBeUndefined();
  });
});

describe('detecting the expected format', () => {
  it('trusts the input type above all', () => {
    expect(detectMask(el('<input type="date">'))).toBe('YYYY-MM-DD');
    expect(detectMask(el('<input type="month">'))).toBe('YYYY-MM');
  });

  it('reads the page placeholder', () => {
    expect(detectMask(el('<input placeholder="MM/DD/YYYY">'))).toBe('MM/DD/YYYY');
    expect(detectMask(el('<input placeholder="MM/YYYY">'))).toBe('MM/YYYY');
    expect(detectMask(el('<input placeholder="YYYY-MM-DD">'))).toBe('YYYY-MM-DD');
  });

  it('defaults to month and year, which is what job forms ask for', () => {
    expect(detectMask(el('<input>'))).toBe('MM/YYYY');
  });
});

describe('formatting', () => {
  const date = { year: 2022, month: 3 };

  it('always uses hyphens for a native date value', () => {
    // The browser requires this form whatever it displays; anything else is
    // silently discarded and the field stays empty.
    expect(formatForMask(date, 'YYYY-MM-DD', '/')).toBe('2022-03-01');
    expect(formatForMask(date, 'YYYY-MM', '.')).toBe('2022-03');
  });

  it('uses the page separator for masked text', () => {
    expect(formatForMask(date, 'MM/YYYY', '/')).toBe('03/2022');
    expect(formatForMask(date, 'MM/YYYY', '-')).toBe('03-2022');
  });

  it('supplies the first of the month when a day is demanded', () => {
    // The profile holds month precision; inventing a day would be a guess.
    expect(formatForMask(date, 'MM/DD/YYYY', '/')).toBe('03/01/2022');
  });
});

describe('candidates for a single input', () => {
  it('offers exactly one form for a native input', () => {
    // Offering alternatives would let a later candidate overwrite a correct
    // value with an empty one.
    expect(candidatesForInput(el('<input type="date">'), '2022-03')).toEqual(['2022-03-01']);
    expect(candidatesForInput(el('<input type="month">'), '2022-03')).toEqual(['2022-03']);
  });

  it('leads with the detected mask for masked text', () => {
    const candidates = candidatesForInput(el('<input placeholder="MM/YYYY">'), '2022-03');
    expect(candidates[0]).toBe('03/2022');
    // And keeps alternatives, since a placeholder can lie and every write is
    // verified by reading it back.
    expect(candidates.length).toBeGreaterThan(1);
  });

  it('passes through a value it cannot parse', () => {
    expect(candidatesForInput(el('<input>'), 'Present')).toEqual(['Present']);
  });
});

describe('candidates for one part of a split date', () => {
  const date = { year: 2022, month: 3 };

  it('gives the month every way a dropdown might label it', () => {
    expect(candidatesForPart(date, 'month')).toEqual(['March', 'Mar', '03', '3']);
  });

  it('gives the year', () => {
    expect(candidatesForPart(date, 'year')).toEqual(['2022']);
  });

  it('gives the first of the month for a day', () => {
    expect(candidatesForPart(date, 'day')).toEqual(['01', '1']);
  });
});
