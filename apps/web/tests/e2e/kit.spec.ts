import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { seed } from "./fixtures/rumiState";

const main = (page: Page) => page.locator("main");
const primary = (page: Page) => main(page).locator('[data-kind="primary"]');

/** Counts AudioContext constructions, so the finish sound can be asserted without hearing it. */
async function countAudio(page: Page) {
  await page.addInitScript(() => {
    (window as unknown as { __audio: number }).__audio = 0;
    class Fake {
      currentTime = 0;
      destination = {};
      constructor() {
        (window as unknown as { __audio: number }).__audio++;
      }
      createOscillator() {
        return { frequency: {}, connect: () => ({ connect: () => {} }), start() {}, stop() {} };
      }
      createGain() {
        return { gain: {}, connect: () => {} };
      }
    }
    (window as unknown as { AudioContext: unknown }).AudioContext = Fake;
  });
}
const audio = (page: Page) => page.evaluate(() => (window as unknown as { __audio: number }).__audio);

test.describe("kit (/kit)", () => {
  test("empty state: needs a plan and a card, one primary goes to Get ready", async ({ page }) => {
    await seed(page, "plan");
    await page.goto("/kit");
    await expect(main(page).getByRole("link", { name: /^Back/ })).toBeVisible();
    await expect(main(page).getByRole("heading", { level: 1 })).toHaveText("Your kit.");
    await expect(main(page).getByText("Your kit needs a plan and a support card.")).toBeVisible();
    await expect(primary(page)).toHaveCount(1);
    await expect(primary(page)).toHaveText("Go to Get ready");
    await expect(primary(page)).toHaveAttribute("href", "/get-ready");
    await primary(page).click();
    await expect(page).toHaveURL(/\/get-ready$/);
  });

  test("ready: text, Copy kit primary, Print kit secondary, copy announces Copied.", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await seed(page, "planCard");
    await page.goto("/kit");
    await expect(main(page).getByRole("heading", { level: 1 })).toHaveText("Your kit is ready.");
    const text = main(page).locator("pre.printable");
    await expect(text).toContainText("My visit plan");
    await expect(text).toContainText("- I have had headaches for two weeks.");
    await expect(text).toContainText("Please speak slowly.");
    await expect(primary(page)).toHaveCount(1);
    await expect(primary(page)).toHaveText("Copy kit");
    await expect(main(page).getByRole("button", { name: "Print kit" })).toHaveAttribute("data-kind", "secondary");
    await primary(page).click();
    await expect(main(page).getByText("Copied.")).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("My visit plan");
  });

  test("print shows only the kit text", async ({ page }) => {
    await seed(page, "planCard");
    await page.goto("/kit");
    await expect(main(page).locator("pre.printable")).toBeVisible();
    await page.emulateMedia({ media: "print" });
    await expect(main(page).locator("pre.printable")).toBeVisible();
    await expect(main(page).getByRole("heading", { level: 1 })).toBeHidden();
    await expect(main(page).getByRole("button", { name: "Copy kit" })).toBeHidden();
  });

  test("finish sound plays once only when the setting is on", async ({ page }) => {
    await countAudio(page);
    await seed(page, "planCard", { finishSound: false });
    await page.goto("/kit");
    await expect(primary(page)).toHaveText("Copy kit");
    expect(await audio(page)).toBe(0);
  });

  test("finish sound is on: one tone", async ({ page }) => {
    await countAudio(page);
    await seed(page, "planCard", { finishSound: true });
    await page.goto("/kit");
    await expect(primary(page)).toHaveText("Copy kit");
    await expect.poll(() => audio(page)).toBe(1);
  });

  test("no accessibility violations (ready)", async ({ page }) => {
    await seed(page, "planCard");
    await page.goto("/kit");
    await expect(primary(page)).toHaveText("Copy kit");
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.nodes[0]?.html}`)).toEqual([]);
  });
});
