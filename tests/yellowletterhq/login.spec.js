// @ts-check
const { test, expect } = require('@playwright/test')

const LOGIN_URL =
  'https://www.yellowletterhq.com/products-03-listsource-leads-membership/my-account/'

// Credentials are read from environment variables (loaded from `.env` by
// tests/global-setup.js). See `.env.example` for the expected keys.
const VALID_EMAIL = requireEnv('VALID_EMAIL')
const VALID_PASSWORD = requireEnv('VALID_PASSWORD')

function requireEnv(/** @type {string} */ key) {
  const value = process.env[key]
  if (!value) {
    throw new Error(
      `Missing required environment variable ${key}. ` +
        `Add it to your .env file (see .env.example).`,
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