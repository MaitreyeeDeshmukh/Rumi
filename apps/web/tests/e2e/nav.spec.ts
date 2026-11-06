import { expect, test, type Page } from "@playwright/test";
import { seed } from "./fixtures/rumiState";

const LINKS = ["How it works", "Safety", "Help", "Contact"];
const header = (page: Page) => page.locator("header").first();
const footer = (page: Page) => page.locator("footer");
const hydrated = (page: Page) => expect(footer(page).getByRole("radio").first()).toBeVisible();

// Seed rumi.v1 only when the key is absent, so a reload does not overwrite what the page saved.
async function seedOnce(page: Page, value: unknown) {
  await page.addInitScript((v) => {
    if (localStorage.getItem("rumi.v1") === null) localStorage.setItem("rumi.v1", JSON.stringify(v));
  }, value);
}

test.describe("header", () => {
  test("at 1280 shows the logo, four links, Urgent help and Open Rumi, and no Menu", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/help");
    const h = header(page);
    await expect(h.getByRole("link", { name: "Rumi home" })).toBeVisible();
    for (const name of LINKS) await expect(h.getByRole("link", { name, exact: true })).toBeVisible();
    await expect(h.getByRole("link", { name: "Urgent help" })).toBeVisible();
    await expect(h.getByRole("link", { name: "Open Rumi" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Menu" })).toHaveCount(0);
  });

  for (const width of [1023, 768, 375]) {
    test(`at ${width} the links are hidden and Menu is shown`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto("/help");
      for (const name of LINKS) await expect(header(page).getByRole("link", { name, exact: true })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Menu" })).toBeVisible();
      await expect(header(page).getByRole("link", { name: "Urgent help" })).toBeVisible();
    });
  }
});

test.describe("menu sheet", () => {
  test.use({ viewport: { width: 375, height: 800 } });

  test("opens with the links, Open Rumi and Urgent help; Escape closes it and focus returns", async ({ page }) => {
    await page.goto("/help");
    const menu = page.getByRole("button", { name: "Menu" });
    await menu.click();
    const sheet = page.getByRole("dialog", { name: "Menu" });
    await expect(sheet).toBeVisible();
    for (const name of LINKS) {
      const link = sheet.getByRole("link", { name, exact: true });
      await expect(link).toBeVisible();
      expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(55.9); // 56 px minus layout rounding
    }
    await expect(sheet.getByRole("link", { name: "Open Rumi" })).toBeVisible();
    await expect(sheet.getByRole("link", { name: "Urgent help" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    await expect(menu).toBeFocused();
  });

  test("a link click navigates and closes it", async ({ page }) => {
    await page.goto("/");
    await hydrated(page);
    await page.getByRole("button", { name: "Menu" }).click();
    const sheet = page.getByRole("dialog", { name: "Menu" });
    await sheet.getByRole("link", { name: "Contact", exact: true }).click();
    await expect(page).toHaveURL(/\/contact$/);
    await expect(sheet).toBeHidden();
  });

  test("Urgent help closes the sheet, then the crisis dialog opens and works", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Menu" }).click();
    const sheet = page.getByRole("dialog", { name: "Menu" });
    await sheet.getByRole("link", { name: "Urgent help" }).click();
    await expect(sheet).toBeHidden();
    const crisis = page.getByRole("dialog", { name: "You may need help right now" });
    await expect(crisis).toBeVisible();
    expect(await crisis.evaluate((el) => el.contains(document.activeElement))).toBe(true);
    await crisis.getByRole("link", { name: "Call 988" }).click({ trial: true });
  });
});

test.describe("footer", () => {
  test("has three columns with the exact links, no preview link and no store badges", async ({ page }) => {
    await page.goto("/help");
    const f = footer(page);
    const columns: [string, string[]][] = [
      ["Rumi", ["How it works", "About", "Open Rumi"]],
      ["Trust", ["Safety", "Privacy", "Accessibility"]],
      ["Help", ["Help", "Contact"]],
    ];
    for (const [title, names] of columns) {
      const group = f.getByRole("group", { name: title, exact: true });
      await expect(group.getByRole("link")).toHaveText(names);
    }
    await expect(f.locator('a[href^="/preview"]')).toHaveCount(0);
    await expect(f).not.toContainText(/App Store|Google Play/);
    await expect(f).toContainText("Rumi is an AI helper. It is not a doctor.");
    await expect(f.getByRole("link", { name: "Urgent help" })).toBeVisible();
  });

  test("the Look radios change the theme and the choice survives a reload", async ({ page }) => {
    await page.goto("/help");
    const html = page.locator("html");
    const group = footer(page).getByRole("radiogroup", { name: "Look" });
    await expect(group.getByRole("radio")).toHaveCount(3);
    await group.getByRole("radio", { name: "High Contrast" }).click();
    await expect(html).toHaveAttribute("data-app-theme", "contrast");
    await expect(page.getByRole("status").filter({ hasText: "Look changed to High Contrast." })).toHaveCount(1);
    await page.reload();
    await expect(html).toHaveAttribute("data-app-theme", "contrast");
    await expect(group.getByRole("radio", { name: "High Contrast" })).toBeChecked();
    await group.getByRole("radio", { name: "Low Light" }).click();
    await expect(html).toHaveAttribute("data-app-theme", "low");
  });

  test("Open Rumi goes to /welcome first and to /home after setup", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/help");
    await expect(header(page).getByRole("link", { name: "Open Rumi" })).toHaveAttribute("href", "/welcome");
    await expect(footer(page).getByRole("link", { name: "Open Rumi" })).toHaveAttribute("href", "/welcome");
    await page.evaluate(() => localStorage.setItem("rumi.v1", '{"version":1,"settings":{"onboarded":true}}'));
    await page.reload();
    await expect(header(page).getByRole("link", { name: "Open Rumi" })).toHaveAttribute("href", "/home");
    await expect(footer(page).getByRole("link", { name: "Open Rumi" })).toHaveAttribute("href", "/home");
  });
});

test.describe("text size", () => {
  const SIZES = [
    { width: 320, height: 568 },
    { width: 768, height: 1024 },
    { width: 1024, height: 768 },
  ];
  for (const scale of [1, 1.15, 1.3, 1.5]) {
    for (const size of SIZES) {
      test(`header holds together at text size ${scale}, ${size.width} x ${size.height}`, async ({ page }) => {
        await page.setViewportSize(size);
        await seedOnce(page, { version: 1, settings: { textScale: scale } });
        await page.goto("/");
        await hydrated(page);
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overflow).toBeLessThanOrEqual(0);

        const boxes = await header(page)
          .locator("a:visible, button:visible")
          .evaluateAll((els) =>
            els.map((el) => {
              const r = el.getBoundingClientRect();
              const name = (el.textContent || el.getAttribute("aria-label") || "").trim();
              return { name, x: r.x, y: r.y, w: r.width, h: r.height };
            }),
          );
        expect(boxes.length).toBeGreaterThan(2);
        for (let i = 0; i < boxes.length; i++) {
          for (let j = i + 1; j < boxes.length; j++) {
            const a = boxes[i];
            const b = boxes[j];
            const overlap = a.x < b.x + b.w - 1 && b.x < a.x + a.w - 1 && a.y < b.y + b.h - 1 && b.y < a.y + a.h - 1;
            expect(overlap, `${a.name} overlaps ${b.name}`).toBe(false);
          }
        }

        const urgent = header(page).getByRole("link", { name: "Urgent help" });
        const covered = await urgent.evaluate((el) => {
          const r = el.getBoundingClientRect();
          const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
          return !(top && el.contains(top));
        });
        expect(covered).toBe(false);
      });
    }
  }
});

test.describe("JavaScript off", () => {
  test.use({ javaScriptEnabled: false, viewport: { width: 375, height: 800 } });

  test("the header Urgent help is a link to /safety; Menu and Look are not rendered", async ({ page }) => {
    await page.goto("/help");
    const urgent = header(page).getByRole("link", { name: "Urgent help" });
    await expect(urgent).toHaveAttribute("href", "/safety");
    expect(await urgent.evaluate((el) => el.tagName)).toBe("A");
    await expect(page.getByRole("button", { name: "Menu" })).toHaveCount(0);
    await expect(page.getByRole("radio")).toHaveCount(0);
    await expect(page.getByRole("radiogroup")).toHaveCount(0);
  });

  test("a noscript navigation lists the four links and each resolves", async ({ page }) => {
    await page.goto("/help");
    const nav = page.getByRole("navigation", { name: "Site menu" });
    await expect(nav.getByRole("link")).toHaveText(LINKS);
    for (const href of await nav.getByRole("link").evaluateAll((els) => els.map((e) => e.getAttribute("href") ?? ""))) {
      expect((await page.request.get(href)).status(), href).toBe(200);
    }
  });

  test("/home says it needs JavaScript and hides its interactive content", async ({ page }) => {
    await page.goto("/home");
    // getByText skips <noscript>, so the paragraph is found with a CSS locator.
    await expect(page.locator("main p", { hasText: "This part of Rumi needs JavaScript. Turn it on, or go to the home page." })).toBeVisible();
    await expect(page.getByRole("link", { name: "Go to the home page" })).toHaveAttribute("href", "/");
    expect(await page.locator("[data-needs-js]").count()).toBeGreaterThan(0);
    await expect(page.locator("[data-needs-js]:visible")).toHaveCount(0);
  });

  test("/contact still shows the primary mailto link", async ({ page }) => {
    await page.goto("/contact");
    await expect(page.locator('main a[href^="mailto:"]').first()).toBeVisible();
  });
});

// ---- App shell (Task 10) ----
const TABS = ["Home", "Get ready", "Practice", "Remember", "Settings"];
const INFO = ["Help", "Contact", "Privacy", "Accessibility", "Safety and crisis help"];
const APP_PAGES = ["/home", "/get-ready", "/practice", "/remember", "/share", "/kit", "/say-it", "/settings"];
const appNav = (page: Page) => page.locator('nav[aria-label="App"]:visible');

test.describe("app tab bar (375)", () => {
  test.use({ viewport: { width: 375, height: 800 } });

  for (const [route, active] of [
    ["/settings", "Settings"],
    ["/get-ready", "Get ready"],
  ] as const) {
    test(`${route}: five tabs, 56 px tall, the active one is marked`, async ({ page }) => {
      await page.goto(route);
      const nav = appNav(page);
      await expect(nav).toHaveCount(1);
      await expect(nav.getByRole("link")).toHaveText(TABS);
      for (const link of await nav.getByRole("link").all()) {
        expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(55.9);
      }
      const current = nav.locator('a[aria-current="page"]');
      await expect(current).toHaveCount(1);
      await expect(current).toHaveText(active);
      const border = await current.evaluate((el) => parseFloat(getComputedStyle(el).borderTopWidth));
      expect(border).toBeGreaterThanOrEqual(3);
    });
  }

  test("the tab bar sits at the bottom and its height is written to --tabbar-h", async ({ page }) => {
    await page.goto("/settings");
    const nav = appNav(page);
    const box = (await nav.boundingBox())!;
    expect(Math.abs(box.y + box.height - 800)).toBeLessThanOrEqual(1);
    const written = await page.evaluate(() => document.documentElement.style.getPropertyValue("--tabbar-h"));
    expect(parseFloat(written)).toBeGreaterThanOrEqual(56);
  });

  test("/home shows the logo in the bar and Back to /", async ({ page }) => {
    await page.goto("/home");
    await expect(page.locator("header").getByRole("link", { name: "Rumi home" })).toBeVisible();
    await expect(page.locator("main").getByRole("link", { name: /^Back/ })).toHaveAttribute("href", "/");
  });

  test("/welcome has neither tabs nor a sidebar", async ({ page }) => {
    await page.goto("/welcome");
    await expect(appNav(page)).toHaveCount(0);
    await expect(page.locator("main")).toHaveAttribute("data-no-tabs", "");
    await expect(page.locator("header").getByRole("link", { name: "Urgent help" })).toBeVisible();
  });
});

test.describe("app sidebar (1280)", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("lists the five items, Say it and a Help and info group; no tab bar", async ({ page }) => {
    await page.goto("/settings");
    const nav = appNav(page);
    await expect(nav).toHaveCount(1);
    await expect(nav.getByRole("link", { name: "Rumi home" })).toBeVisible();
    for (const name of [...TABS, "Say it"]) await expect(nav.getByRole("link", { name, exact: true })).toBeVisible();
    const group = nav.getByRole("group", { name: "Help and info" });
    await expect(group.getByRole("link")).toHaveText(INFO);
    await expect(nav.getByRole("link", { name: "Urgent help" })).toBeVisible();
    await expect(page.locator("header:visible")).toHaveCount(0); // the bar is hidden at this width
  });

  test("/welcome has no sidebar and still shows the logo and Urgent help in the bar", async ({ page }) => {
    await page.goto("/welcome");
    await expect(appNav(page)).toHaveCount(0);
    await expect(page.locator("header").getByRole("link", { name: "Rumi home" })).toBeVisible();
    await expect(page.locator("header").getByRole("link", { name: "Urgent help" })).toBeVisible();
  });
});

test.describe("every app route", () => {
  for (const route of APP_PAGES) {
    test(`${route}: Urgent help, h1 and the five info links at the end`, async ({ page }) => {
      await page.goto(route);
      await expect(page.getByRole("link", { name: "Urgent help" }).first()).toBeVisible();
      await expect(page.locator("main h1")).toHaveCount(1);
      const info = page.locator("main footer").getByRole("link");
      await expect(info).toHaveText(INFO);
      for (const href of await info.evaluateAll((els) => els.map((e) => e.getAttribute("href") ?? ""))) {
        expect((await page.request.get(href)).status(), href).toBe(200);
      }
    });
  }
});

// ---- App shell, review pass 2 ----
const TAB_BAR = 'nav[aria-label="App"]:visible';

test.describe("focus is never hidden by the tab bar (375 x 667)", () => {
  test.use({ viewport: { width: 375, height: 667 } });

  test("walking through /home with Tab keeps every focused element above the tab bar and below the app bar", async ({ page }) => {
    await seed(page, "practiced");
    await page.goto("/home");
    await expect(page.locator('main [data-kind="primary"]')).toBeVisible();
    const seen: string[] = [];
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press("Tab");
      const box = await page.evaluate((sel) => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body) return null;
        const r = el.getBoundingClientRect();
        const bar = [...document.querySelectorAll(sel)].map((n) => n.getBoundingClientRect()).find((r) => r.height > 0)!;
        const top = document.querySelector("header")!.getBoundingClientRect();
        return {
          name: (el.textContent || "").trim().slice(0, 30),
          bottom: r.bottom,
          top: r.top,
          barTop: bar.top,
          headBottom: top.bottom,
          inBar: el.closest("nav, header, .skip-link") !== null || el.classList.contains("skip-link"),
        };
      }, 'nav[aria-label="App"]');
      if (!box || box.inBar) continue;
      seen.push(box.name);
      expect(box.bottom, `${box.name} is under the tab bar`).toBeLessThanOrEqual(box.barTop + 0.5);
      expect(box.top, `${box.name} is under the app bar`).toBeGreaterThanOrEqual(box.headBottom - 0.5);
    }
    expect(seen).toContain("Manage in Settings");
  });

  test("/welcome: the sticky Start bar is counted in the scroll padding", async ({ page }) => {
    await page.goto("/welcome");
    await expect(page.getByLabel("Name your helper")).toBeEnabled();
    const m = await page.evaluate(() => ({
      sticky: parseFloat(document.documentElement.style.getPropertyValue("--sticky-h")),
      padding: parseFloat(getComputedStyle(document.documentElement).scrollPaddingBottom),
    }));
    expect(m.sticky).toBeGreaterThan(40);
    expect(m.padding).toBeGreaterThanOrEqual(m.sticky);
  });
});

