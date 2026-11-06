import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("the e2e error test page", () => {
  const text = readFileSync(resolve(__dirname, "../../src/app/%5Ferror-test/page.tsx"), "utf8");

  it("is hidden unless the e2e flag is set and always rendered on demand", () => {
    expect(text).toContain("notFound()");
    expect(text).toContain("force-dynamic");
    expect(text).toContain("NEXT_PUBLIC_E2E");
  });
});
