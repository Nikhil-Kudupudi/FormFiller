import { beforeEach, describe, expect, it } from 'vitest';
import {
  findAddButton,
  groupByContainer,
  inferIndexFromAttributes,
  MAX_ROWS,
} from '@/core/detect/repeater';

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('reading a row index from the markup', () => {
  it('reads a bracketed index as written', () => {
    // Bracketed indices are already 0-based.
    expect(inferIndexFromAttributes(['experience[0][company]'])).toBe(0);
    expect(inferIndexFromAttributes(['experience[2][company]'])).toBe(2);
  });

  it('reads a keyword-and-number as 1-based', () => {
    // "employer 1" is the same row as "experience[0]".
    expect(inferIndexFromAttributes(['employer 1'])).toBe(0);
    expect(inferIndexFromAttributes(['job #3'])).toBe(2);
    expect(inferIndexFromAttributes(['education_1_school'])).toBe(0);
  });

  it('splits camelCase before matching', () => {
    // Without this, an anchored keyword never fires inside a compound name.
    expect(inferIndexFromAttributes(['workExperience-2-jobTitle'])).toBe(1);
  });

  it('reads ordinal phrasing', () => {
    expect(inferIndexFromAttributes(['2nd most recent employer'])).toBe(1);
    expect(inferIndexFromAttributes(['1st employer'])).toBe(0);
  });

  it('returns nothing when the markup names no row', () => {
    expect(inferIndexFromAttributes(['company'])).toBeUndefined();
    expect(inferIndexFromAttributes(['first_name'])).toBeUndefined();
    expect(inferIndexFromAttributes([''])).toBeUndefined();
  });

  it('rejects an implausible index', () => {
    // A parse accident rather than a real row.
    expect(inferIndexFromAttributes(['experience[99]'])).toBeUndefined();
  });
});

describe('grouping cloned rows by position', () => {
  function rows(count: number): HTMLElement[] {
    document.body.innerHTML = `<div id="rows">${Array.from(
      { length: count },
      () => `<div class="entry"><input name="company"><input name="title"></div>`,
    ).join('')}</div>`;
    return Array.from(document.querySelectorAll<HTMLElement>('input'));
  }

  it('numbers repeated blocks in document order', () => {
    const inputs = rows(3);
    const grouped = groupByContainer(inputs);

    // Two fields per row, three rows.
    expect(grouped.get(inputs[0]!)).toBe(0);
    expect(grouped.get(inputs[1]!)).toBe(0);
    expect(grouped.get(inputs[2]!)).toBe(1);
    expect(grouped.get(inputs[3]!)).toBe(1);
    expect(grouped.get(inputs[4]!)).toBe(2);
    expect(grouped.get(inputs[5]!)).toBe(2);
  });

  it('puts a lone field in row 0', () => {
    const inputs = rows(1);
    expect(groupByContainer(inputs).get(inputs[0]!)).toBe(0);
  });

  it('handles an empty list', () => {
    expect(groupByContainer([]).size).toBe(0);
  });
});

describe('finding the Add control', () => {
  function section(buttonText: string): HTMLElement {
    document.body.innerHTML = `
      <fieldset id="s">
        <div class="entry"><input name="company"></div>
        <button type="button">${buttonText}</button>
      </fieldset>`;
    return document.getElementById('s')!;
  }

  it('matches the usual phrasings', () => {
    for (const text of [
      'Add another',
      '+ Add another school',
      'Add another position',
      'Add more',
      'Add experience',
      'Add Education',
      'Add entry',
    ]) {
      expect(findAddButton(section(text)), text).toBeDefined();
    }
  });

  it('reads an aria-label when the button has only an icon', () => {
    document.body.innerHTML = `
      <fieldset id="s">
        <button type="button" aria-label="Add another employer">+</button>
      </fieldset>`;
    expect(findAddButton(document.getElementById('s')!)).toBeDefined();
  });

  it('ignores unrelated buttons', () => {
    for (const text of ['Submit', 'Remove', 'Cancel', 'Save and continue']) {
      expect(findAddButton(section(text)), text).toBeUndefined();
    }
  });
});

describe('the row cap', () => {
  it('is low enough that a misfire is recoverable by hand', () => {
    // An unbounded loop against a form that ignores the click leaves the user
    // dozens of empty rows to delete, which is worse than an unfilled section.
    expect(MAX_ROWS).toBeLessThanOrEqual(10);
    expect(MAX_ROWS).toBeGreaterThanOrEqual(3);
  });
});
