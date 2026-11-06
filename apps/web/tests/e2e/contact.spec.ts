import { expect, test, type Page } from "@playwright/test";
import { buildPlainMessage } from "../../src/lib/contact";

const email = process.env.NEXT_PUBLIC_CONTACT_EMAIL ?? "team@rumi.test";

const primary = (page: Page) => page.locator('main [data-kind="primary"]');
const message = (page: Page) => page.getByLabel("Your message");

/** The Copy buttons render only after hydration, so seeing one means typing will reach React. */
async function ready(page: Page) {
  await expect(page.getByRole("button", { name: "Copy my message" })).toBeVisible();
}

/** One bubbling listener on document runs after React's own handler, so it sees defaultPrevented. */
async function watchClicks(page: Page) {
  await page.evaluate(() => {
    document.addEventListener("click", (e) => {
      (window as unknown as { __prevented: boolean }).__prevented = e.defaultPrevented;
      e.preventDefault(); // stops the browser from opening a mail client
    });
  });
}
const prevented = (page: Page) => page.evaluate(() => (window as unknown as { __prevented: boolean }).__prevented);

test.describe("contact page", () => {
  test.use({ permissions: ["clipboard-read", "clipboard-write"] });

  test("has the h1 and one primary mailto link", async ({ page }) => {
    await page.goto("/contact");
    await expect(page.locator("h1")).toHaveText("Contact us.");
    await expect(primary(page)).toHaveCount(1);
    await expect(primary(page)).toHaveText("Open in my email app");
    expect(await primary(page).evaluate((el) => el.tagName)).toBe("A");
    expect(await primary(page).getAttribute("href")).toMatch(new RegExp(`^mailto:${email.replace(/[.+]/g, "\\$&")}`));
  });

  test("typing changes the link", async ({ page }) => {
    await page.goto("/contact");
    await ready(page);
    const before = await primary(page).getAttribute("href");
    await message(page).fill("Hello team, I have a question.");
    await page.getByLabel("Your name (optional)").fill("Sam");
    await page.getByLabel("What is this about?").selectOption("feedback");
    const after = (await primary(page).getAttribute("href")) ?? "";
    expect(after).not.toBe(before);
    expect(after).toContain("subject=Rumi%3A%20Feedback");
    expect(after).toContain("Name%3A%20Sam");
    expect(after).toContain("Hello%20team");
  });

  test("an empty message stops the click, shows the error and focuses the field", async ({ page }) => {
    await page.goto("/contact");
    await ready(page);
    await watchClicks(page);
    await primary(page).click();
    expect(await prevented(page)).toBe(true);
    await expect(page.getByText("Problem: Write a message first. Use at least 10 characters.")).toBeVisible();
    await expect(message(page)).toBeFocused();
    await expect(page.getByText("Your email app should open.")).toHaveCount(0);
  });

  test("a valid message lets the click through and keeps the notice", async ({ page }) => {
    await page.goto("/contact");
    await ready(page);
    await message(page).fill("Hello team, I have a question.");
    await watchClicks(page);
    await primary(page).click();
    expect(await prevented(page)).toBe(false);
    await expect(page.getByText("Your email app should open. You press send.")).toBeVisible();
    await page.waitForTimeout(1500);
    await expect(page.getByText("Your email app should open. You press send.")).toBeVisible();
  });

  test("Copy my message copies the plain text and says Copied.", async ({ page }) => {
    await page.goto("/contact");
    await ready(page);
    await message(page).fill("Line one of my note\nLine two é");
    await page.getByLabel("Your name (optional)").fill("Sam");
    await page.bringToFront(); // the clipboard only works in a focused page
    await page.getByRole("button", { name: "Copy my message" }).click();
    await expect(page.getByText("Copied.")).toBeVisible();
    // Windows turns \n into \r\n on the clipboard, so compare with one line-break style.
    const clip = (await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, "\n");
    expect(clip).toBe(buildPlainMessage({ name: "Sam", message: "Line one of my note\nLine two é" }));
  });

  test("Copy email copies the address", async ({ page }) => {
    await page.goto("/contact");
    await ready(page);
    await page.bringToFront();
    await page.getByRole("button", { name: "Copy email" }).click();
    await expect(page.getByText("Copied.")).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(email);
  });

  test("the counter reads like 12 of 1000", async ({ page }) => {
    await page.goto("/contact");
    await ready(page);
    await message(page).fill("Hello there!");
    await expect(page.getByText("12 of 1000")).toBeVisible();
  });

  test("a long message adds the long-link notice", async ({ page }) => {
    await page.goto("/contact");
    await ready(page);
    await expect(page.getByText("Your message is long.")).toHaveCount(0);
    await message(page).fill("é".repeat(1000));
    await expect(page.getByText('Your message is long. If your email app cuts it off, use "Copy my message".')).toBeVisible();
  });

  test("In an emergency has the three call links", async ({ page }) => {
    await page.goto("/contact");
    const card = page.getByRole("region", { name: "In an emergency" });
    for (const href of ["tel:988", "sms:988", "tel:911"]) await expect(card.locator(`a[href="${href}"]`)).toHaveCount(1);
  });

  test("the order is lead, form, email card, emergency card, with one primary", async ({ page }) => {
    await page.goto("/contact");
    const order = await page.evaluate(() => {
      const at = (el: Element | null) => (el ? Array.from(document.querySelectorAll("*")).indexOf(el) : -1);
      const heading = (name: string) =>
        Array.from(document.querySelectorAll("main h2")).find((h) => h.textContent === name) ?? null;
      return [
        at(document.querySelector("main .intro")),
        at(heading("Write to us")),
        at(heading("Email us")),
        at(heading("In an emergency")),
      ];
    });
    expect(order.every((n) => n > 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    await expect(primary(page)).toHaveCount(1);
  });

  test("at 375 x 667 the primary is near the top", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/contact");
    const box = await primary(page).boundingBox();
    expect(box).not.toBeNull();
    expect(box!.y).toBeLessThan(667 * 1.5);
  });
});

test.describe("contact page without JavaScript", () => {
  test("keeps the link and the address, and shows no Copy button", async ({ browser, baseURL }) => {
    const context = await browser.newContext({ javaScriptEnabled: false, baseURL });
    const page = await context.newPage();
    await page.goto("/contact");
    await expect(primary(page)).toBeVisible();
    expect(await primary(page).getAttribute("href")).toContain(`mailto:${email}`);
    await expect(page.locator("main").getByText(email, { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Copy/ })).toHaveCount(0);
    await expect(page.getByLabel("Your message")).toBeHidden();
    await context.close();
  });
});
