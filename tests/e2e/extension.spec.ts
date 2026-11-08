import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test as base, chromium, expect, type BrowserContext } from '@playwright/test';

const here = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION = path.resolve(here, '../../.output/chrome-mv3');
/**
 * The fixture is served under a hostname the manifest actually matches.
 *
 * That matters: it exercises the real content_scripts registration rather
 * than a test-only injection path, so the manifest's host patterns are part
 * of what this suite proves.
 */
const ATS_URL = 'https://jobs.lever.co/acme/engineer/apply';
const ATS_DROPDOWN_URL = 'https://jobs.lever.co/acme/engineer/dropdowns';
const FIXTURE_ORIGIN = 'http://127.0.0.1:4321';

/**
 * The real extension, loaded unpacked into a real browser.
 *
 * Everything else in the suite drives the engine directly; this is the only
 * place the manifest, the service worker, the message routing and the side
 * panel are exercised together, so it is what proves the thing actually works
 * rather than merely compiles.
 */
const test = base.extend<{ context: BrowserContext; extensionId: string }>({
  context: async ({}, use) => {
    // An extension needs a persistent context; `browser.newContext()` will not
    // load one. `channel: 'chromium'` is what makes this work headless -- the
    // default headless shell ignores extensions entirely, and real Chrome and
    // Edge have removed the side-loading flags.
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      args: [`--disable-extensions-except=${EXTENSION}`, `--load-extension=${EXTENSION}`],
    });
    await use(context);
    await context.close();
  },
  extensionId: async ({ context }, use) => {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent('serviceworker');
    await use(new URL(worker.url()).host);
  },
});

/** Serve the local fixture under the ATS hostname the manifest matches. */
async function routeFixture(context: BrowserContext): Promise<void> {
  await context.route('https://jobs.lever.co/**', async (route) => {
    const url = new URL(route.request().url());
    // The page itself, or one of the assets it pulls. Assets resolve relative
    // to the routed path, so they are matched by basename rather than by the
    // full pathname -- otherwise '/acme/engineer/react-sim.js' would 404 and
    // the fixture would silently lose the behaviour it exists to simulate.
    const file =
      url.pathname === '/acme/engineer/apply'
        ? 'kitchen-sink.html'
        : url.pathname === '/acme/engineer/dropdowns'
          ? 'dropdowns.html'
          : url.pathname.split('/').pop();
    const upstream = await fetch(`${FIXTURE_ORIGIN}/${file}`);
    await route.fulfill({
      status: upstream.status,
      contentType: upstream.headers.get('content-type') ?? 'text/html',
      body: Buffer.from(await upstream.arrayBuffer()),
    });
  });
}

/** Seed a profile through the service worker, as the options page would. */
async function seedProfile(context: BrowserContext): Promise<void> {
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent('serviceworker');

  await worker.evaluate(async () => {
    // Runs inside the service worker, where `chrome` is the extension API.
    // Typed loosely because this closure is serialised into another realm.
    const api = (globalThis as unknown as {
      chrome: { storage: { local: { set(items: Record<string, unknown>): Promise<void> } } };
    }).chrome;
    const profile = {
      schemaVersion: 1,
      updatedAt: Date.now(),
      identity: { firstName: 'Ada', lastName: 'Lovelace' },
      contact: { email: 'ada@example.com', phone: '617-555-0101' },
      address: {
        line1: '12 Analytical Way',
        city: 'Cambridge',
        state: 'Massachusetts',
        postalCode: '02139',
        country: 'United States of America',
      },
      links: {},
      work: [],
      education: [],
      eligibility: { workAuthorized: true, requiresSponsorship: false },
      preferences: { preferredLocations: [] },
      documents: {},
      demographics: {
        enabled: false,
        gender: 'Prefer not to answer',
        race: 'Prefer not to answer',
        hispanicLatino: 'Prefer not to answer',
        veteranStatus: 'Prefer not to answer',
        disabilityStatus: 'Prefer not to answer',
      },
    };
    await api.storage.local.set({ 'profile:v1': profile });
  });
}

test('the service worker starts and registers', async ({ context, extensionId }) => {
  expect(extensionId).toMatch(/^[a-z]{32}$/);
  expect(context.serviceWorkers().length).toBeGreaterThan(0);
});

test('the options page renders the profile editor', async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);

  await expect(page.getByRole('heading', { name: 'fieldwise' })).toBeVisible();
  await expect(page.getByText('Work eligibility')).toBeVisible();
  // The two questions are kept separate on purpose; the UI must not merge them.
  await expect(page.getByText('Require visa sponsorship')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'AI fallback' })).toBeVisible();
});

