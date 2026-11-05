// k6 smoke test for /api/*. Run it against an app started with MOCK_AI=1 (no model is called):
//   k6 run -e BASE_URL=http://127.0.0.1:3000 apps/web/tests/load/smoke.js
//   k6 run -e BASE_URL=... -e SHORT=1 apps/web/tests/load/smoke.js        (10 second check of the script itself)
// k6 is an external binary, not an npm dependency. Never point this at production: it is a flood by design.
//
// What it proves:
//   * 200 virtual users for a minute: p95 under 500 ms.
//   * Under 1 percent of answers are unexpected. Expected: 200, or 429 WITH a Retry-After header. A 5xx, a 429 without
//     Retry-After, a missing x-request-id or a cacheable answer all count as unexpected.
//   * The rate limiter is exercised on purpose: every tenth user shares one address, so a 429 must appear and must be a 429.
import http from "k6/http";
import { check } from "k6";
import { Counter, Rate } from "k6/metrics";

const BASE = (__ENV.BASE_URL || "http://127.0.0.1:3000").replace(/\/+$/, "");
const SHORT = __ENV.SHORT === "1";
// Once routes require a signed-in user (auth lane), pass a session cookie from a test project: -e AUTH_COOKIE='sb-...=...'
const COOKIE = __ENV.AUTH_COOKIE ? { cookie: __ENV.AUTH_COOKIE } : {};

const unexpected = new Rate("unexpected_answers");
const limited = new Counter("rate_limited_429");
const served = new Counter("served_200");

export const options = {
  stages: SHORT
    ? [
        { duration: "5s", target: 20 },
        { duration: "5s", target: 0 },
      ]
    : [
        { duration: "30s", target: 50 },
        { duration: "30s", target: 200 },
        { duration: "60s", target: 200 },
        { duration: "15s", target: 0 },
      ],
  thresholds: {
    http_req_duration: ["p(95)<500"],
    unexpected_answers: ["rate<0.01"],
    rate_limited_429: SHORT ? [] : ["count>0"],
    checks: ["rate>0.99"],
  },
};

const JSON_HEADERS = { "content-type": "application/json", origin: BASE, "sec-fetch-site": "same-origin" };
const SAYIT = JSON.stringify({ level: 2, scenario: "book", companionName: "Rumi" });

/** Ten percent of users come from one shared address (a school or clinic network); the rest each have their own. */
const addressOf = (vu) => (vu % 10 === 0 ? "198.51.100.7" : `10.${(vu >> 8) & 255}.${vu & 255}.${(__ITER % 250) + 1}`);

function judge(res, name) {
  const ok = res.status === 200 || (res.status === 429 && !!res.headers["Retry-After"]);
  unexpected.add(!ok);
  if (res.status === 200) served.add(1);
  if (res.status === 429) limited.add(1);
  check(res, {
    [`${name}: 200, or 429 with Retry-After`]: () => ok,
    [`${name}: never a 5xx`]: (r) => r.status < 500,
    [`${name}: x-request-id present`]: (r) => !!r.headers["X-Request-Id"],
    [`${name}: Cache-Control no-store`]: (r) => /no-store/i.test(r.headers["Cache-Control"] || ""),
  });
}

export default function smoke() {
  const headers = { "x-real-ip": addressOf(__VU), ...COOKIE };
  if (__ITER % 5 === 0) {
    judge(http.get(`${BASE}/api/health`, { headers, tags: { name: "health" } }), "GET /api/health");
  } else {
    judge(http.post(`${BASE}/api/sayit`, SAYIT, { headers: { ...JSON_HEADERS, ...headers }, tags: { name: "sayit" } }), "POST /api/sayit");
  }
}
