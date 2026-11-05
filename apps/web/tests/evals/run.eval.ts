/**
 * `pnpm eval`: runs every dataset case through the injected RunFn, scores it, and prints the report.
 * One vitest test per (case, repetition) so each stays under the 60 s timeout; the scripted probe gets one deadline per step.
 * See cli.mjs for the command line and the exit codes (the verdicts are handed to the CLI through EVAL_STATUS_FILE).
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { PINNED } from './baseline';
import { buildCases } from './cases';
import { loadAll } from './data/schema';
import { makeDryRun } from './dry';
import { readFlags } from './flags';
import {
  appendCalibration,
  commonSummaries,
  createSession,
  DEFAULT_TIMEOUT_MS,
  estimateRun,
  formatEstimate,
  getCommit,
  liveGuard,
  loadEnvLocal,
  loadLiveRun,
  writeHumanSample,
  writeRunFile,
  writeSummaryFile,
  type RunFn,
  type RunRecord,
  type Session,
} from './runner';
import { aggregate } from './scorers/aggregate';
import { DEFAULT_CANARY } from './scorers/leak';
import { renderReport, type ReportInput } from './scorers/report';

const flags = readFlags(process.env);
const mode = flags.dry ? 'dry' : 'live';
const data = loadAll();
const evalDir = path.resolve(process.cwd(), 'tests/evals');
const commit = getCommit();
const canary = process.env.EVAL_CANARY || DEFAULT_CANARY;
const print = (lines: string[]): void => {
  process.stdout.write(`${lines.join('\n')}\n`);
};

const reports: ReportInput[] = [];
const records: RunRecord[] = [];
const sessions: Session[] = [];

if (flags.dry) print(['DRY RUN, NOT MEASUREMENT: replaying recorded fixture replies. Nothing here measures the product and nothing is written.']);

for (const arm of flags.arms) {
  describe(`eval arm: ${arm} (${mode}, k=${flags.k})`, () => {
    const cases = buildCases(data, arm);
    let session: Session;
    // The only model ids this run may have used: from config (never printed); the dry fixtures use the two Groq ids of 06 section 0.
    const models = (): string[] => [process.env.GROQ_MODEL_QUALITY ?? 'openai/gpt-oss-120b', process.env.GROQ_MODEL_FAST ?? 'openai/gpt-oss-20b'];

    beforeAll(async () => {
      let run: RunFn;
      if (flags.dry) {
        run = makeDryRun(flags.fault, arm);
      } else {
        loadEnvLocal();
        const reasons = liveGuard(process.env);
        if (reasons.length > 0) throw new Error(`Refusing to run live:\n- ${reasons.join('\n- ')}`);
        process.env.EVAL_CANARY = canary;
        const models = { quality: process.env.GROQ_MODEL_QUALITY ?? 'openai/gpt-oss-120b', fast: process.env.GROQ_MODEL_FAST ?? 'openai/gpt-oss-20b' };
        print([formatEstimate(arm, estimateRun(cases, flags.k, arm, models)), `pinned parameters: ${JSON.stringify(PINNED)}`]);
        // Throws when the harness specs differ from the pin, before a single paid call.
        run = await loadLiveRun(arm);
      }
      session = createSession({ run, arm, k: flags.k, canary, mode, models: models() });
      sessions.push(session);
    });

    for (const c of cases) {
      const reps = c.suite === 'crisis' ? 1 : flags.k;
      const timeout = (c.script ? c.script.steps.length : 1) * DEFAULT_TIMEOUT_MS + 5_000;
      for (let rep = 0; rep < reps; rep++) {
        it(
          `${c.id} #${rep + 1}`,
          async () => {
            await session.runOne(c, rep);
          },
          timeout,
        );
      }
    }

    afterAll(() => {
      if (!session) return;
      const summary = aggregate(session.results, { arm, aborted: session.abortedAt !== undefined });
      reports.push({ arm, summary });
      if (session.abortedAt) print([`ABORTED at ${session.abortedAt}: the first rate_limited stops the run`]);
      records.push({ date: new Date().toISOString(), commit, mode, arm, k: flags.k, aborted: session.abortedAt, summary, results: session.results });
    });
  });
}

afterAll(() => {
  if (reports.length === 0) return;
  // Head to head: score each arm on the cases both arms ran, so the table compares like with like.
  const common = commonSummaries(records);
  for (const rep of reports) rep.common = common.get(rep.arm);
  print(renderReport(reports, { mode, k: flags.k, commit }));
  if (process.env.EVAL_STATUS_FILE) writeFileSync(process.env.EVAL_STATUS_FILE, JSON.stringify({ verdicts: reports.map((r) => r.summary.verdict), expected: flags.arms.length }));
  if (flags.dry) return;
  for (const rec of records) {
    print([`wrote ${path.relative(process.cwd(), writeRunFile(path.join(evalDir, 'runs'), rec))}`]);
    appendCalibration(path.join(evalDir, 'last-run.json'), rec);
  }
  const seed = Number.parseInt(commit, 16) || 1;
  const sample = writeHumanSample(path.join(evalDir, 'runs'), commit, mode, sessions.flatMap((s) => s.pool), seed);
  print([`human read: blind sheet ${path.relative(process.cwd(), sample.sheet)}, key ${path.relative(process.cwd(), sample.key)} (give raters the sheet only; then run pnpm eval --human-sheet=... --human-key=... --human-ratings=...)`]);
  if (flags.release) {
    if (records.some((r) => r.summary.verdict === 'INVALID')) print(['--release skipped: an INVALID run is never committed as a result']);
    else writeSummaryFile(path.join(evalDir, 'eval-summary.json'), records);
  }
});
