import { expect, test } from '@playwright/test';

const FIXTURE = 'http://127.0.0.1:4321/repeaters.html';

/**
 * Repeating sections.
 *
 * Getting the row wrong here is worse than leaving fields blank: every row
 * receives the same employer, and the application goes out with one job
 * listed three times under three different date ranges. That is the failure
 * users of other tools describe as "job descriptions under the wrong jobs".
 */
test.beforeEach(async ({ page }) => {
  await page.goto(FIXTURE);
});

test('puts a different job in each indexed row', async ({ page }) => {
  await page.evaluate(() => window.__fwFillRows());

  // The index is in the field names, so the markup decides, not us.
  await expect(page.locator('#c0')).toHaveValue('Analytical Engines');
  await expect(page.locator('#c1')).toHaveValue('Difference Machines');
  await expect(page.locator('#c2')).toHaveValue('Babbage & Co');

  await expect(page.locator('#t0')).toHaveValue('Principal Engineer');
  await expect(page.locator('#t1')).toHaveValue('Senior Engineer');
  await expect(page.locator('#t2')).toHaveValue('Engineer');
});

test('numbers two separate sections independently', async ({ page }) => {
  // "Work Experience" and "Previous Roles" are both work history. Numbering
  // them together would give two different fields the same row, so both
  // receive the same job.
  const rows = await page.evaluate(() =>
    window.__fwRows().map((r) => `${r.id}=${r.row}`),
  );

  expect(rows).toContain('c0=0');
  expect(rows).toContain('c2=2');
  // The second section starts counting again from its own first row.
  expect(rows).toContain('employer=0');
});

test('numbers cloned rows by position when the markup says nothing', async ({ page }) => {
  await page.evaluate(() => {
    document.getElementById('add-education')!.click();
    document.getElementById('add-education')!.click();
  });
  await page.waitForTimeout(100);

  const rows = await page.evaluate(() => window.__fwRowCount('education'));
  expect(rows).toBe(3);

  const filled = await page.evaluate(() => window.__fwFillRows());

  // Two profile entries across three rows: the first two fill, and the third
  // is left empty rather than repeating one of them.
  expect(filled['school#0']).toBe('MIT');
  expect(filled['school#1']).toBe('Cambridge');
  expect(filled['school#2']).toBe('');
});

test('leaves a row empty rather than repeating an entry', async ({ page }) => {
  const filled = await page.evaluate(() => window.__fwFillRows());

  // One education row on the page, two entries in the profile. The extra
  // entry is simply not written anywhere.
  const schools = Object.entries(filled)
    .filter(([key]) => key.startsWith('school'))
    .map(([, value]) => value);

  expect(new Set(schools).size).toBe(schools.length);
});

test('finds the Add control for each section', async ({ page }) => {
  const buttons = await page.evaluate(() => ({
    education: window.__fwAddButton('education-cloned'),
    roles: window.__fwAddButton('work-addable'),
    indexed: window.__fwAddButton('work-indexed'),
  }));

  expect(buttons.education).toContain('Add another school');
  expect(buttons.roles).toContain('Add another position');
  // The indexed section already has all its rows and offers no Add button.
  expect(buttons.indexed).toBeNull();
});

declare global {
  interface Window {
    __fwRows: () => { id: string | null; key: string; row: number; value: string | null }[];
    __fwFillRows: () => Record<string, string>;
    __fwInfer: (name: string) => number | null;
    __fwAddButton: (sectionId: string) => string | null;
    __fwRowCount: (section: string) => number;
  }
}
