// @ts-check
/**
 * AccuZip Order Notes verification spec
 *
 * This spec is intentionally decoupled from the front-end storefront
 * order placement flow (`full-order-flow.spec.js`). The storefront
 * spec writes the generated `orderId` to `test-data/latest-order.json`
 * once WooCommerce's thank-you page renders. This spec reads that
 * JSON in `beforeEach`, opens the order edit page directly (auth is
 * supplied by the `setup` project's storageState), and polls for the
 * AccuZip "Started at:" and "Completed at:" notes that the AccuZip2
 * background worker appends to the order.
 *
 * Two-stage polling:
 *   1. Wait up to 25 minutes for the "Accuzip Started at:" note.
 *   2. Wait up to 20 minutes (from start-detection) for the
 *      "Accuzip Completed at:" note.
 *
 * Worst-case wall-clock is 25 + 20 = 45 min plus assertion overhead;
 * test.setTimeout is set to 45 min 50 s to give a small margin without
 * letting a stuck worker run forever.
 *
 * Polling is `page.reload()` every 30 s. We could refresh only the
 * `.note_content` container, but a full reload is simpler and avoids
 * races with WP-Admin's note AJAX handlers — the cost is one extra
 * round-trip every 30 s, which is negligible against a 25-min budget.
 *
 * The order page URL is derived from `WP_ADMIN_URL` + the standard
 * WooCommerce order-edit query: `post.php?post=${orderId}&action=edit`.
 *
 * Authentication: this spec no longer logs in. The `setup` project
 * (tests/auth.setup.js) authenticates into WP-Admin once before any
 * project runs and saves the session to `.auth/user.json`. Both
 * `order-placement` and `accuzip-verification` projects consume that
 * storageState via `playwright.config.js`, so this spec navigates
 * directly to the order edit URL.
 */
const { test, expect } = require('@playwright/test')
const path = require('path')
const fs = require('fs')
const dotenv = require('dotenv')
const {
  notifyDiscord,
  formatPacificTimestamp,
} = require('../../utils/discordNotifier')

// Load .env from the project root. globalSetup normally does this, but
// loading it here too lets the spec work when invoked directly (e.g.
// VS Code Playwright extension, single-file debug runs).
dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env') })

// -----------------------------------------------------------------
// ENV
// -----------------------------------------------------------------
// WP_ADMIN_URL is required (it's the base URL we navigate to).
const WP_ADMIN_URL = requireEnv('WP_ADMIN_URL')

function requireEnv(/** @type {string} */ key) {
  const value = process.env[key]
  if (!value) {
    throw new Error(
      `Missing required environment variable ${key}. ` +
        `Add it to .env (copy .env.example for the expected keys).`,
    )
  }
  return value
}

/**
 * Extract a human-readable message from an unknown thrown value.
 * Under `@ts-check`, `catch (err)` types `err` as `unknown` (per
 * TS 4.4+ `useUnknownInCatchVariables`), so we can't read `.message`
 * directly. This helper narrows the common cases without forcing a
 * typed throw across the file.
 *
 * @param {unknown} err
 */
function errorMessage(err) {
  if (err instanceof Error) return err.message
  if (typeof err === 'string') return err
  try {
    return JSON.stringify(err)
  } catch (_) {
    return String(err)
  }
}

// -----------------------------------------------------------------
// CONTEXT FILE
// -----------------------------------------------------------------
/** Absolute path to the JSON context file produced by the storefront spec. */
const ORDER_CONTEXT_PATH = path.join(
  __dirname,
  '..',
  '..',
  'test-data',
  'latest-order.json',
)

/**
 * Read and parse `test-data/latest-order.json`. Throws a descriptive
 * error if the file is missing, unreadable, or contains an empty
 * `orderId` — that signals the upstream storefront flow never ran (or
 * failed before reaching the thank-you page).
 *
 * @returns {{ orderId: string, createdAt: string }}
 */
