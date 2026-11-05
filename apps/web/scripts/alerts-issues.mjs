// Opens, updates or closes GitHub issues from alerts.json (written by alerts-check.mjs). Needs the gh CLI and GH_TOKEN.
// Run by .github/workflows/alerts.yml: node --experimental-strip-types apps/web/scripts/alerts-issues.mjs
// Arguments go to gh as an array (no shell), so alert text can never be interpreted as a command.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { syncIssues } from "../src/lib/telemetry/alertIssues.ts";

const gh = (args) => execFileSync("gh", args, { encoding: "utf8" });
const result = JSON.parse(readFileSync(process.env.ALERTS_OUT ?? "alerts.json", "utf8"));

try {
  gh(["label", "create", "alert", "--color", "B60205", "--description", "Automated production alert"]);
} catch {
  // The label already exists on every run after the first.
}

syncIssues(result, {
  listOpen: () => JSON.parse(gh(["issue", "list", "--label", "alert", "--state", "open", "--limit", "100", "--json", "number,title"])),
  create: (title, body) => void gh(["issue", "create", "--title", title, "--label", "alert", "--body", body]),
  edit: (n, body) => void gh(["issue", "edit", String(n), "--body", body]),
  close: (n, comment) => void gh(["issue", "close", String(n), "--comment", comment]),
  lastComment: (n) => gh(["issue", "view", String(n), "--json", "comments", "--jq", '.comments[-1].body // ""']).trim(),
  comment: (n, body) => void gh(["issue", "comment", String(n), "--body", body]),
});
console.log(`issues synced: ${result.alerts.length} active, ${result.undecided.length} undecided`);
