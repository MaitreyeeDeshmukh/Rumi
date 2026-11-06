import { describe, expect, it } from "vitest";
import { BANNED_WORDS } from "@/lib/banned";
import { FAQ, HOME_FAQ_QUESTIONS } from "@/content/faq";
import { literalLint } from "@/lib/literalLint";
import { PAGES, metadataFor } from "@/lib/pages";
import { ROUTES, SITE } from "@/lib/site";
import { TEAM } from "@/lib/team";

// Every route of spec section 4.8. Tasks 10 to 15 add the page files; PAGES already holds the text.
const SPEC_ROUTES = [
  "/",
  "/how-it-works",
  "/about",
  "/contact",
  "/help",
  "/safety",
  "/privacy",
  "/accessibility",
  "/welcome",
  "/home",
  "/get-ready",
  "/practice",
  "/remember",
  "/share",
  "/kit",
  "/say-it",
  "/settings",
];

describe("PAGES (spec 4.8)", () => {
  it("has an entry for every route in ROUTES and every route of the spec table", () => {
    for (const route of ROUTES) expect(PAGES[route], route).toBeDefined();
    expect(Object.keys(PAGES).sort()).toEqual([...SPEC_ROUTES].sort());
  });

  it("every declared route is a route of the spec (the spec routes not declared yet land with their tasks)", () => {
    for (const route of ROUTES) expect(SPEC_ROUTES).toContain(route);
  });

  it("descriptions have at least 40 characters", () => {
    for (const [route, p] of Object.entries(PAGES)) expect(p.description.length, route).toBeGreaterThanOrEqual(40);
  });

  it("titles are unique and never contain the site name", () => {
    const titles = Object.values(PAGES).map((p) => p.title);
    expect(new Set(titles).size).toBe(titles.length);
    for (const t of titles) expect(t).not.toMatch(/ \| Rumi/);
  });

  it("the home title is absolute and the others are bare", () => {
    expect(metadataFor("/").title).toEqual({ absolute: PAGES["/"].title });
    expect(metadataFor("/help").title).toBe("Help");
  });

  it("each page carries its own Open Graph title and description", () => {
    for (const route of Object.keys(PAGES)) {
      const og = metadataFor(route).openGraph;
      expect(og?.title, route).toBe(PAGES[route].title);
      expect(og?.description, route).toBe(PAGES[route].description);
    }
  });

  it("every h1 and lead is plain language (the /home h1 template is linted with a name)", () => {
    for (const [route, p] of Object.entries(PAGES)) {
      for (const [key, text] of [
        ["h1", p.h1],
        ["lead", p.lead],
        ["empty h1", p.empty?.h1 ?? ""],
        ["empty lead", p.empty?.lead ?? ""],
      ] as const) {
        const { failures } = literalLint(text.replace("{name}", "Sam"));
        expect(failures, `${route} ${key}`).toEqual([]);
      }
    }
  });

  it("states with several primaries use a map (spec 4.8)", () => {
    expect(PAGES["/get-ready"].primary).toEqual({ empty: "Make my plan", plan: "Looks right", saved: "Go to Practice" });
    expect(PAGES["/practice"].primary).toEqual({
      noPlan: "Go to Get ready",
      picker: "Start practice",
      call: "Send",
      paused: "Resume",
      summary: "Practice again",
    });
    expect(PAGES["/remember"].primary).toEqual({
      intro: "Use the sample visit",
      picker: "This voice is me",
      recap: "Go to Share",
    });
    expect(PAGES["/kit"].primary).toEqual({ empty: "Go to Get ready", ready: "Copy kit" });
    expect(PAGES["/say-it"].primary).toEqual({ script: "Copy" });
    expect(PAGES["/settings"].primary).toBeNull();
    expect(PAGES["/share"].primary).toBe("Copy text");
  });
});

describe("site text", () => {
  it("the site description is the new product line", () => {
    expect(SITE.description).toBe(PAGES["/"].description);
    expect(SITE.description).not.toMatch(/find your people/i);
    expect(SITE.tagline).toBe(PAGES["/"].h1);
  });

  it("TEAM holds only real people (empty until names are supplied)", () => {
    expect(Array.isArray(TEAM)).toBe(true);
    for (const m of TEAM) {
      expect(m.name.length).toBeGreaterThan(1);
      expect(m.role.length).toBeGreaterThan(1);
    }
  });
});

describe("FAQ (spec 6.5)", () => {
  it("has the seven questions in order with short literal answers", () => {
    expect(FAQ.map((f) => f.q)).toEqual([
      "Is Rumi a doctor?",
      "What does Rumi save about me?",
      "Does Rumi remember me next time?",
      "Can I use my voice?",
      "Does Rumi contact my clinic?",
      "What if the AI is not working?",
      "What if I am in danger?",
    ]);
    for (const f of FAQ) {
      expect(f.a.split(/\s+/).length, f.q).toBeLessThan(60);
      expect(literalLint(f.a).failures, f.q).toEqual([]);
      expect(BANNED_WORDS.test(f.a)).toBe(false);
    }
  });

  it("the home page shows the five named questions", () => {
    expect(HOME_FAQ_QUESTIONS).toEqual([
      "Is Rumi a doctor?",
      "What does Rumi save about me?",
      "Can I use my voice?",
      "Does Rumi contact my clinic?",
      "What if I am in danger?",
    ]);
    for (const q of HOME_FAQ_QUESTIONS) expect(FAQ.some((f) => f.q === q), q).toBe(true);
  });
});
