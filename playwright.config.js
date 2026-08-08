// @ts-check
import 'dotenv/config';
import { defineConfig, devices } from '@playwright/test';

/**
 * Load environment variables from `.env` so that every spec file has access
 * to `process.env.WP_ADMIN_USERNAME` / `WP_ADMIN_PASSWORD` (used by the
 * auth setup project) and `VALID_EMAIL` / `VALID_PASSWORD` (used by tests).
 * https://github.com/motdotla/dotenv
 */
import './tests/global-setup.js';

/**
 * @see https://playwright.dev/docs/test-configuration
 *
 * Project structure (two parallel auth chains + a standalone suite):
 *
 *   setup-storefront
 *     └─ runs tests/storefront-auth.setup.js to log into the
 *        WooCommerce storefront and save the session to
 *        .auth/storefront.json.
 *
 *   setup-wp-admin
 *     └─ runs tests/auth.setup.js to log into WP-Admin and save the
 *        session to .auth/user.json.
 *
 *   storefront-tests
 *     └─ depends on setup-storefront. Reuses .auth/storefront.json to
 *        skip UI login. Runs tests/yellowletterhq/full-order-flow.spec.js
 *        on Desktop Chrome and writes the generated orderId to
 *        test-data/latest-order.json.
 *
 *   admin-tests
 *     └─ depends on setup-wp-admin. Reuses .auth/user.json. Runs
 *        tests/yellowletterhq/accuzip-verification.spec.js on Desktop
 *        Chrome and polls WP-Admin for the AccuZip start / completion
 *        notes that the storefront flow produced.
 *
 *   standalone-tests
 *     └─ NO dependencies, NO storageState. Runs tests/yellowletterhq/
 *        login.spec.js so it can exercise the actual storefront login
 *        UI (rejections, masking, forgot-password link, etc.).
 *
 * Using explicit projects with project-scoped `testMatch` keeps each
 * spec from being picked up multiple times. The two `setup-*` projects
 * are pure session-bootstrap (their `testMatch` is `.*\.setup\.js$`);
 * the three real projects each match exactly one spec.
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
    baseURL: process.env.WP_ADMIN_URL
      ? process.env.WP_ADMIN_URL.replace(/\/wp-admin\/?$/, '')
      : 'https://www.yellowletterhq.com',

    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'on-first-retry',
  },

  /* Configure projects for major browsers */
  projects: [
    /* Auth-setup projects. Each runs one .setup.js script, saves its
     * storageState file, and exits. Downstream projects declare the
     * appropriate setup-* project in `dependencies` to gate themselves. */
    {
      name: 'setup-wp-admin',
      testMatch: /auth\.setup\.js$/,
    },

    {
      name: 'setup-storefront',
      testMatch: /storefront-auth\.setup\.js$/,
    },

    /* Auth-aware consumer projects. Each depends on the setup project
     * that produces its storageState file. */
    {
      name: 'storefront-tests',
      testMatch: /full-order-flow\.spec\.js$/,
      use: {
        ...devices['Desktop Chrome'],
        storageState: '.auth/storefront.json',
      },
      dependencies: ['setup-storefront'],
    },

    {
      name: 'admin-tests',
      testMatch: /accuzip-verification\.spec\.js$/,
      use: {
        ...devices['Desktop Chrome'],
        storageState: '.auth/user.json',
      },
      dependencies: ['setup-wp-admin'],
    },

    /* Standalone project. No auth setup, no storageState — login.spec.js
     * must drive the storefront login UI itself so it can assert on the
     * form (rejections, masking, autocomplete, forgot-password link, etc.). */
    {
      name: 'standalone-tests',
      testMatch: /login\.spec\.js$/,
      use: { ...devices['Desktop Chrome'] },
    },

    /* Run against additional browsers by uncommenting below and copying
     * the projects above with `testMatch` set to the desired spec. */
    // {
    //   name: 'storefront-tests-firefox',
    //   testMatch: /full-order-flow\.spec\.js$/,
    //   use: {
    //     ...devices['Desktop Firefox'],
    //     storageState: '.auth/storefront.json',
    //   },
    //   dependencies: ['setup-storefront'],
    // },
    // {
    //   name: 'admin-tests-firefox',
    //   testMatch: /accuzip-verification\.spec\.js$/,
    //   use: {
    //     ...devices['Desktop Firefox'],
    //     storageState: '.auth/user.json',
    //   },
    //   dependencies: ['setup-wp-admin'],
    // },
    // {
    //   name: 'standalone-tests-firefox',
    //   testMatch: /login\.spec\.js$/,
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
