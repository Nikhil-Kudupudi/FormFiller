import { expect, test } from '@playwright/test';

const FIXTURE = 'http://127.0.0.1:4321/dates.html';

/**
 * Dates, in the four shapes job forms actually use.
 *
 * The profile stores month precision, which is what employment and education
 * dates ask for. Every shape below has to be written in its own format, and a
 * wrong one is not merely rejected -- a native date input silently discards it
 * and the field is left empty, which looks the same as never having tried.
 */
test.beforeEach(async ({ page }) => {
  await page.goto(FIXTURE);
});

test('writes native inputs in the format the browser demands', async ({ page }) => {
  await page.evaluate(() => window.__fwFillDates());

  // type=date takes YYYY-MM-DD whatever it displays. The profile holds only
  // a month, so the first of it is supplied rather than an invented day.
  await expect(page.locator('#d1')).toHaveValue('2022-03-01');
  // type=month takes YYYY-MM.
  await expect(page.locator('#d2')).toHaveValue('2024-11');
});

test('writes masked text in the mask the page states', async ({ page }) => {
  await page.evaluate(() => window.__fwFillDates());

  await expect(page.locator('#m1')).toHaveValue('03/2022');
  await expect(page.locator('#m2')).toHaveValue('05/01/2020');
});

test('fills a date split across separate controls', async ({ page }) => {
  await page.evaluate(() => window.__fwFillDates());

  // Named months here...
  await expect(page.locator('#s-month')).toHaveValue('March');
  await expect(page.locator('#s-year')).toHaveValue('2022');
  // ...and numeric ones there. Which a dropdown uses is only knowable by
  // reading its options, so both forms are offered and the matcher decides.
  await expect(page.locator('#g-month')).toHaveValue('05');
  await expect(page.locator('#g-year')).toHaveValue('2020');
});

test('tells a day list apart from a month list', async ({ page }) => {
  const parts = await page.evaluate(() => ({
    month: window.__fwPart('g-month'),
    day: window.__fwPart('g-day'),
    year: window.__fwPart('g-year'),
  }));

  // A 1-31 day list also holds twelve values in the 1-12 range, so counting
  // month-shaped options alone reads it as a month list -- and the day
  // control then receives the month.
  expect(parts).toEqual({ month: 'month', day: 'day', year: 'year' });
});

test('does not mistake a whole masked date for one part of one', async ({ page }) => {
  // "MM/YYYY" contains "MM". Treating that as a month box would write "03"
  // into a field expecting "03/2022".
  const parts = await page.evaluate(() => ({
    maskedMonthYear: window.__fwPart('m1'),
    maskedFullDate: window.__fwPart('m2'),
    nativeDate: window.__fwPart('d1'),
    nativeMonth: window.__fwPart('d2'),
  }));

  expect(parts).toEqual({
    maskedMonthYear: null,
    maskedFullDate: null,
    nativeDate: null,
    nativeMonth: null,
  });
});

test('groups split parts under the date they belong to', async ({ page }) => {
  const detected = await page.evaluate(() =>
    window
      .__fwDates()
      .filter((d) => ['s-month', 's-year', 'g-month', 'g-year'].includes(d.id))
      .map((d) => ({ id: d.id, label: d.label, key: d.key })),
  );

  // Their own labels read "Month" and "Year", which name a part but not
  // which date it belongs to. The group's heading is what identifies it.
  expect(detected).toEqual([
    { id: 's-month', label: 'Start Date', key: 'work.startDate' },
    { id: 's-year', label: 'Start Date', key: 'work.startDate' },
    { id: 'g-month', label: 'Graduation Date', key: 'education.endDate' },
    { id: 'g-year', label: 'Graduation Date', key: 'education.endDate' },
  ]);
});

test('a month control is never mapped to something that is not a date', async ({ page }) => {
  // The end-date selects sit under a "Current Role" heading with no date of
  // its own. Without a guard they classify as a job title and get "March"
  // written into them; being reported as unrecognised is the right outcome.
  const detected = await page.evaluate(() =>
    window
      .__fwDates()
      .filter((d) => ['e-month', 'e-year'].includes(d.id))
      .map((d) => d.key),
  );

  expect(detected).toEqual([null, null]);
});

test('recognises the current-role checkbox', async ({ page }) => {
  // A checkbox's `value` is "on" whether or not it is ticked, so reading
  // `value` to decide whether a field is already filled skips every checkbox
  // before it is ever offered.
  const current = await page.evaluate(
    () => window.__fwDates().find((d) => d.id === 'is-current')?.key ?? null,
  );

  expect(current).toBe('work.isCurrent');
});

declare global {
  interface Window {
    __fwDates: () => {
      id: string;
      label: string;
      part: string | null;
      mask: string;
      status: string;
      key: string | null;
      values: string[];
    }[];
    __fwFillDates: () => Record<string, string>;
    __fwPart: (id: string) => string | null;
  }
}
