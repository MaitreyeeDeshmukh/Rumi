// stub for lane merge: owned by prod-observability. Delete this file at merge.
import { logEvent, type AiEvent } from "@/lib/ai/telemetry";

export interface AiEventExtra {
  cacheStatus: "miss" | "hit" | "bypass";
  cachedTokens: number;
  /** Omitted for crisis events: nothing ties a crisis to a person or an address. */
  bucket?: string;
}

export function recordAiEvent(e: AiEvent, extra: AiEventExtra): void {
  void extra; // the real sink also stores these
  logEvent(e);
}

export function recordAppEvent(e: { source: "server" | "client" | "db"; area: "auth" | "db" | "ai" | "memory" | "app" | "sync"; code: string; route?: string; status?: number }): void {
  console.log(JSON.stringify({ type: "app_event", ...e }));
}
