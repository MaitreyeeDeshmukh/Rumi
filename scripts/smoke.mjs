#!/usr/bin/env node
// Post-deploy smoke check. Usage: node scripts/smoke.mjs <baseUrl>
// Prints PASS or FAIL per check and exits 1 if any check fails. Read-only except one POST of a built-in
// scenario ("Help me say it", level 2, no user text), which a MOCK_AI deployment answers without a model call.
// Run it against a preview URL before promoting; it never reads environment files or secrets.

const base = process.argv[2];
if (!base || !/^https?:\/\//.test(base)) {
  console.error("usage: node scripts/smoke.mjs <baseUrl>   (for example https://rumi-preview.vercel.app)");
  process.exit(2);
}
const root = base.replace(/\/+$/, "");
const TIMEOUT_MS = 10_000;

const REQUIRED_HEADERS = [
  "strict-transport-security",
  "x-content-type-options",
  "referrer-policy",
  "permissions-policy",
  "cross-origin-opener-policy",
  "content-security-policy",
];

async function call(path, init = {}) {
  const res = await fetch(root + path, { ...init, redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS) });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // Not JSON: the check that needs JSON reports it.
  }
  return { res, json };
}

const results = [];
async function check(name, fn) {
  try {
    const problem = await fn();
    results.push({ name, problem: problem ?? null });
  } catch (e) {
    results.push({ name, problem: `request failed (${e instanceof Error ? e.name : "error"})` });
  }
}

const noStore = (res) => /(^|[\s,])no-store([\s,]|$)/i.test(res.headers.get("cache-control") ?? "");
const hasRequestId = (res) => /^[0-9a-f-]{12,}$/i.test(res.headers.get("x-request-id") ?? "");

await check("GET /api/health is 200 {ok:true} with a release", async () => {
  const { res, json } = await call("/api/health");
  if (res.status !== 200) return `status ${res.status}`;
  if (json?.ok !== true) return "body is not {ok:true}";
  if (typeof json.release !== "string" || json.release === "") return "release missing";
});

await check("GET /api/ready is 200 {ok:true}", async () => {
  const { res, json } = await call("/api/ready");
  if (res.status !== 200) return `status ${res.status}${Array.isArray(json?.failed) ? ` failed: ${json.failed.join(",")}` : ""}`;
  if (json?.ok !== true) return "body is not {ok:true}";
});

await check("one mocked task answers 200 with a script and no error", async () => {
  const { res, json } = await call("/api/sayit", {
    method: "POST",
    headers: { "content-type": "application/json", origin: new URL(root).origin, "sec-fetch-site": "same-origin" },
    body: JSON.stringify({ level: 2, scenario: "book", companionName: "Rumi" }),
  });
  if (res.status !== 200) return `status ${res.status}`;
  if (json?.error !== undefined) return "answer carries an error";
  if (typeof json?.script !== "string" || json.script === "") return "no script in the answer";
  if (json.degraded === true) return "answer is degraded";
});

for (const path of ["/api/health", "/api/ready", "/api/sayit"]) {
  await check(`${path} sends Cache-Control: no-store and x-request-id`, async () => {
    const { res } = await call(path, path === "/api/sayit" ? { method: "POST", headers: { "content-type": "application/json" }, body: "{}" } : {});
    if (!noStore(res)) return `Cache-Control is "${res.headers.get("cache-control") ?? ""}"`;
    if (!hasRequestId(res)) return "x-request-id missing";
  });
}

await check("home page sends every security header and hides x-powered-by", async () => {
  const { res } = await call("/");
  if (res.status !== 200) return `status ${res.status}`;
  const missing = REQUIRED_HEADERS.filter((h) => !res.headers.get(h));
  if (missing.length > 0) return `missing: ${missing.join(", ")}`;
  if (res.headers.get("x-powered-by")) return "x-powered-by is exposed";
});

await check("CSP has no wildcard source and forbids framing", async () => {
  const { res } = await call("/");
  const csp = res.headers.get("content-security-policy") ?? "";
  if (/(^|[\s;])\*([\s;]|$)/.test(csp) || /script-src[^;]*\*/.test(csp)) return "CSP has a wildcard source";
  if (!/frame-ancestors\s+'none'/.test(csp)) return "frame-ancestors is not 'none'";
});

let failed = 0;
for (const r of results) {
  if (r.problem === null) console.log(`PASS ${r.name}`);
  else {
    failed += 1;
    console.log(`FAIL ${r.name}: ${r.problem}`);
  }
}
console.log(`${results.length - failed}/${results.length} checks passed against ${root}`);
// exitCode, not process.exit(): on Windows, exiting with open fetch connections can crash node with a native error code.
process.exitCode = failed === 0 ? 0 : 1;
