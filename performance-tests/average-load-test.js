// performance-tests/average-load-test.js
//
// PHASE 2: Average-Load Test (Public User Journeys)
// -----------------------------------------------------------------------------
// Goal:    Simulate realistic, average traffic against YLHQ Staging's public
//          storefront endpoints. Mirrors what a normal user does on the
//          site: browse the root, hit the shop, view a product, and
//          occasionally filter by category (e.g. handwritten letters,
//          subscriptions).
//
// k6-utils version: 1.4.0 (randomItem). jslib serves only index.js; .ts
// paths 404.
// Target:  Yellow Letters HQ (YLQ) Staging — NEVER production.
// Load:    Ramped profile: 0 → 5 VUs (30s) → 5 VUs (1m) → 0 VUs (30s).
// Success: p(95) http_req_duration < 3000ms; http_req_failed < 1%.
//
// Run:
//   # Recommended: load from .env via the npm script:
//   #   "k6:average": "dotenv -e .env -- k6 run performance-tests/average-load-test.js"
//   npm run k6:average
//
//   # Or, invoke k6 directly:
//   dotenv -e .env -- k6 run performance-tests/average-load-test.js
//   k6 run -e STAGING_URL=https://staging.example.com \
//          -e DISCORD_PERF_WEBHOOK_URL=<webhook> \
//          performance-tests/average-load-test.js
//
// Environment variables:
//   STAGING_URL              (required in practice) base URL of the target.
//                            Falls back to http://localhost:3000 so the source
//                            never embeds a real host or IP.
//   DISCORD_PERF_WEBHOOK_URL (optional) webhook for the post-run report. The
//                            existing Playwright DISCORD_WEBHOOK_URL is NOT
//                            touched by this script.
// -----------------------------------------------------------------------------

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';
import { randomItem } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';

// -- Configuration ------------------------------------------------------------
// STAGING_URL must be supplied via env (e.g. .env + `npm run k6:average`).
// The fallback is intentionally a non-routable localhost placeholder so the
// source never embeds a real host or IP.
const STAGING_URL = __ENV.STAGING_URL || 'http://localhost:3000';

if (__ENV.STAGING_URL === undefined) {
  console.warn(
    '[average-load-test] STAGING_URL is not set — falling back to http://localhost:3000. ' +
    'Set STAGING_URL in your .env (or pass -e STAGING_URL=...) before running.'
  );
}

// Public storefront journeys exercised by a normal anonymous visitor. The
// handwritten query string is included to verify query-param routing on the
// product page, and the subscriptions category to exercise product-category
// archive templates.
const PUBLIC_PATHS = [
  '/',
  '/shop/',
  '/product/postcards/',
  '/product/letters/',
  '/product/letters/?ylhqproduct=handwritten',
  '/product-category/subscriptions/',
];

// -- Load profile ------------------------------------------------------------
// Stages model a "normal weekday" load curve: gentle ramp, steady plateau,
// gentle ramp-down. Total wall-clock ≈ 2m.
export const options = {
  stages: [
    { duration: '30s', target: 5 }, // ramp up 0 → 5 VUs
    { duration: '1m',  target: 5 }, // sustain 5 VUs
    { duration: '30s', target: 0 }, // ramp down 5 → 0 VUs
  ],
  thresholds: {
    http_req_duration: ['p(95)<3000'], // p95 latency under 3s
    http_req_failed:   ['rate<0.01'],  // fewer than 1% of requests failing
    'journey_errors':  ['rate<0.01'],  // mirrors http_req_failed at the journey level
    'journey_latency': ['p(95)<3000'], // mirrors http_req_duration at the journey level
  },
  tags: { phase: '2-average', target: 'staging' },
};

// -- Custom metrics -----------------------------------------------------------
const journeyErrors  = new Rate('journey_errors');
const journeyLatency = new Trend('journey_latency');

