// @ts-check
const { test, expect } = require('@playwright/test')
const path = require('path')
const dotenv = require('dotenv')

/**
 * End-to-end test: logs in, navigates the shop, configures a Letter product,
 * uploads a CSV, maps columns, places the order via "Invoice Me", and
 * verifies the order-received page.
 *
 * Credentials are read from environment variables (loaded from `.env` by
 * tests/global-setup.js). See `.env.example` for the expected keys.
 *
 * We also call `dotenv.config()` here as a belt-and-suspenders fallback so
 * the spec works when invoked directly (e.g. `node` or a debug run) even
 * if `global-setup` hasn't run yet. The path is resolved relative to this
 * file so it works no matter where Playwright is launched from.
 */

const LOGIN_URL =
  'https://www.yellowletterhq.com/products-03-listsource-leads-membership/my-account/'
const SHOP_URL = 'https://www.yellowletterhq.com/shop/'
const PRODUCT_URL = 'https://www.yellowletterhq.com/product/letters/'

// Load .env from the project root (two levels up from this file). Silently
// ignore if missing — global-setup may have already loaded it, and we don't
// want a missing .env to throw before we can produce a useful error below.
dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env') })

// Throws at module load if the env vars are missing — better than a confusing
// login failure further down the test.
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

const CSV_FILE = path.join(
  __dirname,
  '..',
  'shared-assests',
  'test_data.csv',
)

// Columns we want to map in the YLHQ field -> CSV column mapping grid.
// (The Letters product's mapping rows don't include a "county" row, so it's
// intentionally omitted.)
const COLUMN_MAPPINGS = {
  'first name': 'FIRST NAME',
  'last name': 'LAST NAME',
  'property address': 'PROPERTY ADDRESS',
  'property city': 'PROPERTY CITY',
  'property state': 'PROPERTY STATE',
  'property zip': 'PROPERTY ZIP',
  'mailing address': 'MAILING ADDRESS',
  'mailing city': 'MAILING CITY',
  'mailing state': 'MAILING STATE',
  'mailing zip': 'MAILING ZIP',
}

