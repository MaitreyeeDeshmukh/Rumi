import { expect, test, type Page } from "@playwright/test";
import { ROUTES } from "../../src/lib/site";

// Later tasks extend ROUTES. The header and footer (Task 7) hold the control, so this spec turns green then.
const control = (page: Page) => page.getByRole("link", { name: "Urgent help" }).first();

for (const route of ROUTES) {
  test.describe(`Urgent help on ${route}`, () => {
    test("is visible", async ({ page }) => {
      await page.goto(route);
      await expect(control(page)).toBeVisible();
    });

    test("is a real link to /safety without JavaScript", async ({ browser, baseURL }) => {
      const context = await browser.newContext({ javaScriptEnabled: false, baseURL });
      const page = await context.newPage();
      await page.goto(route);
      const link = control(page);
      await expect(link).toHaveAttribute("href", "/safety");
      expect(await link.evaluate((el) => el.tagName)).toBe("A");
      await link.click();
      await expect(page).toHaveURL(/\/safety$/);
      await context.close();
    });

    test("opens the crisis dialog with three links", async ({ page }) => {
      await page.goto(route);
      await control(page).click();
      const dialog = page.getByRole("dialog", { name: "You may need help right now" });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole("link", { name: "Call 988" })).toHaveAttribute("href", "tel:988");
      await expect(dialog.getByRole("link", { name: "Text 988" })).toHaveAttribute("href", "sms:988");
      await expect(dialog.getByRole("link", { name: "Call 911" })).toHaveAttribute("href", "tel:911");
      await expect(page).toHaveURL(new RegExp(`${route === "/" ? "/$" : route}$`));
    });

    test("cannot be closed with Escape, even twice", async ({ page }) => {
      await page.goto(route);
      await control(page).click();
      await expect(page.locator("dialog[open]")).toHaveCount(1);
      await page.keyboard.press("Escape");
      await page.waitForTimeout(150);
      await expect(page.locator("dialog[open]")).toHaveCount(1);
      await page.keyboard.press("Escape");
      await page.waitForTimeout(150);
      await expect(page.locator("dialog[open]")).toHaveCount(1);
    });

    test("I understand closes it and focus returns to the opener", async ({ page }) => {
      await page.goto(route);
      const opener = control(page);
      await opener.click();
      await page.getByRole("button", { name: "I understand" }).click();
      await expect(page.locator("dialog[open]")).toHaveCount(0);
      await expect(opener).toBeFocused();
    });
  });
}
