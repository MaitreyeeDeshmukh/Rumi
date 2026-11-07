import { expect, test, type Page } from "@playwright/test";
import { seed } from "./fixtures/rumiState";

const main = (page: Page) => page.locator("main");
const primary = (page: Page) => main(page).locator('[data-kind="primary"]');
const SCENARIOS = [
  "Book an appointment",
  "I am running late",
  "Ask them to repeat",
  "Ask for written instructions",
  "Ask what to do next",
];

/** A fake voice that records what it was asked to say. */
const fakeSpeech = () =>
  Object.defineProperty(window, "speechSynthesis", {
    configurable: true,
    value: {
      cancels: 0,
      spoken: "",
      speak(u: { text: string }) {
        this.spoken = u.text;
      },
      cancel() {
        this.cancels++;
      },
    },
  });

test.describe("say it (/say-it)", () => {
  test("list state: five scenarios, no primary; script state: Copy is the one primary", async ({ page }) => {
    await seed(page, "empty");
    await page.addInitScript(() => Object.defineProperty(window, "speechSynthesis", { value: undefined, configurable: true }));
    await page.goto("/say-it");
    await expect(main(page).getByRole("link", { name: /^Back/ })).toHaveAttribute("href", "/home");
    for (const name of SCENARIOS) await expect(main(page).getByRole("button", { name, exact: true })).toBeVisible();
    await expect(primary(page)).toHaveCount(0);

    await main(page).getByRole("button", { name: "Book an appointment", exact: true }).click();
    const box = main(page).getByRole("textbox", { name: "Your script" });
    await expect(box).toHaveValue(/book an appointment/);
    await expect(box).toHaveValue(/\[day\]/);
    await expect(primary(page)).toHaveCount(1);
    await expect(primary(page)).toHaveText("Copy");
    await expect(main(page).getByRole("button", { name: "Read aloud" })).toHaveCount(0); // no speech here
    await expect(main(page).getByText("Rumi does not call anyone. You say it yourself.")).toBeVisible();

    const long = (await box.inputValue()).length;
    await main(page).getByRole("button", { name: "Make it simpler" }).click();
    await expect(main(page).getByRole("button", { name: "Make it simpler" })).toHaveCount(0); // level 3
    await expect.poll(async () => (await box.inputValue()).length).toBeLessThan(long);

    await main(page).getByRole("button", { name: "Pick another" }).click();
    await expect(primary(page)).toHaveCount(0);
    await expect(main(page).getByRole("button", { name: "I am running late", exact: true })).toBeVisible();
  });

  test("Read aloud can be stopped with the button and with Esc", async ({ page }) => {
    await seed(page, "empty");
    await page.addInitScript(fakeSpeech);
    await page.goto("/say-it");
    await main(page).getByRole("button", { name: "I am running late", exact: true }).click();
    await main(page).getByRole("button", { name: "Read aloud" }).click();
    const speech = () => page.evaluate(() => window.speechSynthesis as unknown as { spoken: string; cancels: number });
    expect((await speech()).spoken).toContain("running late");
    await expect(main(page).getByRole("button", { name: "Stop reading" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(main(page).getByRole("button", { name: "Read aloud" })).toBeVisible();
    await main(page).getByRole("button", { name: "Read aloud" }).click();
    await main(page).getByRole("button", { name: "Stop reading" }).click();
    await expect(main(page).getByRole("button", { name: "Read aloud" })).toBeVisible();
    expect((await speech()).cancels).toBeGreaterThanOrEqual(2);
  });
});
