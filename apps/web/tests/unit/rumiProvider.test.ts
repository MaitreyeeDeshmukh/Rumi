import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RumiProvider, useRumi } from "@/features/state/RumiProvider";

function Probe() {
  const { state, hydrated, lastSave } = useRumi();
  return createElement("p", null, `${hydrated}|${state.settings.companionName}|${state.sessions.length}|${lastSave.ok}`);
}

describe("RumiProvider on the server", () => {
  it("renders the default state, not hydrated, so server and client markup match", () => {
    expect(renderToString(createElement(RumiProvider, null, createElement(Probe)))).toContain("false|Rumi|0|true");
  });

  it("useRumi outside the provider is a clear error", () => {
    expect(() => renderToString(createElement(Probe))).toThrow("useRumi outside RumiProvider");
  });
});
