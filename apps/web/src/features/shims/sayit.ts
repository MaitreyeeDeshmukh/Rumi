// swap when the lane merges: the AI lane answers /api/sayit. Until then callApi uses this for a scenario-shaped script.
import { SAYIT } from "@/content/sayit";

export type ScenarioId = (typeof SAYIT.scenarios)[number]["id"];

export function sayItShim(body: unknown): { script: string; blanks: string[] } {
  const { scenario, level } = (body ?? {}) as { scenario?: string; level?: number };
  const pair = SAYIT.shim[(scenario as ScenarioId) in SAYIT.shim ? (scenario as ScenarioId) : "book"];
  const [script, blanks] = pair[level === 3 ? 1 : 0];
  return { script, blanks: [...blanks] };
}