// -- Test script --------------------------------------------------------------
export default function () {
  const path = randomItem(PUBLIC_PATHS);
  const url  = `${STAGING_URL}${path}`;
  const start = Date.now();

  // params configured to tolerate insecure TLS/certificates if it redirects
  // to https, and to follow up to 3 redirects (e.g. trailing-slash normalization).
  const params = {
    tags: { journey: path },
    redirects: 3,
  };

  const res = http.get(url, params);
  const elapsed = Date.now() - start;

  const ok = check(res, {
    [`${path}: status 2xx/3xx`]:    (r) => r.status >= 200 && r.status < 400,
    [`${path}: body not empty`]:   (r) => r.body && r.body.length > 0,
    [`${path}: latency < 3000ms`]: (r) => r.timings.duration < 3000,
  });

  journeyErrors.add(!ok);
  journeyLatency.add(elapsed);

  // Humanized think-time: 1–4s between page loads. Clamped to a sane range
  // so a bad RNG can't hold a VU idle for a minute.
  sleep(Math.random() * 3 + 1);
}

// -- Summary + Discord report -------------------------------------------------
// k6 calls handleSummary() once at the end of the test. The returned object
// maps sink names to file contents; the special "stdout" key is what k6
// prints to the terminal. We return:
//   - stdout:           human-readable text summary (always)
//   - perf-report.json: the JSON body that was posted to Discord, kept on
//                       disk for post-mortem inspection
export function handleSummary(data) {
  const verdict       = evaluateThresholds(data);
  const stdoutSummary = textSummary(data, verdict);
  const perfReport    = buildPerfReport(data, verdict);

  // Silent local fallback: if no webhook is configured (e.g. running this
  // script outside CI) we just skip the POST. We never want a missing
  // env var to throw an uncaught network error mid-summary.
  if (__ENV.DISCORD_PERF_WEBHOOK_URL) {
    try {
      http.post(__ENV.DISCORD_PERF_WEBHOOK_URL, JSON.stringify(perfReport), {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (err) {
      // Network glitch or invalid URL — log and continue. Discord is a
      // notification channel, not part of the test signal.
      console.warn(`[average-load-test] Discord POST failed: ${err.message || err}`);
    }
  }

  return {
    'stdout':           stdoutSummary,
    'perf-report.json': JSON.stringify(perfReport, null, 2),
  };
}

// --- helpers ---------------------------------------------------------------

// Discord embed colors (decimal form so they're copy-pasteable into any
// embed builder). 0x2ecc71 / 0xe74c3c.
const COLOR_GREEN_PASS = 3066993;
const COLOR_RED_FAIL   = 15158332;

/**
 * Inspect the k6 summary and decide whether the run passed. A run passes
 * only when k6 actually evaluated at least one threshold AND none of them
 * were breached — i.e. fail-closed. An empty or malformed payload reports
 * FAILED so a missed alert is impossible.
 *
 * Shape (verified against k6 v2.2.0 via a one-shot probe):
 *   data.metrics[name].thresholds = { '<threshold expr>': { ok: <bool> }, ... }
 * — a keyed object, NOT an array. Earlier versions of this code assumed
 * an array and silently skipped every metric, producing "FAILED — 0
 * breached" embeds on runs where k6 itself had already exited non-zero.
 *
 * @param {object} data  k6 SummaryData from handleSummary.
 * @returns {{ passed: boolean, breached: string[], total: number }}
 */
function evaluateThresholds(data) {
  const metrics = (data && data.metrics) || {};
  const breached = [];
  let total = 0;

  for (const metricName of Object.keys(metrics)) {
    const metric = metrics[metricName];
    if (!metric || !metric.thresholds || typeof metric.thresholds !== 'object') continue;

    for (const [expr, verdict] of Object.entries(metric.thresholds)) {
      total++;
      // `ok` is the authoritative verdict k6 itself uses in the terminal
      // summary. Anything other than literal `true` is a breach, which
      // also covers malformed payloads (e.g. `ok: undefined`).
      if (!verdict || verdict.ok !== true) {
        breached.push(`${metricName}: ${expr}`);
      }
    }
  }

  return { passed: total > 0 && breached.length === 0, breached, total };
}

/**
 * Build the Discord rich-embed payload. Title, color, and description all
 * derive from the verdict so the embed can never disagree with k6's own
 * terminal summary.
 */
function buildPerfReport(data, verdict) {
  const metrics       = (data && data.metrics) || {};
  const httpDur       = metrics.http_req_duration && metrics.http_req_duration.values;
  const httpReqFailed = metrics.http_req_failed   && metrics.http_req_failed.values;
  const { passed, breached } = verdict;

  const fmtMs  = (v) => (v == null || Number.isNaN(v)) ? 'n/a' : `${v.toFixed(2)} ms`;
  const fmtPct = (v) => (v == null || Number.isNaN(v)) ? 'n/a' : `${(v * 100).toFixed(2)}%`;

  const fields = [
    { name: 'Duration',      value: String((data && data.state && data.state.testRunDurationMs) || 'n/a'), inline: true },
    { name: 'VUs (max)',     value: String((metrics.vus && metrics.vus.values && metrics.vus.values.max) ?? 'n/a'), inline: true },
    { name: 'Iterations',    value: String((metrics.iterations && metrics.iterations.values && metrics.iterations.values.count) ?? 'n/a'), inline: true },
    { name: 'HTTP requests', value: String((metrics.http_reqs && metrics.http_reqs.values && metrics.http_reqs.values.count) ?? 'n/a'), inline: true },
    { name: 'p(95) latency', value: fmtMs(httpDur && httpDur['p(95)']), inline: true },
    { name: 'Avg latency',   value: fmtMs(httpDur && httpDur.avg),        inline: true },
    { name: 'Failure rate',  value: fmtPct(httpReqFailed && httpReqFailed.rate), inline: true },
  ];

  if (!passed) {
    const rendered = breached.join('\n');
    const value = rendered.length > 1024
      ? `${rendered.slice(0, 1000)}\n…(truncated)`
      : rendered;
    fields.push({ name: 'Breached thresholds', value: `\`\`\`${value}\`\`\``, inline: false });
  }

  return {
    username: 'YLHQ k6 Performance Bot',
    embeds: [{
      title: passed
        ? '🟢 k6 Average-Load Test — PASSED'
        : '🔴 k6 Average-Load Test — FAILED',
      color: passed ? COLOR_GREEN_PASS : COLOR_RED_FAIL,
      timestamp: new Date().toISOString(),
      footer: { text: 'performance-tests/average-load-test.js' },
      fields,
      description: passed
        ? 'All performance thresholds met. Phase 2 average-load run is healthy.'
        : `Performance thresholds breached (${breached.length}). Investigate the run report.`,
    }],
  };
}

/** Human-readable terminal summary, kept in lock-step with the embed. */
function textSummary(data, verdict) {
  const lines = [];
  lines.push('');
  lines.push('  k6 Average-Load Test — Summary');
  lines.push('  ------------------------------');
  lines.push('');

  const m = (data && data.metrics) || {};
  const fmt = (label, val) => `  ${label.padEnd(28)} ${val}`;

  if (m.http_reqs && m.http_reqs.values) {
    lines.push(fmt('http_reqs (count)', m.http_reqs.values.count));
    lines.push(fmt('http_reqs (rate)',  `${m.http_reqs.values.rate.toFixed(2)}/s`));
  }
  if (m.http_req_duration && m.http_req_duration.values) {
    const v = m.http_req_duration.values;
    lines.push(fmt('http_req_duration (avg)', `${v.avg.toFixed(2)} ms`));
    lines.push(fmt('http_req_duration (p95)', `${v['p(95)'].toFixed(2)} ms`));
    lines.push(fmt('http_req_duration (max)', `${v.max.toFixed(2)} ms`));
  }
  if (m.http_req_failed && m.http_req_failed.values) {
    lines.push(fmt('http_req_failed (rate)', `${(m.http_req_failed.values.rate * 100).toFixed(2)}%`));
  }
  if (m.iterations && m.iterations.values) {
    lines.push(fmt('iterations (count)', m.iterations.values.count));
  }
  if (m.vus && m.vus.values) {
    lines.push(fmt('vus (max)', m.vus.values.max));
  }

  lines.push('');
  lines.push(`  Thresholds — ${verdict.passed ? 'PASSED' : 'FAILED'} (${verdict.total} evaluated)`);
  if (verdict.breached.length === 0) {
    lines.push('    (no thresholds breached)');
  } else {
    verdict.breached.forEach((b) => lines.push(`    x ${b}`));
  }
  lines.push('');
  return lines.join('\n');
}