test('full order flow – Letter → CSV upload → Invoice Me', async ({
  page,
}) => {
  test.setTimeout(600_000) // 10 min – order placement/processing can be slow due to multiple steps

  // -----------------------------------------------------------------
  // 1. LOGIN
  // -----------------------------------------------------------------
  await page.goto(LOGIN_URL)
  await expect(page.locator('#username')).toBeVisible()
  await page.locator('#username').fill(VALID_EMAIL)
  await page.locator('#password').fill(VALID_PASSWORD)
  await page.locator('button[name="login"]').click()
  await expect(page.locator('button[name="login"]')).toBeHidden()

  // -----------------------------------------------------------------
  // 2. NAVIGATE TO SHOP → FLIP CARD → "Letters"
  // -----------------------------------------------------------------
  await page.goto(SHOP_URL)
  await expect(page).toHaveURL(SHOP_URL)

  // Hover the Letters card so the flip-card front-face reveals "Shop Now".
  const lettersTitle = page.locator('h2.uabb-face-text-title', {
    hasText: 'Letters',
  })
  await expect(lettersTitle).toBeVisible()
  await lettersTitle.hover()

  // The Shop Now button lives on the back face of the flip card. The flip
  // is driven by CSS `:hover` on the whole `.uabb-flip-box` container, so
  // we hover the *outer* flip-box (not just the heading) to flip the card
  // and reveal "Shop Now". The shop page renders 4 cards (Letters /
  // Postcards / Real Handwritten Cards / YLHQ Services), each as a
  // `.uabb-flip-box-outter` containing exactly one Shop Now button – scope
  // to the flip-box that holds our heading.
  const lettersFlipBox = page
    .locator('.uabb-flip-box-outter')
    .filter({
      has: page.locator('h2.uabb-face-text-title', { hasText: /^Letters$/ }),
    })
    .first()
  const shopNow = lettersFlipBox.locator(
    'span.uabb-button-text.uabb-creative-button-text',
    { hasText: 'Shop Now' },
  )
  await expect(shopNow).toHaveCount(1)

  // Hover the outer flip-box (not the heading) so the CSS `:hover` rule
  // fires and the back face (with Shop Now) flips into view.
  await lettersFlipBox.hover()
  await expect(shopNow).toBeVisible()
  await shopNow.click()
  await expect(page).toHaveURL(PRODUCT_URL)

  // -----------------------------------------------------------------
  // 3. PICK THE "Check Letter" PRODUCT
  // -----------------------------------------------------------------
  // During peak/load hours the /product/letters/ page takes 5–20 seconds
  // to fully render. While it's loading the browser shows a loading bar
  // and a transient banner, "Does this proof need corrections?" (`<strong>`
  // with `display: block`), appears over the product grid. Clicking the
  // "Check Letter" product button before the page has finished loading
  // is unreliable — the click is intercepted and the templates (including
  // "Attention Check") never load.
  //
  // Two readiness signals, used together, gate the click:
  //
  //   1. The browser-level `load` event has fired. This tells us the
  //      browser's loading bar has stopped spinning for the *initial*
  //      page assets (HTML, CSS, fonts, images, scripts). Once `load`
  //      fires, the page is "fully loaded" from the browser's perspective.
  //
  //   2. The "Check Letter" button is visible. This confirms the
  //      product grid has finished rendering.
  //
  // We deliberately do NOT use `waitForLoadState('networkidle')` here —
  // YLHQ (and most WordPress/WooCommerce sites) have analytics, beacons,
  // or background polling that keeps the network busy indefinitely, so
  // `networkidle` would time out and never reach the click.
  //
  // We also do NOT wait on the "Does this proof need corrections?" banner
  // selector — that check was unreliable because the banner markup
  // changes between YLHQ releases and a missing selector would block
  // the click forever. The browser `load` event + button visibility is
  // a more robust readiness signal.
  await page.waitForLoadState('load')
  const checkLetterButton = page.locator('button.ylhq_products', {
    hasText: 'Check Letter',
  })
  await checkLetterButton.waitFor({ state: 'visible', timeout: 30_000 })
  await checkLetterButton.click()

  // -----------------------------------------------------------------
  // 4. PICK A TEMPLATE
  // -----------------------------------------------------------------
  // Templates load via AJAX after the product click. Give it room.
  const attentionCheck = page.locator('input.templates[value="Attention Check"]')
  await expect(attentionCheck).toBeAttached({ timeout: 20_000 })
  await attentionCheck.scrollIntoViewIfNeeded()
  await attentionCheck.check({ force: true })

  // -----------------------------------------------------------------
  // 5. CONFIGURATION: POSTAGE / FONT / FONT COLOR / ENVELOPE / ETC.
  // -----------------------------------------------------------------
  const postage = page.locator('select#postage')
  await expect(postage).toBeVisible()
  await postage.selectOption({
    label: 'Standard Postage (8-15 days after it is dropped off at post office)',
  })

  // Font – default already "Typed", assert that.
  const font = page.locator('select#font-selection')
  await expect(font).toHaveValue('Typed')

  // Font color -> Black
  const fontColor = page.locator('select#font-color')
  await expect(fontColor).toBeVisible()
  await fontColor.selectOption('Black')

  // Envelope image
  const envelope = page.locator('img.image-small-selgall[atr="Window White"]')
  await expect(envelope).toBeVisible()
  await envelope.click()

  // Envelope font (default Typed)
  const envelopeFont = page.locator('select#envelope-font')
  await expect(envelopeFont).toHaveValue('Typed')

  // Second page -> No
  const secondPage = page.locator('select#second_page')
  await expect(secondPage).toBeVisible()
  await secondPage.selectOption('No')

  // "Do you want to create a campaign touch?" / EOS — on this product it's
  // not a dropdown; the Easy Offer System is three checkboxes (all default
  // to unchecked = "No"). Leave them as-is.

  // Pre-returned mail: this dropdown's default depends on the product
  // configuration on the YLHQ side and has flipped between "yes"/"no" over
  // time. We don't pin it — just sanity-check it's present and leave it
  // whatever the page set it to.
  const preReturned = page.locator('select.fede_custom_option9')
  await expect(preReturned).toBeAttached()

  // Auto return mail list after 7 days — `#ylhq_select_auto_returnmail`
  // exists in the DOM but is wrapped in a hidden container on this product,
  // so it's not user-interactable here. Skip silently.

  // Day mail delivered -> ASAP
  const dayDelivered = page.locator('select#day_mail_delivered_select')
  await expect(dayDelivered).toBeVisible()
  await dayDelivered.selectOption('ASAP')

  // Calendar field appears after picking ASAP. Real id is
  // `day_mail_delivered_calendar` (name `_fede_custom_option12`).
  const startCalendar = page.locator('#day_mail_delivered_calendar')
  await expect(startCalendar).toBeVisible()
  await startCalendar.click()
  const todayCell = page.locator(
    '.ui-datepicker-calendar .ui-state-active, .ui-datepicker-today a',
  )
  if (await todayCell.first().isVisible().catch(() => false)) {
    await todayCell.first().click()
  } else {
    await startCalendar.fill('06/27/2026')
  }

  // Mail drop strategy -> "Mail All At Once" (value="no"). The plugin's
  // "How much of your mail do you want to go out?" select carries only
  // the `fede_custom_option7` class on this product — no `validation_red`.
  const mailAtOnce = page.locator('select[name="_fede_custom_option7"]')
  await expect(mailAtOnce).toBeVisible()
  await mailAtOnce.selectOption('no')

  // Order notes – there are two `_fede_custom_option2` textareas on the
  // page (`_deprecated` and `_emoji`); target the deprecated one.
  const orderNotes = page.locator(
    'textarea[name="_fede_custom_option2"].fede_custom_option2_deprecated',
  )
  await expect(orderNotes).toBeVisible()
  await orderNotes.fill('Test order note – automated by Playwright.')

  // Order name
  const orderName = page.locator('input[name="_fede_custom_option3"]')
  await expect(orderName).toBeVisible()
  await orderName.fill('Playwright Auto Order')

  // Easy button / skiptrace / auto-reorder / special paper dropdowns do not
  // exist on the Letters product — nothing to set here.

  // -----------------------------------------------------------------
  // 6. UPLOAD THE CSV
  // -----------------------------------------------------------------
  const fileInput = page.locator('input[type="file"]').first()
  await fileInput.setInputFiles(CSV_FILE)

  // Wait for the mapping modal to render. It's a `<table>` that appears
  // inside an h3 heading "Match list from file: …".
  await expect(
    page.locator('h3', { hasText: 'Match list from file:' }),
  ).toBeVisible({ timeout: 30_000 })

  // The "Remove Duplicates" toggle is checked by default; the
  // "Turn off upload tool" toggle is unchecked by default. We don't pin
  // those here since the plugin markup can change.

  // -----------------------------------------------------------------
  // 7. AUTO-FILL COLUMN MAPPING
  // -----------------------------------------------------------------
  // Each YLHQ row is a `<tr>` whose first cell is the field name and
  // whose second cell contains a `<select>` (the combobox). We scope by
  // the field name and pick the matching CSV column.
  // Map the 10 known fields by row label.
  for (const [fieldLabel, csvColumn] of Object.entries(COLUMN_MAPPINGS)) {
    const row = page
      .locator('table tr', { has: page.locator(`td:text-is("${fieldLabel}")`) })
      .first()
    const select = row.locator('select')
    if (!(await select.isVisible({ timeout: 1500 }).catch(() => false))) continue
    const current = await select.inputValue({ timeout: 1500 }).catch(() => '')
    if (current === csvColumn) continue // already auto-matched
    try {
      await select.selectOption(csvColumn, { timeout: 1500 })
    } catch (_) {
      await select
        .selectOption({ label: csvColumn }, { timeout: 1500 })
        .catch(() => {})
    }
    // Manually dispatch the change event the plugin listens for.
    await select.evaluate((el) => {
      el.dispatchEvent(new Event('change', { bubbles: true }))
    })
  }

  // Set every other select in the mapping grid to "- Leave column blank -"
  // so Proceed doesn't stay blocked on placeholder rows.
  const allSelects = page.locator('table tr td select')
  const selectCount = await allSelects.count()
  for (let i = 0; i < selectCount; i++) {
    const sel = allSelects.nth(i)
    if (!(await sel.isVisible({ timeout: 1500 }).catch(() => false))) continue
    const v = await sel.inputValue({ timeout: 1500 }).catch(() => '')
    if (v && v !== 'Select the column from your list') continue
    await sel
      .selectOption({ label: '- Leave column blank -' }, { timeout: 1500 })
      .catch(async () => {
        await sel
          .selectOption(
            { value: '- Leave column blank -' },
            { timeout: 1500 },
          )
          .catch(() => {})
      })
  }

  // -----------------------------------------------------------------
  // 7b. FILL THE MAIL-PIECE / RETURN-ADDRESS TEXT FIELDS
  // -----------------------------------------------------------------
  // The mapping grid has 6 text inputs (Name on mail piece, Phone number,
  // Return Address / City / State / Zip). Proceed stays disabled until
  // every one of these has a value. Fill them by row label.
  const TEXT_FIELD_VALUES = {
    'Name on mail piece': 'My Company LLC',
    'Phone number on mail piece': '123-456-7890',
    'Return Address': '123 Main St',
    'Return City': 'Austin',
    'Return State': 'TX',
    'Return Zip': '78701',
  }
  for (const [fieldLabel, value] of Object.entries(TEXT_FIELD_VALUES)) {
    const row = page
      .locator('table tr', { has: page.locator(`td:text-is("${fieldLabel}")`) })
      .first()
    const input = row.locator('input[type="text"], input:not([type])').first()
    if (!(await input.isVisible().catch(() => false))) continue
    const current = await input.inputValue().catch(() => '')
    if (current === value) continue
    await input.fill(value)
  }

  // Real keyboard-style interaction on Phone number – the plugin's
  // "user has interacted" watcher only fires on a true keypress chain.
  // Backspace the trailing "0" so the field's value visibly changes and
  // every relevant input/change event fires.
  const phoneInput = page
    .locator('table tr', {
      has: page.locator('td:text-is("Phone number on mail piece")'),
    })
    .locator('input')
    .first()
  if (await phoneInput.isVisible().catch(() => false)) {
    await phoneInput.click()
    await phoneInput.press('End')
    await phoneInput.press('Backspace')
  }

// -----------------------------------------------------------------
  // 8. PROCEED → PROCESSING → CONTINUE → ADD TO CART
  // -----------------------------------------------------------------
  // The Proceed button is the one inside the mapping table's "Proceed"
  // row – scope to that table to avoid matching other buttons on the page.
  const proceed = page
    .locator('table tr', { has: page.locator('button:text-is("Proceed")') })
    .locator('button')
    .first()
  await expect(proceed).toBeAttached({ timeout: 30_000 })
  // Wait for the disabled attribute to be removed.
  await expect
    .poll(async () => proceed.isEnabled().catch(() => false), {
      timeout: 30_000,
      intervals: [500],
    })
    .toBe(true)
  await proceed.click()

  // Processing popup – wait for it to clear (5-15s typical, give it 120s).
  await page.waitForTimeout(5_000)

  const continueBtn = page.locator('#fede_id_info_button_okay', {
    hasText: 'Continue',
  })
  await expect(continueBtn).toBeVisible({ timeout: 120_000 })
  await continueBtn.click()

  const addToCart = page.locator(
    'button.single_add_to_cart_button, button[name="add-to-cart"]',
  )
  await expect(addToCart).toBeVisible()

  // Add-to-cart can either navigate the same tab to /cart/ or open a new
  // tab. Race a "new tab" event against a same-tab navigation; whichever
  // happens first wins. Give it a few seconds to settle so any redirect
  // finishes before we probe for checkout elements.
  let checkoutPage = page
  const newTabPromise = page
    .context()
    .waitForEvent('page', { timeout: 8_000 })
    .catch(() => null)
  await addToCart.click()
  const newTab = await newTabPromise
  if (newTab) {
    checkoutPage = newTab
    await checkoutPage.waitForLoadState('domcontentloaded')
  } else {
    // Same-tab flow – wait for the URL to land on cart/checkout.
    await page
      .waitForURL(/\/(cart|checkout)\//, { timeout: 30_000 })
      .catch(() => {})
    await page.waitForLoadState('domcontentloaded')
  }

  // Brief settle so any modals/redirects finish rendering.
  await checkoutPage.waitForTimeout(3_000)

  // -----------------------------------------------------------------
  // 9. CHECKOUT: COUPON POPUP → INVOICE ME → PLACE ORDER
  // -----------------------------------------------------------------
  // Coupon popup: choose "No, thanks".
  const couponNo = checkoutPage.locator('button[data-dismiss="modal"]', {
    hasText: /No/i,
  })
  if (await couponNo.isVisible().catch(() => false)) {
    await couponNo.click()
  }

  // Invoice Me payment radio is checked by default – confirm it.
  const invoiceRadio = checkoutPage.locator('#payment_method_invoiceme')
  await expect(invoiceRadio).toBeChecked()

  // Place order.
  const placeOrder = checkoutPage.locator('button#myBtn.btn', {
    hasText: /Place order/i,
  })
  await expect(placeOrder).toBeVisible()
  await placeOrder.click()

  // Confirmation popup: "YES, PLEASE PROCEED".
  const proceedPopup = checkoutPage.locator('a.popup-cerrar', {
    hasText: /YES, PLEASE PROCEED/i,
  })
  await expect(proceedPopup).toBeVisible({ timeout: 60_000 })
  await proceedPopup.click()

  // -----------------------------------------------------------------
  // 10. ASSERT ORDER RECEIVED
  // -----------------------------------------------------------------
  const orderDetails = checkoutPage.locator(
    'ul.woocommerce-order-overview.woocommerce-thankyou-order-details.order_details',
  )
  await expect(orderDetails).toBeVisible({ timeout: 180_000 })

  await expect(
    checkoutPage.locator(
      '.woocommerce-order-overview__order.order strong',
    ),
  ).toBeVisible()
  await expect(
    checkoutPage.locator(
      '.woocommerce-order-overview__payment-method.method strong',
    ),
  ).toHaveText('Invoice Me')
  // NOTE: the billing email shown on the order-received page varies
  // (login email, billing email, or whatever the WooCommerce session has).
  // We intentionally don't pin it here since it's flaky across runs.
})