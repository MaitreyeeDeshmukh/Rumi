import { createElement, isValidElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RumiProvider, createRumiProvider, startStoreEffect, useRumi, type ProviderHooks } from "@/features/state/RumiProvider";
import { createStateStore, type StateStore, type StorageEventLike } from "@/features/state/stateStore";
import { KEY, defaultState } from "@/lib/storage";
import { fakeStorage } from "./helpers/fakeStorage";

function Probe() {
  const { state, hydrated, lastSave, readOnly, droppedUpdates } = useRumi();
  return createElement("p", null, `${hydrated}|${state.settings.companionName}|${state.sessions.length}|${lastSave.ok}|${readOnly}|${droppedUpdates}`);
}

describe("RumiProvider on the server", () => {
  it("renders the default state, not hydrated, so server and client markup match", () => {
    expect(renderToString(createElement(RumiProvider, null, createElement(Probe)))).toContain("false|Rumi|0|true|false|0");
  });

  it("useRumi outside the provider is a clear error", () => {
    expect(() => renderToString(createElement(Probe))).toThrow("useRumi outside RumiProvider");
  });
});

describe("RumiProvider wiring (recording hooks stand in for React)", () => {
  function render() {
    const effects: { effect: () => void | (() => void); deps: readonly unknown[] }[] = [];
    const hooks: ProviderHooks = {
      useState: <T,>(init: () => T) => [init(), undefined] as const,
      useEffect: (effect, deps) => void effects.push({ effect, deps }),
    };
    const Provider = createRumiProvider(hooks);
    const element = Provider({ children: null });
    if (!isValidElement<{ value: StateStore }>(element)) throw new Error("provider did not return an element");
    return { effects, store: element.props.value };
  }

  it("registers exactly one effect that starts the store, keyed on the store", () => {
    const { effects, store } = render();
    expect(effects).toHaveLength(1);
    expect(effects[0].deps).toEqual([store]);
    expect(store.getSnapshot().hydrated).toBe(false);
    const cleanup = effects[0].effect();
    expect(store.getSnapshot().hydrated).toBe(true);
    expect(typeof cleanup).toBe("function");
    (cleanup as () => void)();
  });
});

describe("startStoreEffect", () => {
  it("hydrates the store and listens for other tabs; its cleanup stops listening", () => {
    const storage = fakeStorage({ [KEY]: JSON.stringify({ ...defaultState(), settings: { ...defaultState().settings, name: "Sam" } }) });
    const listeners = new Set<(e: StorageEventLike) => void>();
    const events = {
      addEventListener: (_t: "storage", l: (e: StorageEventLike) => void) => void listeners.add(l),
      removeEventListener: (_t: "storage", l: (e: StorageEventLike) => void) => void listeners.delete(l),
    };
    const store = createStateStore({ storage, events });
    const cleanup = startStoreEffect(store)();
    expect(store.getSnapshot().hydrated).toBe(true);
    expect(store.getSnapshot().state.settings.name).toBe("Sam");
    expect(listeners.size).toBe(1);
    cleanup();
    expect(listeners.size).toBe(0);
  });
});