test('the AI fallback is off until switched on', async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);

  const toggle = page.getByRole('checkbox', { name: /Enable the AI fallback/ });
  await expect(toggle).not.toBeChecked();
  // Nothing about a provider or a key is shown until the user opts in.
  await expect(page.getByLabel(/API key/)).toHaveCount(0);
});

test('the side panel scans a page and previews before filling', async ({
  context,
  extensionId,
}) => {
  await seedProfile(context);
  await routeFixture(context);

  const target = await context.newPage();
  await target.goto(ATS_URL);
  await target.bringToFront();

  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  // Keep the form as the active tab and drive the panel in the background.
  // A real side panel is not a tab, so it is never the active one; opening it
  // as a page here is a harness convenience, not how it ships.
  await target.bringToFront();
  await panel.getByRole('button', { name: 'Scan page' }).click();

  const fillButton = panel.getByRole('button', { name: /^Fill \d+ fields?$/ });
  await expect(fillButton).toBeVisible({ timeout: 10_000 });

  // Nothing is written until Apply: the form is still untouched.
  await expect(target.locator('#fn')).toHaveValue('');

  await fillButton.click();

  // Assert on the form, not the panel's wording: what landed in the page is
  // the thing that matters, and the read-back is what the panel reports from.
  await expect(target.locator('#fn')).toHaveValue('Ada', { timeout: 10_000 });
  await expect(target.locator('#em')).toHaveValue('ada@example.com');
  await expect(target.locator('#zip')).toHaveValue('02139');

  // The safety properties still hold through the real message path.
  await expect(target.locator('[name=password]')).toHaveValue('');
  await expect(target.locator('[name=url]')).toHaveValue('');
  await expect(target.locator('[name=agree_terms]')).not.toBeChecked();
});

test('a fill reaches framework state, not just the DOM', async ({ context, extensionId }) => {
  await seedProfile(context);
  await routeFixture(context);

  const target = await context.newPage();
  await target.goto(ATS_URL);
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await target.bringToFront();

  await panel.getByRole('button', { name: 'Scan page' }).click();
  await panel.getByRole('button', { name: /^Fill \d+ fields?$/ }).click();

  // The echo renders from component state, so it stays empty if the write
  // only reached the DOM. This is the one property a content script cannot
  // achieve on its own: React tracks the last value it saw on a page-world
  // object the isolated world cannot touch, so the write has to be delegated
  // to a MAIN-world helper. Earlier suites missed this because their probe
  // already ran in the page's own world.
  await expect(target.locator('#react-echo')).toHaveText('Ada', { timeout: 10_000 });
  await expect(target.locator('#react-field')).toHaveValue('Ada');
});

test('undo puts the form back', async ({ context, extensionId }) => {
  await seedProfile(context);
  await routeFixture(context);

  const target = await context.newPage();
  await target.goto(ATS_URL);
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  await target.bringToFront();
  await panel.getByRole('button', { name: 'Scan page' }).click();
  await panel.getByRole('button', { name: /^Fill \d+ fields?$/ }).click();
  await expect(target.locator('#fn')).toHaveValue('Ada');

  await panel.getByRole('button', { name: 'Undo' }).click();

  // A programmatic write leaves no entry in the browser's own undo stack, so
  // this is the only thing standing between a user and a wiped draft.
  await expect(target.locator('#fn')).toHaveValue('');
  await expect(target.locator('#em')).toHaveValue('');
});

test('fills a custom dropdown through the extension', async ({ context, extensionId }) => {
  await seedProfile(context);
  await routeFixture(context);

  const target = await context.newPage();
  await target.goto(ATS_DROPDOWN_URL);
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await target.bringToFront();

  await panel.getByRole('button', { name: 'Scan page' }).click();

  // "Country" and "State" are ambiguous labels, so they arrive unticked and
  // the Fill button starts disabled -- the design refusing to act on a guess.
  // Ticking one is exactly what a user does, and it is worth asserting that
  // this is the state the panel opens in.
  const fill = panel.getByRole('button', { name: /^Fill \d+ fields?$/ });
  await expect(fill).toBeVisible({ timeout: 10_000 });
  await expect(fill).toBeDisabled();

  await panel.getByRole('checkbox').first().check();
  await expect(fill).toBeEnabled();
  await fill.click();

  // The portalled, mousedown-only country widget, driven the whole way from
  // the side panel rather than by calling the engine directly.
  await expect(target.locator('#country-control .select__single-value')).toHaveText(
    'United States of America',
    { timeout: 15_000 },
  );
});
