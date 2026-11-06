import { expect, test, type Page } from "@playwright/test";

// A short window makes any page long enough to scroll.
test.use({ viewport: { width: 800, height: 400 } });

const thumb = (page: Page) => page.locator("[data-overlay-scrollbar]");
/** The component sets data-empty when it mounts, so scrolling after this is seen by its listener. */
async function open(page: Page) {
  await page.goto("/");
  await expect(thumb(page)).toHaveAttribute("data-empty", "false");
}
const scrollY = (page: Page) => page.evaluate(() => window.scrollY);

test("the native scrollbar takes no layout width and the thumb is not announced", async ({ page }) => {
  await open(page);
  expect(await page.evaluate(() => document.documentElement.scrollHeight > window.innerHeight)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.clientWidth === window.innerWidth)).toBe(true);
  await expect(thumb(page)).toHaveAttribute("aria-hidden", "true");
});

test("the thumb shows while the page scrolls and fades out afterwards", async ({ page }) => {
  await open(page);
  await expect(thumb(page)).not.toHaveAttribute("data-showing", "true");
  await page.evaluate(() => window.scrollBy(0, 200));
  await expect(thumb(page)).toHaveAttribute("data-showing", "true");
  await expect.poll(() => thumb(page).evaluate((el) => getComputedStyle(el).opacity)).not.toBe("0");
  await page.waitForTimeout(1500);
  await expect(thumb(page)).toHaveAttribute("data-showing", "false");
  expect(await thumb(page).evaluate((el) => getComputedStyle(el).opacity)).toBe("0");
});

test("keyboard scrolling still works", async ({ page }) => {
  await open(page);
  await page.keyboard.press("PageDown");
  await expect.poll(() => scrollY(page)).toBeGreaterThan(0);
  const afterPageDown = await scrollY(page);
  await page.keyboard.press("End");
  await expect.poll(() => scrollY(page)).toBeGreaterThan(afterPageDown);
  await page.keyboard.press("Home");
  await expect.poll(() => scrollY(page)).toBe(0);
});

test("the visible thumb can be dragged", async ({ page }) => {
  await open(page);
  await page.evaluate(() => window.scrollBy(0, 50));
  await expect(thumb(page)).toHaveAttribute("data-showing", "true");
  const box = (await thumb(page).boundingBox())!;
  const before = await scrollY(page);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 40, { steps: 4 });
  await page.mouse.up();
  expect(await scrollY(page)).toBeGreaterThan(before);
});
