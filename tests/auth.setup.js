// @ts-check
/**
 * WP-Admin authentication setup.
 *
 * Logs into the YLHQ WP-Admin via the standard /wp-login.php form and
 * persists the resulting browser session (cookies + localStorage) to
 * `.auth/user.json`. Projects that depend on `setup-wp-admin` reuse
 * that session via `use.storageState` in playwright.config.js.
 *
 * Credential env vars:
 *   - `WP_USER` / `WP_PASS` are the canonical names (used by
 *     `tests/yellowletterhq/accuzip-verification.spec.js` and
 *     documented in `.env.example`).
 *   - `WP_ADMIN_USERNAME` / `WP_ADMIN_PASSWORD` are accepted as a
 *     fallback so existing scripts that use those names keep working.
 *
 * `dotenv.config()` is loaded here as a belt-and-suspenders fallback
 * so the script works when invoked directly (e.g. VS Code Playwright
 * extension, single-file debug run) without relying on the global
 * setup hook. The path is resolved relative to this file so it works
 * no matter the cwd.
 */
const { test: setup, expect } = require('@playwright/test')
const path = require('path')
const dotenv = require('dotenv')

// Load .env from the project root (two levels up from this file).
dotenv.config({ path: path.resolve(__dirname, '..', '.env') })

const authFile = '.auth/user.json'

// Build the login URL from `WP_ADMIN_URL` when available so this script
// works even if the test runner is invoked without a `baseURL` set.
// WordPress serves /wp-login.php at the site root, NOT under /wp-admin —
// /wp-admin/wp-login.php happens to also work because WordPress routes
// both paths to the same handler, but the canonical URL is the root.
// We derive the site root by stripping any trailing `/wp-admin[/...]`
// from `WP_ADMIN_URL`. Falls back to the relative `/wp-login.php` path
// (which requires `baseURL` to be defined in `playwright.config.js`).
const WP_ADMIN_URL = (process.env.WP_ADMIN_URL || '').replace(/\/+$/, '')
const SITE_ROOT = WP_ADMIN_URL
  ? WP_ADMIN_URL.replace(/\/wp-admin(\/.*)?$/, '')
  : ''
const WP_LOGIN_URL = SITE_ROOT
  ? `${SITE_ROOT}/wp-login.php`
  : '/wp-login.php'

const WP_USER =
  process.env.WP_USER || process.env.WP_ADMIN_USERNAME || ''
const WP_PASS =
  process.env.WP_PASS || process.env.WP_ADMIN_PASSWORD || ''

if (!WP_USER || !WP_PASS) {
  throw new Error(
    `Missing WP_USER / WP_PASS (and no fallback in ` +
      `WP_ADMIN_USERNAME / WP_ADMIN_PASSWORD). Add credentials to ` +
      `.env (see .env.example).`,
  )
}

setup('Authenticate into WP-Admin', async ({ page }) => {
  // Give the setup test a generous overall budget — the default 30 s
  // is too tight for a slow first paint on /wp-login.php, which loads
  // GTM and the social-login widget.
  setup.setTimeout(120_000)

  // Diagnostic: log credential presence at runtime so a missing env var
  // shows up in the report instead of producing an empty form submit.
  // eslint-disable-next-line no-console
  console.log(
    `[auth.setup] credentials: user=${JSON.stringify(WP_USER)} ` +
      `passLen=${WP_PASS.length}`,
  )
  if (!WP_USER || !WP_PASS) {
    throw new Error(
      `[auth.setup] Credentials empty at runtime — check that .env ` +
        `is loaded and WP_USER / WP_PASS are set.`,
    )
  }

  // Wait for the full `load` event (not just `domcontentloaded`) so
  // WP-Admin's bundled `login-forms.js` is guaranteed to have parsed
  // before we touch the form. WP's `pwdset` listener binds to
  // `#user_pass` and replaces the input node when it hydrates; if we
  // fill before that hydration finishes, the value lands on the
  // original (soon-to-be-removed) node and `inputValue()` reads empty.
  // The default `load` event can be slow on WP-Admin because it pulls
  // in GTM and a social-login widget — use the `commit` waitUntil so
  // we balance hydration timing against the slow-asset risk.
  await page.goto(WP_LOGIN_URL, { waitUntil: 'commit' })

  // Wait for both inputs to render before filling. Use the Locator
  // `.fill(...)` form (rather than the page-level `page.fill(...)`) so
  // Playwright auto-waits for the element to be editable, and pass the
  // value as an explicit argument.
  const userLogin = page.locator('#user_login')
  const userPass = page.locator('#user_pass')
  await userLogin.waitFor({ state: 'visible', timeout: 60_000 })
  await userPass.waitFor({ state: 'visible', timeout: 60_000 })

  // Give WP's login JS a moment to fully attach its `pwdset` listener
  // and any DOM-replacement hooks. A short, deterministic wait here
  // is cheaper than retrying on every CI run.
  await page.waitForLoadState('load')

  await userLogin.fill(WP_USER)

  // Type the password as real keystrokes (`pressSequentially`) instead
  // of `fill()`. WP-Admin's `pwdset` listener only syncs the password
  // input's value to its replacement node on true keypress events —
  // `fill()` dispatches synthetic `input` events that don't trigger
  // that listener, so the value disappears when the form hydrates.
  // The small `delay` mimics human typing and avoids any future rate
  // limits WP might add.
  await userPass.click()
  await userPass.pressSequentially(WP_PASS, { delay: 20 })

  // Diagnostic: re-read both inputs after fill to confirm the values
  // actually landed. If this prints empty values, the env vars are
  // missing — not a Playwright timing issue.
  const userLoginValue = await userLogin.inputValue()
  const userPassValue = await userPass.inputValue()
  // eslint-disable-next-line no-console
  console.log(
    `[auth.setup] post-fill: user_login=${JSON.stringify(userLoginValue)} ` +
      `user_pass length=${userPassValue.length}`,
  )

  await page.locator('#wp-submit').click()
  await expect(page.locator('#wpadminbar')).toBeVisible({ timeout: 15_000 })
  await page.context().storageState({ path: authFile })
})