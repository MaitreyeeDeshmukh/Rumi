import type { z } from 'zod';

/** hard = block and retry, then fail. soft = retry once, then ship it and count it. */
export interface GuardResult { hard: string[]; soft: string[] }

export interface TaskSpec<Req, Out, Reply> {
  name: 'plan' | 'practice' | 'sayit' | 'recap';
  promptVersion: string;                      // bump on any prompt edit, e.g. 'plan@3'
  request: z.ZodType<Req>;
  modelOut: z.ZodType<Out>;
  reply: z.ZodType<Reply>;
  /** EVERY string that came from the browser, keyed by a stable name. The harness normalizes, crisis-checks, redacts PII and injection-scans them. */
  userStrings: (r: Req) => Record<string, string>;
  /** Build the prompt. Use ONLY `safe[...]` values for user text and wrap each with wrapUserText(). `memory` is '' or a ready <user_memory> block. */
  build: (r: Req, safe: Record<string, string>, memory: string) => { system: string; user: string };
  /** Pure domain checks on the model output (lint, invented facts, ids exist). */
  validate: (r: Req, o: Out) => GuardResult;
  /** Model output -> wire reply (assign ids, drop unsupported items, run evidence check). Pure. */
  finalize: (r: Req, o: Out) => Reply;
  adviceGuard: boolean;                       // false only for recap (quotes doses said in the visit)
  useMemory: boolean;
  temperature: number; maxOutputTokens: number;
  mock: (r: Req) => Reply;                    // used when MOCK_AI=1, must satisfy `reply`
}
