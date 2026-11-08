import { expect, test } from '@playwright/test';

const FIXTURE = 'http://127.0.0.1:4321/kitchen-sink.html';

/** Names of every honeypot on the fixture. None may ever hold a value. */
const HONEYPOTS = [
  'url', 'website', 'homepage', 'fax', 'nickname',
  'b_1a2b3c_4d5e6f', 'honeypot', 'winnie', 'bait', 'spam',
];

test.beforeEach(async ({ page }) => {
  await page.goto(FIXTURE);
  // A capture-phase guard, asserted in afterEach. The single most important
  // property of this extension is that it never submits an application.
  await page.evaluate(() => {
    (window as unknown as { __submits: number }).__submits = 0;
    document.addEventListener(
      'submit',
      (e) => {
        e.preventDefault();
        (window as unknown as { __submits: number }).__submits += 1;
      },
      true,
    );
  });
});

test.afterEach(async ({ page }) => {
  const submits = await page.evaluate(
    () => (window as unknown as { __submits: number }).__submits,
  );
  expect(submits, 'the extension must never submit a form').toBe(0);
});

test('fills the fields it recognises and reports honestly', async ({ page }) => {
  const report = await page.evaluate(() => window.__fieldwise.run());

  expect(report.failed, 'no field should fail its read-back').toEqual([]);
  expect(report.filled.length).toBeGreaterThanOrEqual(15);

  const keys = report.filled.map((f) => f.key);
  expect(keys).toContain('identity.firstName');
  expect(keys).toContain('contact.email');
  expect(keys).toContain('address.postalCode');

  // Confirm/duplicate email must be filled too, or the form's own equality
  // validator blocks submission.
  expect(keys).toContain('contact.emailConfirm');
});

test('a fill survives a framework re-render', async ({ page }) => {
  await page.evaluate(() => window.__fieldwise.run());

  // The decisive check. React keeps its own record of the last value it saw;
  // a write that does not reset it is swallowed, leaving the input looking
  // correct while component state stays empty -- and the form submits empty.
  await page.evaluate(() => window.__forceRender());

  await expect(page.locator('#react-echo')).toHaveText('Ada');
  await expect(page.locator('#react-field')).toHaveValue('Ada');
});

test('the fixture is genuinely adversarial', async ({ page }) => {
  // Guards the guard: if a naive fill started passing, the test above would
  // no longer prove anything.
  const swallowed = await page.evaluate(() => {
    const el = document.getElementById('react-field') as HTMLInputElement;
    el.value = 'NAIVE';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return document.getElementById('react-echo')!.textContent;
  });

  expect(swallowed, 'a naive .value assignment must not reach state').toBe('(empty)');
});

test('leaves every honeypot empty', async ({ page }) => {
  await page.evaluate(() => window.__fieldwise.run());

  const dirty = await page.evaluate(
    (names) =>
      names
        .map((n) => ({
          name: n,
          value: document.querySelector<HTMLInputElement>(`[name="${n}"]`)?.value ?? '',
        }))
        .filter((x) => x.value !== ''),
    HONEYPOTS,
  );

  // Filling a trap is how an autofill tool gets its user flagged as a bot,
  // and the user never finds out.
  expect(dirty, 'honeypots must stay empty').toEqual([]);
});

test('never touches a denied field', async ({ page }) => {
  await page.evaluate(() => window.__fieldwise.run());

  await expect(page.locator('[name=password]')).toHaveValue('');
  await expect(page.locator('[name=ssn]')).toHaveValue('');
  await expect(page.locator('[name=q]')).toHaveValue('');
  await expect(page.locator('[name=newsletter_email]')).toHaveValue('');
  await expect(page.locator('[name=referrer]')).toHaveValue('');
  await expect(page.locator('[name=cover_letter]')).toHaveValue('');
});

test('never checks a consent box', async ({ page }) => {
  await page.evaluate(() => window.__fieldwise.run());

  // Agreeing to terms or to binding arbitration is a legal act.
  await expect(page.locator('[name=agree_terms]')).not.toBeChecked();
  await expect(page.locator('[name=agree_arbitration]')).not.toBeChecked();
});

test('does not mistake a salutation for a job title', async ({ page }) => {
  await page.evaluate(() => window.__fieldwise.run());

  // "Title" next to Mr/Ms/Dr options is not the user's job title, and a
  // free-text value must never be written into a <select>.
  await expect(page.locator('[name=salutation]')).toHaveValue('');
  await expect(page.locator('[name=job_title]')).toHaveValue('Principal Engineer');
});

test('answers authorization and sponsorship with opposite values', async ({ page }) => {
  await page.evaluate(() => window.__fieldwise.run());

  // Worded near-identically, opposite meaning. Answering both the same way
  // is how an application contradicts itself.
  await expect(page.locator('[name=work_authorized]')).toHaveValue('Yes');
  await expect(page.locator('[name=requires_sponsorship]')).toHaveValue('No');
});

test('picks the right option from a trap-laden select', async ({ page }) => {
  await page.evaluate(() => window.__fieldwise.run());

  // Not the Minor Outlying Islands.
  await expect(page.locator('[name=country]')).toHaveValue('United States of America');
  // Not West Virginia.
  await expect(page.locator('[name=state]')).toHaveValue('Massachusetts');
});

declare global {
  interface Window {
    __fieldwise: {
      run: () => {
        filled: { id: string; key: string; label: string; value: string; confidence: string }[];
        failed: { id: string; key: string; label: string; reason: string }[];
        denied: { id: string; label: string; reason: string }[];
        skipped: { id: string; label: string; reason: string }[];
        unmatched: { id: string; label: string }[];
      };
    };
    __forceRender: () => void;
  }
}
