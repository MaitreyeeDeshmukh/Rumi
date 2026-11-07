import { expect, test, type Page } from "@playwright/test";
import { seed } from "./fixtures/rumiState";

const main = (page: Page) => page.locator("main");
const settings = (page: Page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem("rumi.v1") ?? "null")?.settings ?? null);

test.describe("settings (/settings)", () => {
  test("shell: Back first, no primary, four data lines, help links at the end", async ({ page }) => {
    await seed(page, "empty");
    await page.goto("/settings");
    await expect(main(page).getByRole("link", { name: /^Back/ })).toHaveAttribute("href", "/home");
    await expect(main(page).locator('[data-kind="primary"]')).toHaveCount(0);
    for (const legend of ["About you", "Reading", "Look", "Sound", "Memory", "Your data", "Delete everything"]) {
      await expect(main(page).getByRole("group", { name: legend })).toBeVisible();
    }
    const data = main(page).getByRole("group", { name: "Your data" }).locator("li");
    await expect(data).toHaveCount(4);
    await expect(data.nth(3)).toContainText("Rumi never sends anything to a clinic or a person.");
    await expect(main(page).getByRole("navigation", { name: "Help and info" }).getByRole("link")).toHaveCount(5);
  });

  test("every control saves at once, applies, announces Saved., and survives a reload", async ({ page }) => {
    await seed(page, "empty");
    await page.goto("/settings");
    const html = page.locator("html");
    await main(page).getByRole("textbox", { name: "What should I call you?" }).fill("Sam");
    await expect(main(page).getByText("Saved.", { exact: true })).toBeVisible();
    await main(page).getByRole("radio", { name: "Listen", exact: true }).click();
    await main(page).getByRole("radio", { name: /Low Light/ }).click();
    await expect(html).toHaveAttribute("data-app-theme", "low");
    await main(page).getByRole("radio", { name: "130", exact: true }).click();
    await expect.poll(() => html.evaluate((el) => el.style.getPropertyValue("--scale"))).toBe("1.3");
    await main(page).getByRole("switch", { name: "Reduce motion" }).click();
    await expect(html).toHaveAttribute("data-reduced-motion", "true");
    await main(page).getByRole("switch", { name: "Play a soft sound when my kit is ready" }).click();
    expect(await settings(page)).toMatchObject({
      name: "Sam",
      outputMode: "listen",
      theme: "low",
      textScale: 1.3,
      reducedMotion: true,
      finishSound: true,
    });
    await page.reload();
    await expect(html).toHaveAttribute("data-app-theme", "low");
    await expect(main(page).getByRole("textbox", { name: "What should I call you?" })).toHaveValue("Sam");
    await expect(main(page).getByRole("radio", { name: "130", exact: true })).toBeChecked();
  });

  test("Memory: off by default, toggle saves, Forget everything asks first", async ({ page }) => {
    await seed(page, "empty");
    await page.goto("/settings");
    const toggle = main(page).getByRole("switch", { name: "Remember my support sentences" });
    await expect(toggle).not.toBeChecked();
    await toggle.click();
    await expect(main(page).getByText("Nothing yet.")).toBeVisible();
    expect((await settings(page)).memoryOptIn).toBe(true);
    await main(page).getByRole("button", { name: "Forget everything" }).click();
    const sheet = page.getByRole("dialog", { name: "Forget everything?" });
    await sheet.getByRole("button", { name: "Keep them" }).click();
    expect((await settings(page)).memoryOptIn).toBe(true);
    await main(page).getByRole("button", { name: "Forget everything" }).click();
    await page.getByRole("dialog", { name: "Forget everything?" }).getByRole("button", { name: "Delete" }).click();
    await expect.poll(async () => (await settings(page)).memoryOptIn).toBe(false);
  });

  test("Delete everything: cancel keeps data; Delete clears it, goes to /welcome and announces", async ({ page }) => {
    await seed(page, "plan", { name: "Sam" });
    await page.goto("/settings");
    await main(page).getByRole("button", { name: "Delete everything" }).click();
    const sheet = page.getByRole("dialog", { name: "Delete everything?" });
    await sheet.getByRole("button", { name: "Cancel" }).click();
    await expect(sheet).toHaveCount(0);
    expect((await settings(page)).name).toBe("Sam");

    await main(page).getByRole("button", { name: "Delete everything" }).click();
    await page.getByRole("dialog", { name: "Delete everything?" }).getByRole("button", { name: "Delete" }).click();
    await expect(page).toHaveURL(/\/welcome$/);
    await expect(page.locator("#rumi-announce")).toHaveText("Everything is deleted.");
    const left = await page.evaluate(() => JSON.parse(localStorage.getItem("rumi.v1") ?? "null"));
    expect(left?.plan).toBeUndefined();
    expect(left?.settings?.name ?? "").toBe("");
  });
});
