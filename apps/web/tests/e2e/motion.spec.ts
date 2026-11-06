import { expect, test, type Page } from "@playwright/test";
import { ROUTES } from "../../src/lib/site";

// Needs the site header (Task 7): the menu sheet is opened from its Menu button.
// Until Task 7 lands the "menu sheet" tests fail; the route tests need only the pages.

const running = (page: Page) =>
  page.evaluate(() => document.getAnimations().filter((a) => a.playState === "running").length);

const looping = (page: Page) =>
  page.evaluate(
    () => document.getAnimations().filter((a) => a.effect?.getComputedTiming().iterations === Infinity).length,
  );

// Seed rumi.v1 only when the key is absent, so a reload does not overwrite what the page saved.
async function seedReducedMotion(page: Page) {
  await page.addInitScript(() => {
    if (localStorage.getItem("rumi.v1") === null) {
      localStorage.setItem("rumi.v1", JSON.stringify({ version: 1, settings: { reducedMotion: true } }));
    }
  });
}

async function openMenuSheet(page: Page) {
  const width = page.viewportSize()?.width ?? 0;
  test.skip(width >= 1024, "The Menu button shows under 1024 px only");
  await page.getByRole("button", { name: "Menu" }).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet).toBeVisible();
  return sheet;
}

test.describe("OS reduced motion", () => {
  test.use({ reducedMotion: "reduce" });

  for (const route of ROUTES) {
    test(`${route}: no running animation after 500 ms`, async ({ page }) => {
      await page.goto(route);
      await page.waitForTimeout(500);
      expect(await running(page)).toBe(0);
    });
  }

  test("menu sheet opens with no transition time", async ({ page }) => {
    await page.goto("/");
    const sheet = await openMenuSheet(page);
    const duration = await sheet.evaluate((el) => parseFloat(getComputedStyle(el).transitionDuration));
    expect(duration).toBeLessThanOrEqual(0.001);
    await page.waitForTimeout(500);
    expect(await running(page)).toBe(0);
  });
});

test.describe("Reduce motion setting, no OS preference", () => {
  test.use({ reducedMotion: "no-preference" });

  for (const route of ROUTES) {
    test(`${route}: no running animation after 500 ms`, async ({ page }) => {
      await seedReducedMotion(page);
      await page.goto(route);
      await page.waitForTimeout(500);
      expect(await running(page)).toBe(0);
    });
  }

  test("menu sheet opens with no transition time", async ({ page }) => {
    await seedReducedMotion(page);
    await page.goto("/");
    const sheet = await openMenuSheet(page);
    const duration = await sheet.evaluate((el) => parseFloat(getComputedStyle(el).transitionDuration));
    expect(duration).toBeLessThanOrEqual(0.001);
    await page.waitForTimeout(500);
    expect(await running(page)).toBe(0);
  });
});

test.describe("motion allowed", () => {
  test.use({ reducedMotion: "no-preference" });

  for (const route of ROUTES) {
    test(`${route}: nothing loops`, async ({ page }) => {
      await page.goto(route);
      expect(await looping(page)).toBe(0);
    });
  }

  test("menu sheet does not loop", async ({ page }) => {
    await page.goto("/");
    await openMenuSheet(page);
    expect(await looping(page)).toBe(0);
  });
});

test.describe("JavaScript off", () => {
  test.use({ javaScriptEnabled: false });

  test("the home heading is visible", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("h1")).toBeVisible();
  });
});
