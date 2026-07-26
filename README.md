# Yellow Letter HQ - Playwright E2E Test Automation Framework

An automated End-to-End (E2E) regression testing suite for the **Yellow Letter HQ** platform. Built using [Playwright](https://playwright.dev/) and JavaScript, this suite covers user authentication regression and the complex multi-step custom direct mail order fulfillment workflow.

---

## 🛠 Project Overview

This repository automates critical user journeys and business flows within the Yellow Letter HQ application, ensuring reliability across authentication and key order placement channels.

### Key Workflows Automated
1. **Login & Authentication Regression**
   * Verification of valid user authentication sessions.
   * Regression checks for login inputs, session persistence, and error states.

2. **End-to-End Order Placement Flow (`full-order-flow.spec.js`)**
   * **Shop Navigation:** Navigates to the Shop catalog page.
   * **Interactive Product Selection:** Interacts with 3D flip card UI components (card flipping animation) and triggers the *Shop Now* CTA.
   * **Product & Template Configuration:** Selects specific products, configures custom template radio buttons, and interacts with dynamic multi-level dropdowns.
   * **Envelope Selection:** Handles interactive element selection via direct clickable envelope preview images.
   * **Asset Upload & Data Mapping:**
     * Integrates with test data assets (`/tests/shared-assets/` directory) to upload target mailing lists via CSV.
     * Automates data column mapping to match application field requirements after upload processing.
   * **Cart & Multi-Tab Checkout:**
     * Validates *Add to Cart* action and handles browser context window management (opening/switching to new tabs).
     * Configures billing by selecting the *Invoice Me* payment method option.
     * Completes and confirms final order placement.

---

## 📁 Repository Structure

```text
playwright-ylhq-automation/
├── .claude/                   # Tool & environment configurations
├── tests/
│   ├── global-setup.js        # Global browser state / authentication pre-requisites
│   ├── shared-assets/         # Shared test data assets (e.g., sample CSV mailing lists)
│   └── yellowletterhq/
│       ├── login.spec.js      # Authentication & login regression test suite
│       └── full-order-flow.spec.js  # Complete E2E order placement automation
├── .gitignore                 # Tracked files exclusion list
├── package.json               # Node dependencies and execution scripts
├── playwright.config.js       # Playwright global execution & browser config
└── README.md                  # Project documentation
```

---

## 🚀 Getting Started

### Prerequisites

Ensure you have the following installed on your local environment:
* [Node.js](https://nodejs.org/) (v18 or higher recommended)
* [npm](https://www.npmjs.com/) (bundled with Node.js)
* Git

### Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/HassanAbbas98/playwright-ylhq-automation.git
   cd playwright-ylhq-automation
   ```

2. **Install Node dependencies:**
   ```bash
   npm install
   ```

3. **Install Playwright Browser Binaries:**
   ```bash
   npx playwright install
   ```

---

## ⚙️ Environment Configuration

1. Create a `.env` file in the root folder based on `.env.example`:
   ```bash
   cp .env.example .env
   ```
2. Define your test credentials and environment targets inside `.env`:
   ```env
   BASE_URL=https://app.yellowletterhq.com
   TEST_USER_EMAIL=your_test_email@example.com
   TEST_USER_PASSWORD=your_test_password
   ```

---

## 🧪 Executing Tests

Run all tests or specific specs using the Playwright CLI:

```bash
# Run all E2E tests in headless mode
npx playwright test

# Run tests in headed mode (visible browser UI)
npx playwright test --headed

# Run only the Login regression suite
npx playwright test tests/yellowletterhq/login.spec.js

# Run only the full order placement flow spec
npx playwright test tests/yellowletterhq/full-order-flow.spec.js

# Run tests in UI mode for interactive debugging
npx playwright test --ui
```

---

## 📊 Test Reports & Debugging

After running test runs, inspect detailed execution logs, screenshots, and step-by-step trace files:

```bash
# View HTML test report
npx playwright show-report
```

---

## 🔄 CI/CD & Development Guidelines

When contributing or updating test cases:
1. Ensure test data assets (CSV files) remain in the `/tests/shared-assets/` directory.
2. Avoid hardcoding sensitive credentials in `.spec.js` files; always utilize environment variables.
3. Keep selector locators resilient (prefer `getByRole`, `getByTestId`, or unique user-facing text).
