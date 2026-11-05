#!/usr/bin/env node
// Rollback drill helper. Lists the newest READY production deployments on Vercel and prints the exact
// `vercel rollback` command for the previous one. It NEVER runs the command: a human copies it.
// Needs: VERCEL_TOKEN and VERCEL_PROJECT_ID in the environment; VERCEL_TEAM_ID if the project is in a team.
// VERCEL_API_URL overrides the API origin (tests only). The token is sent as a header and is never printed.

const token = process.env.VERCEL_TOKEN;
const projectId = process.env.VERCEL_PROJECT_ID;
const teamId = process.env.VERCEL_TEAM_ID;
const api = (process.env.VERCEL_API_URL ?? "https://api.vercel.com").replace(/\/+$/, "");

if (!token || !projectId) {
  console.error("Set VERCEL_TOKEN and VERCEL_PROJECT_ID (and VERCEL_TEAM_ID for a team project), then run again.");
  process.exit(2);
}

const query = new URLSearchParams({ projectId, target: "production", state: "READY", limit: "5" });
if (teamId) query.set("teamId", teamId);

async function main() {
  let res;
  try {
    res = await fetch(`${api}/v6/deployments?${query}`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) });
  } catch {
    console.error("Could not reach the Vercel API. Check your network and try again.");
    return 1;
  }
  if (!res.ok) {
    console.error(`The Vercel API answered ${res.status}. Check VERCEL_TOKEN, VERCEL_PROJECT_ID and VERCEL_TEAM_ID.`);
    return 1;
  }

  const body = await res.json().catch(() => null);
  const deployments = Array.isArray(body?.deployments) ? body.deployments : [];
  const when = (d) => (typeof d.created === "number" ? new Date(d.created).toISOString() : "unknown time");

  console.log("Newest READY production deployments (newest first):");
  for (const [i, d] of deployments.entries()) {
    console.log(`  ${i === 0 ? "current " : "previous"} ${d.uid}  https://${d.url}  ${when(d)}`);
  }

  if (deployments.length < 2) {
    console.error("Fewer than two READY production deployments: there is nothing to roll back to.");
    return 1;
  }

  const target = deployments[1];
  console.log("\nTo roll back to the previous deployment, run this yourself (this script does not):");
  console.log(`  vercel rollback ${target.url}${teamId ? ` --scope ${teamId}` : ""}`);
  console.log("\nThen: node scripts/smoke.mjs <production url>, and watch /api/ready for two minutes.");
  console.log("Database changes are forward-only: do not roll the database back; ship a forward-fix migration instead.");
  return 0;
}

// exitCode, not process.exit(): on Windows, exiting with open fetch connections can crash node with a native error code.
process.exitCode = await main();