function readLatestOrder() {
  if (!fs.existsSync(ORDER_CONTEXT_PATH)) {
    throw new Error(
      `Order context file not found at ${ORDER_CONTEXT_PATH}. ` +
        `Run the storefront flow (full-order-flow.spec.js) first so it ` +
        `can write the generated orderId to this file.`,
    )
  }
  let raw
  try {
    raw = fs.readFileSync(ORDER_CONTEXT_PATH, 'utf8')
  } catch (err) {
    throw new Error(
      `Failed to read order context file at ${ORDER_CONTEXT_PATH}: ${errorMessage(err)}`,
    )
  }
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    throw new Error(
      `Order context file at ${ORDER_CONTEXT_PATH} is not valid JSON: ${errorMessage(err)}`,
    )
  }
  if (
    !parsed ||
    typeof parsed.orderId !== 'string' ||
    parsed.orderId.trim() === ''
  ) {
    throw new Error(
      `Order context file at ${ORDER_CONTEXT_PATH} does not contain a valid ` +
        `orderId. Re-run full-order-flow.spec.js to regenerate it.`,
    )
  }
  return {
    orderId: parsed.orderId,
    createdAt: parsed.createdAt || '',
  }
}

// -----------------------------------------------------------------
// POLLING CONFIG
// -----------------------------------------------------------------
/** Prefix the AccuZip plugin uses for the "processing started" note. */
const START_NOTE_PREFIX = 'Accuzip Started at:'
/** Prefix the AccuZip plugin uses for the "processing completed" note. */
const COMPLETION_NOTE_PREFIX = 'Accuzip Completed at:'
/** Container `<div class="note_content"><p>...</p></div>` per WP/WooCommerce. */
const NOTE_CONTENT_SELECTOR = '.note_content'
/** How long to wait between polls. */
const POLL_INTERVAL_MS = 30_000
/** Stage 1 budget: wait this long for the start note. */
const STAGE_1_TIMEOUT_MS = 25 * 60 * 1000
/** Stage 2 budget: wait this long (from start-detection) for the completion note. */
const STAGE_2_TIMEOUT_MS = 20 * 60 * 1000

/**
 * Build the WP-Admin order-edit URL for a given order id.
 * @param {string} orderId
 */
function orderEditUrl(orderId) {
  return `${WP_ADMIN_URL}/post.php?post=${orderId}&action=edit`
}

/**
 * Extract the timestamp portion of a note's `<p>` text by stripping
 * the known prefix. Example input: "Accuzip Started at: August 3, 2026 at 8:29 pm"
 * Returns: "August 3, 2026 at 8:29 pm"
 *
 * @param {string} rawText
 * @param {string} prefix
 */
function extractTimestamp(rawText, prefix) {
  if (!rawText) return ''
  const stripped = rawText.replace(prefix, '').trim()
  return stripped
}

/**
 * Poll the order edit page every `POLL_INTERVAL_MS` until a `.note_content`
 * whose text contains `prefix` is found, or until `deadlineMs` elapses.
 *
 * Returns the extracted timestamp and the matched locator on success.
 * On timeout, returns `null` for both — caller is responsible for
 * deciding whether to throw (which it does, in both stages of the test).
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} prefix
 * @param {string} noteKind  // "start" or "completion" — purely for log output
 * @param {number} deadlineMs  // absolute epoch-ms deadline
 * @param {string} orderId
 * @returns {Promise<{ timestamp: string, locator: import('@playwright/test').Locator } | null>}
 */
