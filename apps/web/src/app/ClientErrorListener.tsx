"use client";

import { useEffect } from "react";
import { listenForClientErrors } from "@/lib/telemetry/clientErrorListener";

/** Reports errors that React never sees (a rejected promise, a script error) as one code with no text. Renders nothing. */
export function ClientErrorListener(): null {
  useEffect(() => listenForClientErrors(window), []);
  return null;
}
