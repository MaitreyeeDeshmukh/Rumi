import { expect, test, type Page } from "@playwright/test";
import { seed } from "./fixtures/rumiState";

const main = (page: Page) => page.locator("main");
const preview = (page: Page) => page.locator("pre.share-preview");
const copyButton = (page: Page) => main(page).getByRole("button", { name: "Copy text" });

test.describe("share (/share)", () => {
  test("starts with every box off and a visible reason on the disabled Copy text", async ({ page }) => {
    await seed(page, "recap");
    await page.goto("/share");
    await expect(main(page).getByRole("link", { name: /^Back/ })).toHaveAttribute("href", "/home");
    const boxes = main(page).getByRole("checkbox");
    await expect(boxes).toHaveCount(7);
    for (const box of await boxes.all()) await expect(box).not.toBeChecked();
    await expect(preview(page)).toHaveText("Nothing is selected yet.");
    await expect(copyButton(page)).toBeDisabled();
    await expect(main(page).locator('[data-kind="primary"]')).toHaveCount(1);
    await expect(main(page).getByText("Rumi does not send anything. You decide.")).toBeVisible();
  });

  test("the preview and the clipboard hold the same text", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await seed(page, "recap");
    await page.goto("/share");
    await main(page).getByRole("checkbox", { name: "My plan" }).click();
    await main(page).getByRole("checkbox", { name: "How I like to be supported" }).click();
    await expect(preview(page)).toContainText("Main concern: Headaches for two weeks");
    await expect(preview(page)).toContainText("- Please speak slowly.");
    const shown = await preview(page).innerText();
    await copyButton(page).click();
    await expect(main(page).getByText("Copied.")).toBeVisible();
    expect((await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, "\n")).toBe(shown);
    await main(page).getByRole("checkbox", { name: "My plan" }).click(); // off again
    await expect(preview(page)).not.toContainText("Main concern");
  });

  test("sections without data are disabled with a reason", async ({ page }) => {
    await seed(page, "empty");
    await page.goto("/share");
    await expect(main(page).getByText("Nothing here yet.")).toHaveCount(7);
    for (const box of await main(page).getByRole("checkbox").all()) await expect(box).toBeDisabled();
    await expect(copyButton(page)).toBeDisabled();
  });

  test("Share… shows only when the browser can share, and shares the same text", async ({ page }) => {
    await seed(page, "recap");
    await page.addInitScript(() => Object.defineProperty(navigator, "share", { value: undefined, configurable: true }));
    await page.goto("/share");
    await expect(copyButton(page)).toBeVisible();
    await expect(main(page).getByRole("button", { name: "Share…" })).toHaveCount(0);

    const other = await page.context().newPage();
    await seed(other, "recap");
    await other.addInitScript(() => {
      Object.defineProperty(navigator, "share", {
        value: (d: { text: string }) => {
          (window as unknown as { shared: string }).shared = d.text;
          return Promise.resolve();
        },
        configurable: true,
      });
    });
    await other.goto("/share");
    await main(other).getByRole("checkbox", { name: "My plan" }).click();
    await main(other).getByRole("button", { name: "Share…" }).click();
    const sent = await other.evaluate(() => (window as unknown as { shared: string }).shared);
    expect(sent).toBe(await preview(other).innerText());
  });
});
