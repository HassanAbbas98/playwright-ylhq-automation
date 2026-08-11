// @ts-check
/**
 * Discord notifier — posts a plain-text message to a Discord channel via
 * an Incoming Webhook.
 *
 * Credentials:
 *   `DISCORD_WEBHOOK_URL` is read from `process.env` (populated by
 *   `tests/global-setup.js` from `.env`). The webhook URL is treated as a
 *   secret and is NEVER hardcoded in this file or in any spec.
 *
 * Failure philosophy:
 *   Discord is a *notification* channel, not part of the test signal. A
 *   transient network glitch, a rate-limit, or a missing webhook must not
 *   break the test run. Every error path is caught: we log a warning to
 *   the console and return `false` so the calling test can continue.
 *
 * Usage:
 *   const { notifyDiscord } = require('./utils/discordNotifier')
 *   await notifyDiscord('✅ [SUCCESS] User logged in successfully')
 */

const path = require('path')
const dotenv = require('dotenv')

// Belt-and-suspenders: load .env here too so the notifier works when
// invoked from a context that didn't run global-setup (e.g. a one-off
// script under the VS Code Playwright extension).
dotenv.config({ path: path.resolve(__dirname, '..', '.env') })

/**
 * Send a message to Discord via the configured webhook.
 *
 * @param {string} message - Plain-text message body. Discord renders
 *   this as the `content` field; basic markdown is supported.
 * @returns {Promise<boolean>} `true` if Discord accepted the message
 *   (HTTP 2xx), `false` otherwise. Never throws.
 */
async function notifyDiscord(/** @type {string} */ message) {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL

  if (!webhookUrl) {
    // No webhook configured — skip with a warning rather than failing
    // the test. This is the common case for local dev when a
    // contributor hasn't set up a Discord channel.
    console.warn(
      '[discordNotifier] DISCORD_WEBHOOK_URL is not set; skipping notification.',
    )
    return false
  }

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: message }),
    })

    if (!response.ok) {
      // Discord returns 204 on success; anything else (4xx rate-limit,
      // 5xx outage) we log but don't propagate.
      const responseBody = await response.text().catch(() => '')
      console.warn(
        `[discordNotifier] Discord responded with ${response.status} ${response.statusText}. ` +
          `Body: ${responseBody.slice(0, 200)}`,
      )
      return false
    }

    return true
  } catch (error) {
    // Network error, DNS failure, TLS issue, etc. — log and swallow so
    // the test run isn't blocked.
    const reason = error instanceof Error ? error.message : String(error)
    console.warn(
      `[discordNotifier] Failed to send Discord notification: ${reason}`,
    )
    return false
  }
}

/**
 * Build a human-readable timestamp in America/Los_Angeles (San Diego)
 * time. Matches the YLHQ server clock and auto-flips between PDT and
 * PST on the DST boundary. Output shape: `MM/DD/YYYY, HH:MM:SS TZ`
 * (e.g. `08/10/2026, 18:16:32 PDT`).
 *
 * @param {Date} [date] - Date to format. Defaults to `new Date()`.
 * @returns {string}
 */
function formatPacificTimestamp(date = new Date()) {
  return date.toLocaleString('en-US', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZoneName: 'short',
  })
}

module.exports = { notifyDiscord, formatPacificTimestamp }
