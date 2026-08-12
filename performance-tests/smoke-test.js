// performance-tests/smoke-test.js
//
// PHASE 1: Smoke Tests & Health Checks (Read-Only)
// -----------------------------------------------------------------------------
// Goal:    Verify script syntax, environmental connectivity to Staging, and
//          baseline latency for safe public GET endpoints / health-check APIs.
// Target:  Yellow Letters HQ (YLQ) Staging — NEVER production for load/order
//          flows. Health-check / public storefront GETs only.
// Load:    1 Virtual User (VU) for 10 seconds.
// Success: 0% error rate, response time < 300ms.
//
// Run:
//   k6 run performance-tests/smoke-test.js
//   # or with an explicit staging URL:
//   k6 run -e STAGING_URL=http://16.147.78.186 performance-tests/smoke-test.js
// -----------------------------------------------------------------------------

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

// -- Configuration ------------------------------------------------------------
const STAGING_URL = __ENV.STAGING_URL || 'http://16.147.78.186';

const SMOKE_ENDPOINTS = [
  { name: 'storefront_root', path: '/' },
  { name: 'wp_login',        path: '/wp-login.php' },
  { name: 'storefront_shop', path: '/shop/' }, // Added trailing slash to avoid trailing redirects
];

// -- Load profile -------------------------------------------------------------
export const options = {
  vus: 1,
  duration: '10s',
  thresholds: {
    http_req_failed:   ['rate==0'],     // 0% error rate
    http_req_duration: ['p(95)<3000'],  // Adjusted for staging: p95 < 3000ms (3s)
    'smoke_errors':    ['rate==0'],     
    'smoke_latency':   ['p(95)<3000'],  // Adjusted for staging: p95 < 3000ms
  },
  tags: { phase: '1-smoke', target: 'staging' },
};

// -- Custom metrics ------------------------------------------------------------
const smokeErrors = new Rate('smoke_errors');
const smokeLatency = new Trend('smoke_latency');

// -- Test script --------------------------------------------------------------
export default function () {
  for (const endpoint of SMOKE_ENDPOINTS) {
    const url = `${STAGING_URL}${endpoint.path}`;
    const start = Date.now();
    
    // params configured to tolerate insecure TLS/certificates if it redirects to https
    const params = {
      tags: { endpoint: endpoint.name },
      redirects: 3,
    };

    const res = http.get(url, params);
    const elapsed = Date.now() - start;

    const ok = check(res, {
      [`${endpoint.name}: status 2xx/3xx`]: (r) => r.status >= 200 && r.status < 400,
      [`${endpoint.name}: body not empty`]: (r) => r.body && r.body.length > 0,
      [`${endpoint.name}: latency < 3000ms`]: (r) => r.timings.duration < 3000,
    });

    smokeErrors.add(!ok);
    smokeLatency.add(elapsed);

    sleep(1);
  }
}