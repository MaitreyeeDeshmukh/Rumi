import { describe, expect, it } from "vitest";
import { parseEnv } from "@/lib/env";

describe("parseEnv", () => {
  it("accepts an empty environment", () => {
    expect(parseEnv({})).toEqual({});
  });

  it("treats empty strings as unset", () => {
    expect(parseEnv({ OPENAI_API_KEY: "" })).toEqual({});
  });

  it("rejects a malformed URL and names the variable without echoing its value", () => {
    expect(() => parseEnv({ NEXT_PUBLIC_SUPABASE_URL: "not a url" })).toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
    try {
      parseEnv({ NEXT_PUBLIC_SUPABASE_URL: "not a url" });
    } catch (e) {
      expect(String(e)).not.toContain("not a url");
    }
  });
});
