// @ts-check
/**
 * Storefront (WooCommerce my-account) authentication setup.
 *
 * Logs into the YLHQ storefront via the standard WooCommerce login
 * form at /products-03-listsource-leads-membership/my-account/ and
 * persists the resulting browser session (cookies + localStorage) to
 * `.auth/storefront.json`. Projects that depend on `setup-storefront`
 * reuse that session via `use.storageState` in playwright.config.js,
 * so they skip the UI login.
 *
 * YLHQ's dev user (dev@yellowletterhq.com) is a WooCommerce customer,
 * so the same email/password pair works for both the storefront and
 * WP-Admin in most setups. We prefer the dedicated `STOREFRONT_USER`
 * / `STOREFRONT_PASS` env vars when set, and fall back to the existing
 * `VALID_EMAIL` / `VALID_PASSWORD` keys for backwards compatibility.
 *
 * The `login.spec.js` suite intentionally runs WITHOUT this storage
 * state so it can exercise the actual login UI (rejections, masking,
 * forgot-password link, etc.). It is wired to the `standalone-tests`
 * project which has no `dependencies` and no `storageState`.
 */
const { test: setup, expect } = require('@playwright/test')

const storefrontAuthFile = '.auth/storefront.json'

const STOREFRONT_LOGIN_URL =
  'https://www.yellowletterhq.com/products-03-listsource-leads-membership/my-account/'

const STOREFRONT_USER =
  process.env.STOREFRONT_USER || process.env.VALID_EMAIL || ''
const STOREFRONT_PASS =
  process.env.STOREFRONT_PASS || process.env.VALID_PASSWORD || ''

if (!STOREFRONT_USER || !STOREFRONT_PASS) {
  throw new Error(
    `Missing STOREFRONT_USER / STOREFRONT_PASS (and no fallback in ` +
      `VALID_EMAIL / VALID_PASSWORD). Add credentials to .env ` +
      `(see .env.example).`,
  )
}

setup('Authenticate into storefront', async ({ page }) => {
  await page.goto(STOREFRONT_LOGIN_URL)
  await expect(page.locator('#username')).toBeVisible()
  await page.locator('#username').fill(STOREFRONT_USER)
  await page.locator('#password').fill(STOREFRONT_PASS)
  await page.locator('button[name="login"]').click()
  // The login button disappears on success (matches login.spec.js).
  await expect(page.locator('button[name="login"]')).toBeHidden({
    timeout: 15_000,
  })
  await page.context().storageState({ path: storefrontAuthFile })
})