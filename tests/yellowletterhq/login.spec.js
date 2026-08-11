// @ts-check
const { test, expect } = require('@playwright/test')
const path = require('path')
const dotenv = require('dotenv')
const { notifyDiscord, formatPacificTimestamp } = require('../../utils/discordNotifier')

const LOGIN_URL =
  'https://www.yellowletterhq.com/products-03-listsource-leads-membership/my-account/'

/**
 * Credentials are read from environment variables.
 *
 * `tests/global-setup.js` loads `.env` before any spec runs, so normally
 * `process.env.VALID_EMAIL` / `VALID_PASSWORD` are populated by the time
 * this file is evaluated. We also call `dotenv.config()` here as a
 * belt-and-suspenders fallback so the spec still works when invoked
 * directly (e.g. via the VS Code Playwright extension, which can load
 * spec files without running the project's globalSetup). The path is
 * resolved relative to this file so it works no matter the cwd.
 *
 * See `.env.example` for the expected keys.
 */

dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env') })

const VALID_EMAIL = requireEnv('VALID_EMAIL')
const VALID_PASSWORD = requireEnv('VALID_PASSWORD')

function requireEnv(/** @type {string} */ key) {
  const value = process.env[key]
  if (!value) {
    throw new Error(
      `Missing required environment variable ${key}. ` +
        `Create a .env file in the project root (copy .env.example) ` +
        `and set ${key} there.`,
    )
  }
  return value
}

test.beforeEach(async ({ page }) => {
  await page.goto(LOGIN_URL)
  // Wait for the login form to render before each test.
  await expect(page.locator('#username')).toBeVisible()
})

test.describe('Yellow Letter HQ – My Account Login', () => {
  test('logs in successfully with valid credentials', async ({ page }) => {
    await page.locator('#username').fill(VALID_EMAIL)
    await page.locator('#password').fill(VALID_PASSWORD)
    await page.locator('button[name="login"]').click()

    // After login, the Log in button should disappear.
    await expect(page.locator('button[name="login"]')).toBeHidden()
    await expect(page).toHaveURL(/my-account/)

    // Best-effort Discord notification. `notifyDiscord` swallows its own
    // errors and never throws, so a Discord outage cannot fail the test.
    // Timestamp formatted in America/Los_Angeles (San Diego) — the
    // clock YLHQ's servers run on — with live TZ abbreviation (PDT/PST).
    await notifyDiscord(
      `✅ [SUCCESS] User logged in successfully at ${formatPacificTimestamp()}`,
    )
  })

  test('rejects login with an invalid password', async ({ page }) => {
    await page.locator('#username').fill(VALID_EMAIL)
    await page.locator('#password').fill('WrongPassword123!')
    await page.locator('button[name="login"]').click()

    // WooCommerce surfaces an inline error inside <ul class="woocommerce-error">.
    const error = page.locator('.woocommerce-error, .woocommerce-notice--error')
    await expect(error).toBeVisible()
    await expect(error).toContainText(/incorrect|invalid|error/i)

    // Stay on the same login page.
    await expect(page).toHaveURL(/my-account/)
    await expect(page.locator('#username')).toBeVisible()
  })

  test('rejects login with an unregistered email', async ({ page }) => {
    await page.locator('#username').fill('nobody+test@example.com')
    await page.locator('#password').fill('SomePassword123')
    await page.locator('button[name="login"]').click()

    const error = page.locator('.woocommerce-error, .woocommerce-notice--error')
    await expect(error).toBeVisible()
    await expect(page.locator('#username')).toBeVisible()
  })

  test('rejects login with empty username and password', async ({ page }) => {
    // This WooCommerce form does not set the HTML `required` attribute, so
    // server-side validation is what surfaces the error.
    await expect(page.locator('#username')).not.toHaveAttribute('required', '')
    await expect(page.locator('#password')).not.toHaveAttribute('required', '')

    await page.locator('button[name="login"]').click()

    const error = page.locator('.woocommerce-error, .woocommerce-notice--error')
    await expect(error).toBeVisible()
    await expect(page.locator('#username')).toBeVisible()
  })

  test('rejects login with empty password only', async ({ page }) => {
    await page.locator('#username').fill(VALID_EMAIL)
    await page.locator('button[name="login"]').click()

    const error = page.locator('.woocommerce-error, .woocommerce-notice--error')
    await expect(error).toBeVisible()
    await expect(page.locator('#username')).toBeVisible()
  })

  test('rejects login with empty username only', async ({ page }) => {
    await page.locator('#password').fill(VALID_PASSWORD)
    await page.locator('button[name="login"]').click()

    const error = page.locator('.woocommerce-error, .woocommerce-notice--error')
    await expect(error).toBeVisible()
    await expect(page.locator('#username')).toBeVisible()
  })

  test('remember-me checkbox toggles and submits with it checked', async ({ page }) => {
    const remember = page.locator('#rememberme')
    await expect(remember).not.toBeChecked()
    await remember.check()
    await expect(remember).toBeChecked()

    await page.locator('#username').fill(VALID_EMAIL)
    await page.locator('#password').fill(VALID_PASSWORD)
    await page.locator('button[name="login"]').click()

    await expect(page.locator('button[name="login"]')).toBeHidden()
  })

  test('password field is masked (type=password)', async ({ page }) => {
    const type = await page.locator('#password').getAttribute('type')
    expect(type).toBe('password')
  })

  test('username field has autocomplete=username', async ({ page }) => {
    await expect(page.locator('#username')).toHaveAttribute(
      'autocomplete',
      'username',
    )
    await expect(page.locator('#password')).toHaveAttribute(
      'autocomplete',
      'current-password',
    )
  })

  test('forgot-password link is present and navigates correctly', async ({ page }) => {
    const lostPassword = page.locator('a[href$="/my-account/lost-password/"]')
    await expect(lostPassword).toBeVisible()
    await lostPassword.click()
    await expect(page).toHaveURL(
      'https://www.yellowletterhq.com/products-03-listsource-leads-membership/my-account/lost-password/',
    )
  })

  test('register link is present and navigates correctly', async ({ page }) => {
    const register = page.locator('a[href$="my-account/?action=register"]')
    await expect(register).toBeVisible()
    await register.click()
    await expect(page).toHaveURL(
      'https://www.yellowletterhq.com/products-03-listsource-leads-membership/my-account/?action=register',
    )
  })
})