test.describe("the app bar stays on screen (375 x 667)", () => {
  test.use({ viewport: { width: 375, height: 667 } });

  test("Urgent help is visible after scrolling to the end, and the bar does not cover Back", async ({ page }) => {
    await seed(page, "practiced");
    await page.goto("/home");
    await expect(page.locator('main [data-kind="primary"]')).toBeVisible();
    const head = (await page.locator("header").boundingBox())!;
    const back = (await page.locator("main").getByRole("link", { name: /^Back/ }).boundingBox())!;
    expect(back.y).toBeGreaterThanOrEqual(head.y + head.height);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    const urgent = (await page.locator("header").getByRole("link", { name: "Urgent help" }).boundingBox())!;
    expect(urgent.y).toBeGreaterThanOrEqual(0);
    expect(urgent.y + urgent.height).toBeLessThanOrEqual(667);
    const pad = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop));
    expect(pad).toBeGreaterThanOrEqual(head.height);
  });
});

test.describe("the sidebar keeps Urgent help in view", () => {
  for (const [width, height, scale] of [
    [1280, 600, 1],
    [1280, 600, 1.5],
    [1024, 768, 1.5],
  ] as const) {
    test(`${width} x ${height} at text size ${scale}`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await seed(page, "plan", { textScale: scale });
      await page.goto("/home");
      const link = page.locator(TAB_BAR).getByRole("link", { name: "Urgent help" });
      await expect(link).toBeVisible();
      const bottom = await link.evaluate((el) => el.getBoundingClientRect().bottom);
      expect(bottom).toBeLessThanOrEqual(height);
    });
  }
});

