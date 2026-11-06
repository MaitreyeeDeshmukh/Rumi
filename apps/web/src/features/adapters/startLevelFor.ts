import { helpHistoryFor } from "@/features/memory/persona";
import { nextStartLevel } from "@/features/practice/nextStartLevel";
import type { HelpLevel, PlanItemKind, RumiState } from "@/features/shared/types";

/** The help level a new practice starts at for one kind of plan line, from the earlier sessions. */
export const startLevelFor = (state: RumiState, kind: PlanItemKind): HelpLevel => nextStartLevel(helpHistoryFor(state, kind));