async function pollForNote(page, prefix, noteKind, deadlineMs, orderId) {
  let pollIndex = 0
  while (Date.now() < deadlineMs) {
    pollIndex += 1
    const remainingMs = Math.max(0, deadlineMs - Date.now())
    const remainingMin = Math.floor(remainingMs / 60_000)
    const remainingSec = Math.floor((remainingMs % 60_000) / 1_000)
    // eslint-disable-next-line no-console
    console.log(
      `[AccuZip] Poll #${pollIndex} for ${noteKind} note ` +
        `(Order #${orderId}); ${remainingMin}m ${remainingSec}s remaining.`,
    )

    // Reload the page so we observe the latest server-side notes.
    try {
      await page.reload({ waitUntil: 'domcontentloaded' })
    } catch (err) {
      // eslint-disable-next-line no-console
      console.log(
        `[AccuZip] Reload errored during poll #${pollIndex} for ${noteKind}: ` +
          `${errorMessage(err)}. Continuing to next tick.`,
      )
      await page.waitForTimeout(POLL_INTERVAL_MS)
      continue
    }

    // Wait for the notes panel to render before probing it. The order
    // edit page renders .note_content once WP-Admin has hydrated the
    // WooCommerce order meta box; without this, the first poll races.
    await page
      .waitForSelector(NOTE_CONTENT_SELECTOR, { timeout: 30_000 })
      .catch(() => null)

    const candidate = page
      .locator(NOTE_CONTENT_SELECTOR, { hasText: prefix })
      .first()
    if ((await candidate.count()) > 0) {
      // `hasText` already filters; if count > 0 we know the locator
      // is attached. Reading text directly is fine — the order page
      // is server-rendered so the <p> text is fully populated on load.
      const raw = (await candidate.textContent()) || ''
      const timestamp = extractTimestamp(raw, prefix)
      // eslint-disable-next-line no-console
      console.log(
        `[AccuZip] ${noteKind} note matched (raw="${raw.trim()}") ` +
          `→ timestamp="${timestamp}"`,
      )
      return { timestamp, locator: candidate }
    }

    // No match yet — wait the poll interval before trying again.
    // Skip the wait if we'd exceed the deadline anyway.
    if (Date.now() + POLL_INTERVAL_MS > deadlineMs) break
    await page.waitForTimeout(POLL_INTERVAL_MS)
  }
  return null
}

// -----------------------------------------------------------------
// TEST HOOKS
// -----------------------------------------------------------------
test.beforeEach(() => {
  // Read the orderId up front so the test body can start with it.
  // The assertion inside the test guards against an empty/missing id;
  // beforeEach also surfaces clearer errors when the JSON is malformed.
  readLatestOrder()
})

