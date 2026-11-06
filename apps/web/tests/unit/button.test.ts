import { describe, expect, it } from "vitest";
import { buttonClass, type ButtonKind } from "@/components/ui/button";

const KINDS: ButtonKind[] = ["primary", "secondary", "tertiary", "danger", "urgent"];

describe("buttonClass", () => {
  it("primary is a purple fill, 52px tall", () => {
    const c = buttonClass({ kind: "primary" });
    expect(c).toContain("bg-primary");
    expect(c).toContain("min-h-[52px]");
  });

  it("secondary has a primary border, 48px tall", () => {
    const c = buttonClass({ kind: "secondary" });
    expect(c).toContain("border-primary");
    expect(c).toContain("min-h-[48px]");
  });

  it("tertiary is underlined text, 44px target", () => {
    const c = buttonClass({ kind: "tertiary" });
    expect(c).toContain("underline");
    expect(c).toContain("min-h-[44px]");
  });

  it("danger uses the danger fill and danger-ink text", () => {
    const c = buttonClass({ kind: "danger" });
    expect(c).toContain("bg-danger");
    expect(c).toContain("text-danger-ink");
  });

  it("urgent has a danger border and danger text", () => {
    const c = buttonClass({ kind: "urgent" });
    expect(c).toContain("border-danger");
    expect(c).toContain("text-danger");
  });

  it("block adds w-full", () => {
    expect(buttonClass({ kind: "primary", block: true })).toContain("w-full");
    expect(buttonClass({ kind: "primary" })).not.toContain("w-full");
  });

  it("purple fill is only on primary", () => {
    for (const kind of KINDS.filter((k) => k !== "primary")) {
      expect(buttonClass({ kind }), kind).not.toMatch(/(^|\s)bg-primary(\s|$)/);
    }
  });

  it("never uses gradients, blur or looping animation", () => {
    for (const kind of KINDS) {
      const c = buttonClass({ kind, block: true });
      expect(c, kind).not.toContain("bg-gradient");
      expect(c, kind).not.toContain("backdrop-blur");
      expect(c, kind).not.toContain("animate-");
    }
  });
});
