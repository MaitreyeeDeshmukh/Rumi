import { expect, test, type Locator, type Page } from "@playwright/test";
import { PARENT } from "../../src/lib/nav";
import { ROUTES } from "../../src/lib/site";

// Grows with ROUTES: every later task that adds a route is covered without editing this file.
const BACK_ROUTES = ROUTES.filter((r) => r !== "/");

const back = (page: Page) => page.locator("main").getByRole("link", { name: /^Back/ });
const footerLink = (page: Page, name: string) => page.locator("footer").getByRole("link", { name, exact: true });

/** The footer Look switcher exists only after hydration, so clicks after this wait are client navigations. */
async function ready(page: Page) {
  await expect(page.locator("footer").getByRole("radio").first()).toBeVisible();
}

/** The first Tab stop inside main. Playwright has no :focusable selector, so this lists the tabbable elements. */
const TABBABLE = `a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])`;
function firstFocusable(page: Page): Locator {
  return page.locator("main").locator(TABBABLE).first();
}

for (const route of BACK_ROUTES) {
  test.describe(`Back on ${route}`, () => {
    test("is the first focusable element in main and a real link", async ({ page }) => {
      await page.goto(route);
      const first = firstFocusable(page);
      await expect(first).toHaveText("Back");
      expect(await first.evaluate((el) => el.tagName)).toBe("A");
      expect(await first.getAttribute("href")).toBeTruthy();
      await expect(back(page)).toHaveCount(1);
    });

    test("works without JavaScript and reaches the fixed parent", async ({ browser, baseURL }) => {
      const context = await browser.newContext({ javaScriptEnabled: false, baseURL });
      const page = await context.newPage();
      await page.goto(route);
      const parent = PARENT[route] ?? "/";
      await expect(back(page)).toHaveAttribute("href", parent);
      await back(page).click();
      await expect(page).toHaveURL(new RegExp(`${parent === "/" ? "/" : parent}$`));
      await context.close();
    });

    test("is visible without scrolling at 320 x 568", async ({ page }) => {
      await page.setViewportSize({ width: 320, height: 568 });
      await page.goto(route);
      const box = await back(page).boundingBox();
      expect(box).not.toBeNull();
      expect(box!.y).toBeGreaterThanOrEqual(0);
      expect(box!.y + box!.height).toBeLessThanOrEqual(568);
    });
  });
}

test("from the home page, footer Help then Back returns to /", async ({ page }) => {
  await page.goto("/");
  await ready(page);
  await footerLink(page, "Help").click();
  await expect(page).toHaveURL(/\/help$/);
  await back(page).click();
  await expect(page).toHaveURL(/\/$/);
});

test("after a reload, Back goes to the fixed parent", async ({ page }) => {
  await page.goto("/");
  await page.goto("/help");
  await page.reload();
  await back(page).click();
  await expect(page).toHaveURL(/\/$/);
});

test("new-tab sequence: /safety, Help, Back, Back", async ({ page }) => {
  await page.goto("/safety");
  await ready(page);
  await footerLink(page, "Help").click();
  await expect(page).toHaveURL(/\/help$/);
  await back(page).click();
  await expect(page).toHaveURL(/\/safety$/);
  await back(page).click();
  await expect(page).toHaveURL(/\/$/);
});

test("the accessible name names the destination", async ({ page }) => {
  await page.goto("/safety");
  await ready(page);
  await footerLink(page, "Help").click();
  await expect(page).toHaveURL(/\/help$/);
  await expect(back(page)).toHaveAccessibleName("Back to Safety and crisis help");
});

test("after Back, focus is on the new page's h1", async ({ page }) => {
  await page.goto("/");
  await ready(page);
  await footerLink(page, "Help").click();
  await expect(page).toHaveURL(/\/help$/);
  await back(page).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator("main h1")).toBeFocused();
});

for (const width of [375, 1280]) {
  test(`Back sits at the same place in main on every page at ${width} px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    const offsets: { route: string; x: number; y: number }[] = [];
    for (const route of BACK_ROUTES) {
      await page.goto(route);
      const main = await page.locator("main").boundingBox();
      const box = await back(page).boundingBox();
      expect(main && box, route).toBeTruthy();
      offsets.push({ route, x: box!.x - main!.x, y: box!.y - main!.y });
    }
    for (const o of offsets) {
      expect(Math.abs(o.x - offsets[0].x), `${o.route} x`).toBeLessThanOrEqual(2);
      expect(Math.abs(o.y - offsets[0].y), `${o.route} y`).toBeLessThanOrEqual(2);
    }
  });
}

test("a missing page has Back to /", async ({ page }) => {
  await page.goto("/no-such-page-here");
  await expect(back(page)).toHaveAttribute("href", "/");
  await expect(firstFocusable(page)).toHaveText("Back");
});

test("the error page has Back first, Urgent help, Try again and a way home", async ({ page }) => {
  await page.goto("/_error-test");
  const main = page.locator("main");
  await expect(main.getByRole("heading", { name: "Something went wrong." })).toBeVisible();
  await expect(firstFocusable(page)).toHaveText("Back");
  await expect(page.getByRole("link", { name: "Urgent help" }).first()).toBeVisible();
  await expect(main.getByRole("button", { name: "Try again" })).toBeVisible();
  await expect(main.getByRole("link", { name: "Go to the home page" })).toBeVisible();
});

test("/home opened directly has Back to /", async ({ page }) => {
  await page.goto("/home");
  await expect(back(page)).toHaveAttribute("href", "/");
});
