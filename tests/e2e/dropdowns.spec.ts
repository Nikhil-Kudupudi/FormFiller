import { expect, test } from '@playwright/test';

const FIXTURE = 'http://127.0.0.1:4321/dropdowns.html';

/**
 * Custom dropdowns.
 *
 * Reported as the single field type autofill tools most often get wrong, and
 * each widget on the fixture reproduces one specific reason: a menu portalled
 * to `<body>`, a control that opens on `mousedown` and closes on the blur a
 * plain click causes, a keyboard-only control, an async list behind a
 * clickable "Loading…" row, a chip tray that also carries `role="listbox"`,
 * and an option set where a prefix match is ambiguous.
 */
test.beforeEach(async ({ page }) => {
  await page.goto(FIXTURE);
});

test('opens a portalled menu that only responds to mousedown', async ({ page }) => {
  const result = await page.evaluate(() =>
    window.__fwCombo('country-control', [
      'United States of America',
      'United States',
      'USA',
    ]),
  );

  expect(result.ok).toBe(true);
  // Not "United States Minor Outlying Islands", which an unguarded prefix
  // match would reach first.
  expect(result.chosen).toBe('United States of America');
  await expect(page.locator('#country-control .select__single-value')).toHaveText(
    'United States of America',
  );
});

test('opens a control that ignores mouse events entirely', async ({ page }) => {
  const result = await page.evaluate(() =>
    window.__fwCombo('degree-control', ["Bachelor's Degree"]),
  );

  expect(result.ok).toBe(true);
  expect(result.chosen).toBe("Bachelor's Degree");
});

test('refuses an ambiguous prefix rather than guessing', async ({ page }) => {
  // "Virginia" is also a prefix of "Virginia Beach"; only the exact match
  // is acceptable.
  const result = await page.evaluate(() =>
    window.__fwCombo('state-control', ['Virginia']),
  );

  expect(result.ok).toBe(true);
  expect(result.chosen).toBe('Virginia');
});

test('leaves a dropdown alone when nothing matches', async ({ page }) => {
  const result = await page.evaluate(() =>
    window.__fwCombo('state-control', ['Atlantis']),
  );

  expect(result.ok).toBe(false);
  expect(result.reason).toBe('no matching option in this dropdown');
  // And the widget is left closed and unchanged, not half-open.
  const shown = await page.evaluate(() => window.__fwShown('state-control'));
  expect(shown).toBeUndefined();
});

test('never selects from the chip tray', async ({ page }) => {
  // A multiselect renders existing choices in a container that also carries
  // role="listbox". Searching it would re-select what the user already had.
  const result = await page.evaluate(() => window.__fwCombo('skills-control', ['Rust']));

  expect(result.ok).toBe(true);
  expect(result.chosen).toBe('Rust');
  // Reading the current value must look past the chips, not concatenate them.
  const shown = await page.evaluate(() => window.__fwShown('skills-control'));
  expect(shown).toBe('Rust');
});

test('an async typeahead binds the hidden value, not just the text', async ({ page }) => {
  const result = await page.evaluate(() =>
    window.__fwCombo('school', ['Massachusetts Institute of Technology'], true),
  );

  expect(result.ok).toBe(true);

  // The decisive assertion. Typing text that looks right leaves the companion
  // field empty and the application is submitted with no school at all, so a
  // fill only counts if an option was genuinely chosen.
  await expect(page.locator('#school_id')).toHaveValue('mit-1');
  await expect(page.locator('#school')).toHaveValue(
    'Massachusetts Institute of Technology',
  );
});

test('the async typeahead is not flaky', async ({ page }) => {
  // The fixture answers with variable latency and shows a clickable
  // "Loading…" row. Intermittent failure here would mean sometimes
  // submitting the wrong school, so this runs repeatedly rather than once.
  for (let attempt = 0; attempt < 12; attempt++) {
    await page.goto(FIXTURE);
    const result = await page.evaluate(() =>
      window.__fwCombo('school', ['University of Massachusetts'], true),
    );

    expect(result.ok, `attempt ${attempt}`).toBe(true);
    await expect(page.locator('#school_id'), `attempt ${attempt}`).toHaveValue('uma-3');
  }
});

test('never picks a loading or status row as the answer', async ({ page }) => {
  // "Loading…" and "No results" are clickable rows in this widget. Choosing
  // one would submit it as the user's school.
  const result = await page.evaluate(() =>
    window.__fwCombo('school', ['Nonexistent Polytechnic'], true),
  );

  expect(result.ok).toBe(false);
  await expect(page.locator('#school_id')).toHaveValue('');
  await expect(page.locator('#school')).not.toHaveValue('Loading…');
});

declare global {
  interface Window {
    __fwCombo: (
      id: string,
      candidates: string[],
      typeInto?: boolean,
    ) => Promise<{ ok: boolean; chosen?: string; reason?: string }>;
    __fwShown: (id: string) => string | undefined;
  }
}
