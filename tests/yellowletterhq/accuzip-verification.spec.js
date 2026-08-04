// @ts-check
/**
 * AccuZip Order Notes verification spec
 *
 * This spec is intentionally decoupled from the front-end storefront
 * order placement flow (`full-order-flow.spec.js`). The storefront
 * spec writes the generated `orderId` to `test-data/latest-order.json`
 * once WooCommerce's thank-you page renders. This spec reads that
 * JSON in `beforeEach` and asserts we have a valid order id to work
 * with — keeping the two specs independent so each can be re-run
 * on its own.
 */
const { test, expect } = require('@playwright/test')
const path = require('path')
const fs = require('fs')

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
      `Failed to read order context file at ${ORDER_CONTEXT_PATH}: ${err.message}`,
    )
  }
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    throw new Error(
      `Order context file at ${ORDER_CONTEXT_PATH} is not valid JSON: ${err.message}`,
    )
  }
  if (!parsed || typeof parsed.orderId !== 'string' || parsed.orderId.trim() === '') {
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

test.beforeEach(() => {
  // Read the orderId up front so the test body can start with it.
  // The assertion inside the test guards against an empty/missing id;
  // beforeEach also surfaces clearer errors when the JSON is malformed.
  readLatestOrder()
})

test('AccuZip verification – order notes for latest storefront order', async ({
  page,
  request,
}) => {
  test.setTimeout(300_000) // 5 min – AccuZip polling/verification can be slow

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

  // TODO: AccuZip Order Notes verification logic will be added here.
})