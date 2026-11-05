/**
 * Turns the alert job's result into GitHub issue actions. Pure apart from the `gh` object it is given, so a test can fake it.
 * No imports: scripts/alerts-issues.mjs runs it with plain `node --experimental-strip-types`.
 *   - an active alert opens an issue "[alert] <key>", or updates the body of the one that is open;
 *   - an open issue whose alert is gone is closed as cleared, UNLESS the alert was undecided this run (no data):
 *     then it stays open and gets a "no data" comment (once, not every 15 minutes).
 */
export interface IssueAlert {
  key: string;
  title: string;
  detail: string;
}

export interface AlertResult {
  alerts: IssueAlert[];
  undecided: string[];
}

export interface Gh {
  listOpen(): { number: number; title: string }[];
  create(title: string, body: string): void;
  edit(number: number, body: string): void;
  close(number: number, comment: string): void;
  lastComment(number: number): string;
  comment(number: number, body: string): void;
}

export const PREFIX = "[alert] ";
export const NO_DATA_COMMENT = "No data in the last 30 minutes, so this cannot be judged as cleared. Left open.";
export const CLEARED_COMMENT = "Cleared: the condition is no longer true.";

const bodyOf = (a: IssueAlert): string => `${a.title}\n\n${a.detail}\n\nSee README.md, section Operations, for the runbook.`;

export function syncIssues(result: AlertResult, gh: Gh): void {
  const open = gh.listOpen().filter((i) => i.title.startsWith(PREFIX));
  const active = new Set(result.alerts.map((a) => PREFIX + a.key));
  for (const a of result.alerts) {
    const existing = open.find((i) => i.title === PREFIX + a.key);
    if (existing) gh.edit(existing.number, bodyOf(a));
    else gh.create(PREFIX + a.key, bodyOf(a));
  }
  for (const issue of open) {
    if (active.has(issue.title)) continue;
    const key = issue.title.slice(PREFIX.length);
    if (result.undecided.includes(key)) {
      if (gh.lastComment(issue.number) !== NO_DATA_COMMENT) gh.comment(issue.number, NO_DATA_COMMENT);
    } else {
      gh.close(issue.number, CLEARED_COMMENT);
    }
  }
}