test('AccuZip verification – start + completion notes for latest storefront order', async ({
  page,
}) => {
  // 45 min 50 s — fits 25 + 20 worst case (45 min exactly) with a
  // small margin for assertion overhead. Auth is handled by the
  // `setup` project via storageState, so no login budget is needed.
  test.setTimeout(2_750_000)

  const { orderId, createdAt } = readLatestOrder()

  // Defensive assertion: a valid orderId must be present before we
  // attempt any AccuZip work. (readLatestOrder already throws, but we
  // also assert here so the test report shows a passing expectation
  // rather than an uncaught exception.)
  expect(orderId).toBeTruthy()
  expect(orderId.trim()).not.toBe('')

  // eslint-disable-next-line no-console
  console.log(
    `[accuzip-verification] Verifying order ${orderId} (placed at ${createdAt})`,
  )

  // -----------------------------------------------------------------
  // NAVIGATE DIRECTLY TO ORDER EDIT PAGE (auth via storageState)
  // -----------------------------------------------------------------
  await page.goto(orderEditUrl(orderId), { waitUntil: 'domcontentloaded' })
  // Wait for the notes panel to render before polling starts.
  await page
    .waitForSelector(NOTE_CONTENT_SELECTOR, { timeout: 60_000 })
    .catch(() => null)

  // -----------------------------------------------------------------
  // VERIFICATION (wrapped for Discord notifications)
  // -----------------------------------------------------------------
  // Stage 1 + Stage 2 polling + final assertions all live inside a
  // try/catch so we can fire a Discord alert on timeout or failure.
  // `currentStage` lets the failure message identify which stage
  // failed (operators want to know whether the worker is stuck or
  // whether processing stalled mid-run). The catch re-throws so
  // Playwright still marks the test as failed — `notifyDiscord` is
  // best-effort only.
  let currentStage = 'init'
  try {
    // -----------------------------------------------------------------
    // STAGE 1 — wait for "Accuzip Started at:" (≤25 min)
    // -----------------------------------------------------------------
    currentStage = 'stage 1 (start note)'
    const stage1Deadline = Date.now() + STAGE_1_TIMEOUT_MS
    // eslint-disable-next-line no-console
    console.log(
      `[AccuZip] Stage 1: polling for start note (≤25 min) for Order #${orderId}.`,
    )

    const startResult = await pollForNote(
      page,
      START_NOTE_PREFIX,
      'start',
      stage1Deadline,
      orderId,
    )
    if (!startResult) {
      throw new Error(
        `FAIL: AccuZip Start Note was not generated within 25 minutes for ` +
          `Order #${orderId}. AccuZip queue (AccuZip2 single-batch worker) ` +
          `is likely stuck.`,
      )
    }
    const { timestamp: startTimestamp, locator: startNoteLocator } = startResult
    const startDetectedAt = Date.now()

    // eslint-disable-next-line no-console
    console.log(
      `[AccuZip] Start note detected for Order #${orderId} at: ${startTimestamp}`,
    )

    // -----------------------------------------------------------------
    // STAGE 2 — wait for "Accuzip Completed at:" (≤20 min from start)
    // -----------------------------------------------------------------
    currentStage = 'stage 2 (completion note)'
    const stage2Deadline = startDetectedAt + STAGE_2_TIMEOUT_MS
    // eslint-disable-next-line no-console
    console.log(
      `[AccuZip] Stage 2: polling for completion note (≤20 min from start) ` +
        `for Order #${orderId}.`,
    )

    const completionResult = await pollForNote(
      page,
      COMPLETION_NOTE_PREFIX,
      'completion',
      stage2Deadline,
      orderId,
    )
    if (!completionResult) {
      throw new Error(
        `FAIL: AccuZip Start note was found, but Completion Note was not ` +
          `generated within 20 minutes for Order #${orderId}. AccuZip ` +
          `processing got stuck during execution.`,
      )
    }
    const {
      timestamp: completionTimestamp,
      locator: completionNoteLocator,
    } = completionResult

    // eslint-disable-next-line no-console
    console.log(
      `[AccuZip] Completion note detected successfully for Order #${orderId} ` +
        `at: ${completionTimestamp}`,
    )

    // -----------------------------------------------------------------
    // FINAL ASSERTIONS
    // -----------------------------------------------------------------
    // Explicitly assert that both note locators are visible — this gives
    // the test report a clear "passed" line per stage and protects
    // against the case where polling succeeded but the page state has
    // since changed.
    await expect(startNoteLocator).toBeVisible()
    await expect(completionNoteLocator).toBeVisible()

    // Sanity: both timestamps should be non-empty after a successful poll.
    expect(startTimestamp).toBeTruthy()
    expect(completionTimestamp).toBeTruthy()

    // Success notification — best-effort; never throws.
    await notifyDiscord(
      `✅ [ACCUZIP SUCCESS] AccuZip verification completed for Order #: ${orderId} at ${formatPacificTimestamp()}`,
    )
  } catch (error) {
    // Capture the *exact* error message. Playwright errors can carry a
    // multi-line message with the locator and timeout; truncate to 1500
    // chars so the full Discord message (prefix + reason + timestamp)
    // stays under Discord's 2000-char limit.
    const rawMessage = errorMessage(error)
    const truncated =
      rawMessage.length > 1500
        ? `${rawMessage.slice(0, 1500)}… [truncated]`
        : rawMessage

    await notifyDiscord(
      `❌ [ACCUZIP TIMEOUT/FAILED] AccuZip verification failed or timed out ` +
        `for Order #: ${orderId} at ${formatPacificTimestamp()}. ` +
        `Reason: ${currentStage} — ${truncated}`,
    )

    // Re-throw so Playwright still records this as a failure —
    // otherwise the catch would silently swallow the failure and the
    // test would be marked passed.
    throw error
  }
})