test.describe("the app shell holds together at larger text", () => {
  for (const scale of [1, 1.15, 1.3, 1.5]) {
    for (const route of ["/home", "/welcome"]) {
      test(`${route} at 320 px, text size ${scale}`, async ({ page }) => {
        await page.setViewportSize({ width: 320, height: 568 });
        await seed(page, "plan", { textScale: scale });
        await page.goto(route);
        await expect(page.locator("main h1")).toBeVisible();
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overflow).toBeLessThanOrEqual(0);
        // The logo word and every tab label stay on one line.
        const split = await page.evaluate(() => {
          const lines = (el: Element) => {
            const style = getComputedStyle(el);
            return el.getBoundingClientRect().height / (parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.2);
          };
          const bad: string[] = [];
          for (const el of document.querySelectorAll('header [aria-label="Rumi home"] span, [data-tab-label]')) {
            if (el.getClientRects().length === 0) continue;
            const link = el.closest("a")!;
            if (lines(el) > 1.5 || el.scrollWidth > link.clientWidth + 1) bad.push(el.textContent ?? "");
          }
          return bad;
        });
        expect(split).toEqual([]);
      });
    }
  }
});

test.describe("forced colors", () => {
  test.use({ viewport: { width: 375, height: 667 } });

  test("only the active tab has a bar; the tab bar has a real top edge", async ({ page }) => {
    await page.emulateMedia({ forcedColors: "active" });
    await page.goto("/settings");
    const nav = page.locator(TAB_BAR);
    const widths = await nav.getByRole("link").evaluateAll((els) =>
      els.map((e) => ({
        current: e.getAttribute("aria-current") === "page",
        top: parseFloat(getComputedStyle(e).borderTopWidth),
      })),
    );
    expect(widths.filter((w) => w.current).every((w) => w.top >= 3)).toBe(true);
    expect(widths.filter((w) => !w.current).every((w) => w.top === 0)).toBe(true);
    const edge = await nav.locator("> div").evaluate((el) => parseFloat(getComputedStyle(el).borderTopWidth));
    expect(edge).toBeGreaterThanOrEqual(1);
  });
});
