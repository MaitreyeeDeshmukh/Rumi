import { describe, expect, it } from "vitest";
import { STORAGE_KEY, clearState, foreignVersion, readState, storageWorks, writeState } from "@/lib/rumiStore";

function fake(initial: string | null) {
  const writes: string[] = [];
  return {
    writes,
    getItem: () => initial,
    setItem: (_k: string, v: string) => {
      writes.push(v);
    },
  };
}

describe("readState and writeState", () => {
  const whole = { version: 1, settings: { name: "Sam" }, plan: { items: [] }, sessions: [] };

  it("reads the whole version 1 object, and null for junk, another version, or a throwing store", () => {
    expect(readState({ getItem: () => JSON.stringify(whole) })).toEqual(whole);
    expect(readState({ getItem: () => "{nope" })).toBeNull();
    expect(readState({ getItem: () => '{"version":2}' })).toBeNull();
    expect(readState({ getItem: () => null })).toBeNull();
    expect(
      readState({
        getItem: () => {
          throw new Error("blocked");
        },
      }),
    ).toBeNull();
  });

  it("writes the whole state under the shared key and keeps every field", () => {
    const writes: [string, string][] = [];
    const s = { getItem: () => null, setItem: (k: string, v: string) => void writes.push([k, v]) };
    expect(writeState(whole, s)).toBe(true);
    expect(writes).toEqual([[STORAGE_KEY, JSON.stringify(whole)]]);
  });

  it("overwrites junk but refuses to overwrite another version", () => {
    expect(writeState(whole, { getItem: () => "{nope", setItem: () => {} })).toBe(true);
    const s = fake('{"version":2,"x":1}');
    expect(writeState(whole, s)).toBe(false);
    expect(s.writes).toEqual([]);
  });

  it("returns false when storage is missing or throws", () => {
    expect(writeState(whole, undefined)).toBe(false);
    const throws = {
      getItem: () => null,
      setItem: () => {
        throw new Error("quota");
      },
    };
    expect(writeState(whole, throws)).toBe(false);
  });
});

describe("clearState and storageWorks", () => {
  it("removes the shared key and never throws", () => {
    const removed: string[] = [];
    clearState({ removeItem: (k: string) => void removed.push(k) });
    expect(removed).toEqual([STORAGE_KEY]);
    expect(() =>
      clearState({
        removeItem: () => {
          throw new Error("blocked");
        },
      }),
    ).not.toThrow();
  });

  it("is true only when the store can be read", () => {
    expect(storageWorks({ getItem: () => null })).toBe(true);
    expect(storageWorks(undefined)).toBe(false);
    expect(
      storageWorks({
        getItem: () => {
          throw new Error("blocked");
        },
      }),
    ).toBe(false);
  });
});

describe("foreignVersion", () => {
  it("is true only for stored data of another version", () => {
    expect(foreignVersion({ getItem: () => '{"version":2}' })).toBe(true);
    expect(foreignVersion({ getItem: () => '{"version":1}' })).toBe(false);
    expect(foreignVersion({ getItem: () => null })).toBe(false);
    expect(foreignVersion({ getItem: () => "{nope" })).toBe(false);
    expect(foreignVersion(undefined)).toBe(false);
  });
});
