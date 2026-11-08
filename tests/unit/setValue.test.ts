import { beforeEach, describe, expect, it, vi } from 'vitest';
import { selectOption, setChecked, setValue } from '@/core/fill/setValue';
import { assessVisibility } from '@/core/detect/visibility';
import { FillSession } from '@/core/fill/session';
import { layOutPage } from './helpers/layout';

beforeEach(() => {
  document.body.innerHTML = '';
});

/** happy-dom does no layout, so elements need a plausible box to look real. */
function laidOut(): void {
  layOutPage();
}

function input(attrs: Record<string, string> = {}): HTMLInputElement {
  const el = document.createElement('input');
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  document.body.append(el);
  return el;
}

describe('setValue', () => {
  it('writes a value and reads it back', () => {
    const el = input();
    expect(setValue(el, 'Ada Lovelace')).toBe(true);
    expect(el.value).toBe('Ada Lovelace');
  });

  it('fires bubbling input and change events', () => {
    const el = input();
    const seen: string[] = [];
    document.body.addEventListener('input', () => seen.push('input'));
    document.body.addEventListener('change', () => seen.push('change'));

    setValue(el, 'x');

    // Bubbling matters: React attaches its listener at the root, not the node.
    expect(seen).toContain('input');
    expect(seen).toContain('change');
  });

  it('works on a textarea, which needs its own prototype setter', () => {
    // Using HTMLInputElement.prototype here would silently do nothing.
    const el = document.createElement('textarea');
    document.body.append(el);
    expect(setValue(el, 'a longer answer')).toBe(true);
    expect(el.value).toBe('a longer answer');
  });

  it('defeats a React-style value tracker', () => {
    const el = input();

    // Stand in for React's _valueTracker: it remembers the last value it saw
    // and, in the real thing, suppresses the change event when they match.
    let tracked = '';
    (el as unknown as { _valueTracker: { setValue(v: string): void } })._valueTracker = {
      setValue: (v: string) => {
        tracked = v;
      },
    };

    setValue(el, 'typed');

    // The tracker must have been reset to '' before the write, so React would
    // see a genuine change rather than swallowing the event.
    expect(tracked).toBe('');
    expect(el.value).toBe('typed');
  });

  it('reports failure when the field rejects the value', () => {
    // type=number silently discards a formatted string: value becomes ''.
    const el = input({ type: 'number' });
    expect(setValue(el, '(512) 555-1212')).toBe(false);
  });

  it('reports failure when the value exceeds maxlength', () => {
    // maxlength constrains typed input but not a programmatic assignment, so
    // the value looks fine in the DOM and is cut at submit. The caller has to
    // be able to warn rather than silently claim success.
    const el = input({ maxlength: '5' });
    expect(setValue(el, 'much longer than five')).toBe(false);
  });

  it('accepts a value that fits within maxlength', () => {
    const el = input({ maxlength: '20' });
    expect(setValue(el, 'Ada')).toBe(true);
  });

  it('simulates typing character by character when asked', () => {
    const el = input();
    const keydowns: string[] = [];
    el.addEventListener('keydown', (e) => keydowns.push((e as KeyboardEvent).key));

    setValue(el, 'abc', { simulateTyping: true });

    expect(keydowns).toEqual(['a', 'b', 'c']);
    expect(el.value).toBe('abc');
  });

  it('blurs by default so blur-triggered validators run', () => {
    const el = input();
    const onBlur = vi.fn();
    el.addEventListener('blur', onBlur);
    setValue(el, 'x');
    expect(onBlur).toHaveBeenCalled();
  });
});

describe('setChecked', () => {
  it('checks a box via its wrapping label', () => {
    document.body.innerHTML = `<label><input type="checkbox"> I currently work here</label>`;
    const el = document.querySelector('input')!;
    expect(setChecked(el, true)).toBe(true);
    expect(el.checked).toBe(true);
  });

  it('is a no-op when already in the wanted state', () => {
    const el = input({ type: 'checkbox' });
    el.checked = true;
    expect(setChecked(el, true)).toBe(true);
  });

  it('can uncheck', () => {
    const el = input({ type: 'checkbox' });
    el.checked = true;
    expect(setChecked(el, false)).toBe(true);
    expect(el.checked).toBe(false);
  });
});

