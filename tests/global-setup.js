// @ts-check
/**
 * Playwright global setup: loads variables from `.env` (if present) into
 * `process.env` before any spec file runs. The `.env` file is git-ignored;
 * `.env.example` documents the expected keys.
 */
const path = require('path')
const dotenv = require('dotenv')

module.exports = async () => {
  dotenv.config({ path: path.resolve(__dirname, '..', '.env') })
}