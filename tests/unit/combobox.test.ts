import { beforeEach, describe, expect, it } from 'vitest';
import {
  controlRoot,
  displayedValue,
  findListbox,
  isCombobox,
  matchOption,
  readOptions,
} from '@/core/fill/combobox';
import { layOutPage } from './helpers/layout';

beforeEach(() => {
  document.body.innerHTML = '';
});

function render(html: string): void {
  document.body.innerHTML = html;
  layOutPage();
}

function options(...labels: string[]): HTMLElement[] {
  render(
    `<div role="listbox">${labels
      .map((l) => `<div role="option">${l}</div>`)
      .join('')}</div>`,
  );
  return readOptions(document.querySelector('[role=listbox]')!);
}

describe('recognising a custom dropdown', () => {
  it('spots role=combobox and aria-haspopup', () => {
    render(`<div role="combobox" id="a"></div><div aria-haspopup="listbox" id="b"></div>`);
    expect(isCombobox(document.getElementById('a')!)).toBe(true);
    expect(isCombobox(document.getElementById('b')!)).toBe(true);
  });

  it('spots a vendor class', () => {
    render(`<div class="select__control" id="a"></div>`);
    expect(isCombobox(document.getElementById('a')!)).toBe(true);
  });

  it('does not treat a native select as one', () => {
    render(`<select id="s"><option>x</option></select>`);
    expect(isCombobox(document.getElementById('s')!)).toBe(false);
  });

  it('finds the widget root from an inner input', () => {
    render(`<div class="select__control" id="root"><input id="inner"></div>`);
    expect(controlRoot(document.getElementById('inner')!).id).toBe('root');
  });

  it('treats the input itself as the root when it carries the role', () => {
    // A typeahead is often just an input with role=combobox. Looking for a
    // nested input here finds nothing, and the query never gets typed.
    render(`<input id="ta" role="combobox" aria-autocomplete="list">`);
    expect(controlRoot(document.getElementById('ta')!).id).toBe('ta');
  });
});

describe('reading the current selection', () => {
  it('treats a placeholder as no selection', () => {
    for (const placeholder of ['Select...', 'Select', 'Choose an option', 'Please select']) {
      render(`<div role="combobox" id="c"><span class="value">${placeholder}</span></div>`);
      expect(displayedValue(document.getElementById('c')!)).toBeUndefined();
    }
  });

  it('reads a real selection', () => {
    render(`<div role="combobox" id="c"><span class="select__single-value">Canada</span></div>`);
    expect(displayedValue(document.getElementById('c')!)).toBe('Canada');
  });

  it('looks past the chip tray of a multiselect', () => {
    // Otherwise the current value reads as every previous choice concatenated.
    render(`
      <div role="combobox" id="c">
        <span class="value">Rust</span>
        <div class="chips" data-automation-id="selectedItemList">
          <span class="chip" role="option">Already chosen</span>
        </div>
      </div>`);
    expect(displayedValue(document.getElementById('c')!)).toBe('Rust');
  });
});

describe('finding the menu', () => {
  it('follows aria-controls to a portalled menu', () => {
    render(`
      <div role="combobox" id="c" aria-controls="menu"></div>
      <div id="menu" role="listbox"><div role="option">Canada</div></div>`);
    expect(findListbox(document.getElementById('c')!)?.id).toBe('menu');
  });

  it('ignores a hidden menu', () => {
    render(`<div role="combobox" id="c"></div><div role="listbox" hidden></div>`);
    expect(findListbox(document.getElementById('c')!)).toBeUndefined();
  });

  it('never returns a chip tray', () => {
    // Workday's selected-items container carries role=listbox, and picking
    // from it would re-select what the user already had.
    render(`
      <div role="combobox" id="c">
        <div role="listbox" data-automation-id="selectedItemList">
          <div role="option">Already chosen</div>
        </div>
      </div>`);
    expect(findListbox(document.getElementById('c')!)).toBeUndefined();
  });
});

describe('reading options', () => {
  it('skips status rows', () => {
    // These are clickable in real widgets; choosing one submits "Loading…"
    // as the user's answer.
    const labels = readOptions(
      (() => {
        render(`<div role="listbox">
          <div role="option">Loading…</div>
          <div role="option">Searching...</div>
          <div role="option">No results</div>
          <div role="option">Canada</div>
        </div>`);
        return document.querySelector('[role=listbox]')!;
      })(),
    ).map((o) => o.textContent);

    expect(labels).toEqual(['Canada']);
  });

  it('skips disabled options', () => {
    render(`<div role="listbox">
      <div role="option" aria-disabled="true">Canada</div>
      <div role="option">Mexico</div>
    </div>`);
    const labels = readOptions(document.querySelector('[role=listbox]')!).map(
      (o) => o.textContent,
    );
    expect(labels).toEqual(['Mexico']);
  });
});

describe('matching an option', () => {
  it('prefers an exact match', () => {
    const list = options('United States Minor Outlying Islands', 'United States of America');
    expect(matchOption(list, ['United States of America'])?.textContent).toBe(
      'United States of America',
    );
  });

  it('tries candidates in order', () => {
    // The resolver hands over alternate spellings; the first that exists wins.
    const list = options('Canada', 'USA', 'Mexico');
    expect(matchOption(list, ['United States of America', 'United States', 'USA'])?.textContent)
      .toBe('USA');
  });

  it('refuses an ambiguous prefix', () => {
    const list = options('United States Minor Outlying Islands', 'United States of America');
    expect(matchOption(list, ['United States'])).toBeUndefined();
  });

  it('accepts an unambiguous prefix', () => {
    const list = options('Canada', 'Mexico');
    expect(matchOption(list, ['Can'])?.textContent).toBe('Canada');
  });

  it('does not confuse Virginia with West Virginia', () => {
    const list = options('Virginia', 'West Virginia', 'Virginia Beach');
    expect(matchOption(list, ['Virginia'])?.textContent).toBe('Virginia');
  });

  it('returns nothing when the value is absent', () => {
    expect(matchOption(options('Canada', 'Mexico'), ['Japan'])).toBeUndefined();
  });

  it('ignores case and surrounding whitespace', () => {
    const list = options('  Canada  ');
    expect(matchOption(list, ['canada'])?.textContent?.trim()).toBe('Canada');
  });
});