describe('selectOption', () => {
  function select(options: string[]): HTMLSelectElement {
    const el = document.createElement('select');
    for (const text of options) {
      const o = document.createElement('option');
      o.textContent = text;
      o.value = text;
      el.append(o);
    }
    document.body.append(el);
    return el;
  }

  it('matches an option exactly', () => {
    const el = select(['Canada', 'United States', 'Mexico']);
    expect(selectOption(el, ['United States'])).toBe(true);
    expect(el.value).toBe('United States');
  });

  it('tries candidates in priority order', () => {
    // Different ATSs label the same country differently, so the normalizer
    // hands us an ordered list rather than one string.
    const el = select(['Canada', 'USA', 'Mexico']);
    expect(selectOption(el, ['United States of America', 'United States', 'USA'])).toBe(true);
    expect(el.value).toBe('USA');
  });

  it('leaves the select alone when nothing matches', () => {
    const el = select(['Canada', 'Mexico']);
    const before = el.value;
    expect(selectOption(el, ['Japan'])).toBe(false);
    expect(el.value).toBe(before);
  });

  it('refuses an ambiguous prefix rather than guessing', () => {
    // The classic trap: "United States" must not silently become the
    // Minor Outlying Islands.
    const el = select(['United States Minor Outlying Islands', 'United States of America']);
    expect(selectOption(el, ['United States'])).toBe(false);
  });

  it('does not confuse Virginia with West Virginia', () => {
    const el = select(['Virginia', 'West Virginia']);
    expect(selectOption(el, ['Virginia'])).toBe(true);
    expect(el.value).toBe('Virginia');
  });
});

describe('honeypot detection', () => {
  it('flags a type=hidden input', () => {
    const el = input({ type: 'hidden', name: 'url' });
    const r = assessVisibility(el);
    expect(r.visible).toBe(false);
    expect(r.honeypot).toBe(true);
  });

  it('flags a display:none trap with a suspicious name', () => {
    document.body.innerHTML = `<input name="website" style="display:none">`;
    const el = document.querySelector('input')!;
    const r = assessVisibility(el);
    expect(r.visible).toBe(false);
    expect(r.honeypot).toBe(true);
  });

  it('flags a Mailchimp-style trap', () => {
    document.body.innerHTML = `<div style="display:none"><input name="b_a1b2c3_d4e5f6"></div>`;
    const el = document.querySelector('input')!;
    expect(assessVisibility(el).honeypot).toBe(true);
  });

  it('does not call a hidden but legitimate field a honeypot', () => {
    // A collapsed accordion or an inactive wizard step is hidden, but it is
    // not a trap -- it may become fillable when the user expands it.
    document.body.innerHTML = `<div style="display:none"><input name="first_name"></div>`;
    const el = document.querySelector('input')!;
    const r = assessVisibility(el);
    expect(r.visible).toBe(false);
    expect(r.honeypot).toBe(false);
  });
});

describe('undo restores by element kind', () => {
  it('restores a text input to its previous value', async () => {
    // Regression: a text input is an HTMLInputElement, so recording its
    // `checked` state made undo take the checkbox branch -- which confirmed
    // the box was already unchecked, reported success, and never restored
    // the text.
    document.body.innerHTML = `<input id="t" name="first_name" value="draft">`;
    const el = document.querySelector('input')!;
    laidOut();

    const session = new FillSession();
    session.setCandidates([
      {
        element: el,
        id: 'f_0',
        label: 'First Name',
        labelSource: 'none',
        attributes: ['first_name'],
        type: 'text',
        visible: true,
        honeypot: false,
        prefilled: true,
      },
    ]);

    // Force the overwrite path: the field already holds a draft.
    el.value = '';
    // No MAIN-world helper here, so the bridge times out and the
    // isolated-world write takes over -- which is the documented fallback.
    expect((await session.fill('f_0', 'First Name', ['Ada'])).ok).toBe(true);
    expect(el.value).toBe('Ada');

    expect(session.undo()).toBe(1);
    expect(el.value).toBe('');
  });

  it('restores a checkbox to its previous state', async () => {
    document.body.innerHTML = `<input type="checkbox" id="c" name="currently_work_here">`;
    const el = document.querySelector('input')!;
    laidOut();

    const session = new FillSession();
    session.setCandidates([
      {
        element: el,
        id: 'f_0',
        label: 'I currently work here',
        labelSource: 'none',
        attributes: ['currently_work_here'],
        type: 'checkbox',
        visible: true,
        honeypot: false,
        prefilled: false,
      },
    ]);

    await session.fill('f_0', 'I currently work here', ['Yes']);
    expect(el.checked).toBe(true);

    session.undo();
    expect(el.checked).toBe(false);
  });
});
