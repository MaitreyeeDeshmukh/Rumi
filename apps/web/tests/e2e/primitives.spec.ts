import { expect, test, type Page } from "@playwright/test";

const THEMES = ["soft", "contrast", "low"] as const;

/** The computed colour a CSS variable resolves to (a probe element turns var(--x) into rgb). */
function resolved(page: Page, token: string): Promise<string> {
  return page.evaluate((t) => {
    const probe = document.createElement("div");
    probe.style.backgroundColor = `var(${t})`;
    document.body.append(probe);
    const colour = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return colour;
  }, token);
}

const setTheme = (page: Page, theme: string) =>
  page.evaluate((t) => document.documentElement.setAttribute("data-app-theme", t), theme);

// Tailwind wiring: utility classes must resolve to the theme variables in all three looks.
for (const theme of THEMES) {
  test.describe(`theme ${theme}`, () => {
    test("the primary link uses --primary", async ({ page }) => {
      await page.goto("/");
      await setTheme(page, theme);
      const link = page.locator('main [data-kind="primary"]').first();
      const target = await resolved(page, "--primary");
      // The button colour eases over 150 ms after the look changes, so wait for it to settle.
      await expect.poll(() => link.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(target);
    });

    test("the FAQ panel uses --surface", async ({ page }) => {
      await page.goto("/");
      await setTheme(page, theme);
      const panel = page.locator("[data-faq-panel]").first();
      const target = await resolved(page, "--surface");
      await expect.poll(() => panel.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(target);
    });

    test("the menu sheet uses --surface", async ({ page }) => {
      await page.setViewportSize({ width: 600, height: 800 });
      await page.goto("/");
      await expect(page.locator("footer").getByRole("radio").first()).toBeVisible();
      await setTheme(page, theme);
      await page.getByRole("button", { name: "Menu" }).click();
      const sheet = page.getByRole("dialog", { name: "Menu" });
      await expect(sheet).toBeVisible();
      const target = await resolved(page, "--surface");
      await expect.poll(() => sheet.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(target);
    });
  });
}
