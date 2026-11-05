#!/usr/bin/env node
// Fails the build when anything that must stay on the server is found in files the browser can download.
// Usage (from apps/web, after `pnpm build`): node scripts/check-bundle.mjs [dir ...]   default: .next/static public
// Reports file, rule and offset only. It never prints the matched text, so a real key cannot leak into CI logs.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const dirs = process.argv.length > 2 ? process.argv.slice(2) : [".next/static", "public"];
const MAX_BYTES = 25 * 1024 * 1024;

/** Plain strings: names of server-only secrets and the admin client call. */
const LITERALS = [
  "SUPABASE_SECRET_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "service_role",
  "GROQ_API_KEY",
  "SESSION_SECRET",
  "MEMORY_TAG_SECRET",
  "SUPERMEMORY_API_KEY",
  "getAdminClient",
  "supabase/admin",
];
/** Shapes of real keys. */
const PATTERNS = [
  ["groq_key", /gsk_[A-Za-z0-9]{20,}/g],
  ["supabase_secret_key", /sb_secret_[A-Za-z0-9_-]{10,}/g],
  ["admin_api_call", /\.auth\.admin\./g],
];
const JWT = /eyJ[A-Za-z0-9_-]{8,}\.(eyJ[A-Za-z0-9_-]{8,})\.[A-Za-z0-9_-]{8,}/g;

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) yield* files(p);
    else if (s.size <= MAX_BYTES) yield p;
  }
}

/** A Supabase service-role key is a JWT whose payload says role=service_role; the anon and publishable keys are fine. */
function serviceRoleJwts(text) {
  const hits = [];
  for (const m of text.matchAll(JWT)) {
    try {
      const payload = JSON.parse(Buffer.from(m[1], "base64url").toString("utf8"));
      if (payload?.role === "service_role") hits.push(m.index ?? 0);
    } catch {
      // Not a decodable JWT: some other base64 text, not a key.
    }
  }
  return hits;
}

const missing = dirs.filter((d) => !existsSync(d));
// .next/static must exist (a missing build is a failed check, not a pass); public is optional.
if (missing.includes(dirs[0])) {
  console.error(`check-bundle: ${dirs[0]} does not exist. Run the build first.`);
  process.exit(2);
}

const found = [];
let scanned = 0;
for (const dir of dirs.filter((d) => existsSync(d))) {
  for (const file of files(dir)) {
    scanned += 1;
    const text = readFileSync(file, "utf8");
    for (const lit of LITERALS) {
      const at = text.indexOf(lit);
      if (at >= 0) found.push(`${file}: forbidden string "${lit}" at offset ${at}`);
    }
    for (const [rule, re] of PATTERNS) {
      for (const m of text.matchAll(re)) found.push(`${file}: ${rule} at offset ${m.index ?? 0}`);
    }
    for (const at of serviceRoleJwts(text)) found.push(`${file}: service_role JWT at offset ${at}`);
  }
}

if (scanned === 0) {
  console.error("check-bundle: no files to scan. The build output is empty.");
  process.exit(2);
}
if (found.length > 0) {
  console.error(`check-bundle: ${found.length} problem(s) in files served to the browser:`);
  for (const f of found) console.error(`  ${f}`);
  process.exit(1);
}
console.log(`check-bundle: ok, ${scanned} files scanned, nothing server-only found`);
