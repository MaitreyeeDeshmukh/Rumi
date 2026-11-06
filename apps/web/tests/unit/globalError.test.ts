import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import GlobalError from "@/app/global-error";

describe("global-error", () => {
  const html = renderToString(createElement(GlobalError, { error: new Error("x"), reset: () => {} }));

  it("has Back, the home link, Try again and both phone links", () => {
    for (const s of ["Back", "Go to the home page", "Try again", "tel:988", "tel:911"]) expect(html, s).toContain(s);
  });

  it("keeps everything inside one main landmark", () => {
    expect(html.indexOf("<main")).toBeGreaterThan(-1);
    expect(html.indexOf("<main")).toBeLessThan(html.indexOf("Back"));
    expect(html.indexOf("</main>")).toBeGreaterThan(html.indexOf("tel:911"));
  });

  it("starts with the Back anchor to /", () => {
    const start = html.indexOf("<a ");
    const first = html.slice(start, html.indexOf("</a>", start));
    expect(first).toContain('href="/"');
    expect(first).toContain("Back");
  });
});
