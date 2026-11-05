import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { FOOTER_NAV, MAIN_NAV, ROUTES } from "../../src/lib/site";

const WIDTHS = [320, 375, 414, 768, 1280];
const BANNED = /lorem ipsum|\bTODO\b|placeholder|example\.com|undefined|\[object Object\]/i;

test.describe("every page meets the shipping rules", () => {
  for (const route of ROUTES) {
    test(`${route}: title, description, lang, no placeholder text`, async ({ page }) => {
      const res = await page.goto(route);
      expect(res?.status()).toBe(200);
      await expect(page.locator("html")).toHaveAttribute("lang", "en");
      expect((await page.title()).length).toBeGreaterThan(5);
      const desc = await page.locator('meta[name="description"]').getAttribute("content");
      expect(desc?.length ?? 0).toBeGreaterThan(40);
      await expect(page.locator("h1")).toHaveCount(1);
      expect(await page.locator("main").innerText()).not.toMatch(BANNED);
    });

    test(`${route}: no horizontal scroll at any width`, async ({ page }) => {
      for (const width of WIDTHS) {
        await page.setViewportSize({ width, height: 800 });
        await page.goto(route);
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overflow, `${route} at ${width}px`).toBeLessThanOrEqual(0);
      }
    });

    test(`${route}: no accessibility violations`, async ({ page }) => {
      await page.goto(route);
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
      expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
    });
  }

  test("page titles are unique", async ({ page }) => {
    const titles: string[] = [];
    for (const route of ROUTES) {
      await page.goto(route);
      titles.push(await page.title());
    }
    expect(new Set(titles).size).toBe(titles.length);
  });
});

test.describe("navigation works", () => {
  test("every header and footer link resolves", async ({ page, request }) => {
    for (const link of [...MAIN_NAV, ...FOOTER_NAV]) {
      const res = await request.get(link.href);
      expect(res.status(), link.href).toBe(200);
    }
    await page.goto("/");
    const hrefs = await page.locator("header a, footer a").evaluateAll((els) => els.map((e) => e.getAttribute("href") ?? ""));
    expect(hrefs.filter((h) => h === "" || h === "#")).toEqual([]);
  });

  test("logo goes home", async ({ page }) => {
    await page.goto("/help");
    await page.getByRole("link", { name: "Rumi home" }).click();
    await expect(page).toHaveURL(/\/$/);
  });

  test("footer shows the current year and tel links", async ({ page }) => {
    await page.goto("/");
    const footer = page.locator("footer");
    await expect(footer).toContainText(`© ${new Date().getFullYear()} Rumi`);
    await expect(footer.locator('a[href="tel:988"]')).toBeVisible();
    await expect(footer.locator('a[href="tel:911"]')).toBeVisible();
  });

  test("preview has no horizontal scroll on small phones", async ({ page }) => {
    for (const width of [320, 375, 414]) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto("/preview/index.html");
      await expect(page.locator("#root")).not.toBeEmpty();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `preview at ${width}px`).toBeLessThanOrEqual(0);
    }
  });

  test("preview opens and the app mounts", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/preview/index.html");
    await expect(page.locator("#root")).not.toBeEmpty();
    expect(errors).toEqual([]);
  });
});

test.describe("errors are friendly", () => {
  test("unknown page shows the custom 404 with a way home", async ({ page }) => {
    const res = await page.goto("/this-page-does-not-exist");
    expect(res?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: /can.t find that page/i })).toBeVisible();
    await expect(page.getByRole("link", { name: "Go to Home" })).toBeVisible();
    expect(await page.locator("body").innerText()).not.toMatch(/stack|exception|next\.js|500|ECONN/i);
  });
});
