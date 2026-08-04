// @ts-check
import { defineConfig, devices } from '@playwright/test';

/**
 * Load environment variables from `.env` via the global setup hook so that
 * every spec file has access to `process.env.VALID_EMAIL` / `VALID_PASSWORD`.
 * https://github.com/motdotla/dotenv
 */
import './tests/global-setup.js';

/**
 * @see https://playwright.dev/docs/test-configuration
 *
 * Project structure:
 *
 *   order-placement
 *     └─ runs tests/yellowletterhq/full-order-flow.spec.js on Desktop
 *        Chrome. Writes the generated orderId to test-data/latest-order.json.
 *
 *   accuzip-verification
 *     └─ depends on order-placement. Runs tests/yellowletterhq/accuzip-
 *        verification.spec.js on Desktop Chrome and polls WP-Admin for
 *        the AccuZip start / completion notes that the order placement
 *        produced.
 *
 * Using explicit projects with project-scoped `testMatch` keeps each spec
 * from being picked up multiple times (the root `testDir: './tests'` would
 * otherwise include both specs in every project). `dependencies` makes
 * Playwright run `order-placement` first and *skip* `accuzip-verification`
 * if the placement test fails — by the time verification starts, the JSON
 * context file is guaranteed to contain a fresh orderId.
 */
export default defineConfig({
  testDir: './tests',
  globalSetup: './tests/global-setup.js',
  /* Run tests in files in parallel */
  fullyParallel: true,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  /* Opt out of parallel tests on CI. */
  workers: process.env.CI ? 1 : undefined,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: 'html',
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Base URL to use in actions like `await page.goto('/')`. */
    // baseURL: 'http://localhost:3000',

    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'on-first-retry',
  },

  /* Configure projects for major browsers */
  projects: [
    {
      name: 'order-placement',
      testMatch: /full-order-flow\.spec\.js$/,
      use: { ...devices['Desktop Chrome'] },
    },

    {
      name: 'accuzip-verification',
      testMatch: /accuzip-verification\.spec\.js$/,
      // Run order-placement first; skip this project if the upstream fails.
      dependencies: ['order-placement'],
      use: { ...devices['Desktop Chrome'] },
    },

    /* Run against additional browsers by uncommenting below and copying the
     * projects above with `testMatch` set to the desired spec. */
    // {
    //   name: 'order-placement-firefox',
    //   testMatch: /full-order-flow\.spec\.js$/,
    //   use: { ...devices['Desktop Firefox'] },
    // },
    // {
    //   name: 'accuzip-verification-firefox',
    //   testMatch: /accuzip-verification\.spec\.js$/,
    //   dependencies: ['order-placement-firefox'],
    //   use: { ...devices['Desktop Firefox'] },
    // },
  ],

  /* Run your local dev server before starting the tests */
  // webServer: {
  //   command: 'npm run start',
  //   url: 'http://localhost:3000',
  //   reuseExistingServer: !process.env.CI,
  // },
});
