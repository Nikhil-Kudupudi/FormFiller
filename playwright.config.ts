import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false, // each test drives a persistent browser context
  forbidOnly: !!process.env.CI,
  retries: 0, // a flaky autofill test means "sometimes fills the wrong value"
  workers: 1,
  reporter: process.env.CI ? 'github' : 'list',

  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  webServer: {
    command: 'node tests/fixtures/serve.mjs',
    url: 'http://127.0.0.1:4321/health',
    reuseExistingServer: !process.env.CI,
    stdout: 'ignore',
  },
});
