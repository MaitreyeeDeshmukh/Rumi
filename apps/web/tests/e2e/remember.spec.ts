import { expect, test, type Page } from "@playwright/test";
import { seed } from "./fixtures/rumiState";

const main = (page: Page) => page.locator("main");
const primaries = (page: Page) => main(page).locator('[data-kind="primary"]');

/** Counts microphone requests, and makes the next `n` recap calls fail. */
async function setup(page: Page, failures = 0) {
  await page.addInitScript((n) => {
    (window as unknown as { __mic: number }).__mic = 0;
    window.__rumiFailRecap = n;
    const md = navigator.mediaDevices;
    if (md) md.getUserMedia = () => (((window as unknown as { __mic: number }).__mic += 1), Promise.reject(new Error("no")));
  }, failures);
  await seed(page, "empty");
}

test("sample visit flow: one primary per state, recap proof, no microphone", async ({ page }) => {
  await setup(page);
  await page.goto("/remember");
  await expect(main(page).getByRole("link", { name: /^Back/ })).toBeVisible();
  await expect(page.getByText("Sample visit, made by our team")).toBeVisible();
  await expect(primaries(page)).toHaveCount(1);
  await expect(page.getByRole("button", { name: /record|microphone/i })).toHaveCount(0);

  await page.getByRole("button", { name: "Use the sample visit" }).click();
  await expect(page.getByText("Which voice is you?")).toBeVisible();
  const me = page.getByRole("button", { name: "This voice is me" });
  await expect(me).toBeDisabled();
  await expect(page.getByText("Pick a voice first.")).toBeVisible();
  await expect(primaries(page)).toHaveCount(1);
  await page.getByRole("radio", { name: /Voice B/ }).click();
  await expect(me).toBeEnabled();
  await me.click();

  const share = main(page).getByRole("link", { name: "Go to Share" });
  await expect(share).toHaveAttribute("href", "/share");
  await expect(primaries(page)).toHaveCount(1);
  for (const h of ["What we talked about", "What the clinician told me to do", "Medicines I heard", "My next steps"]) {
    await expect(main(page).getByRole("heading", { name: h })).toBeVisible();
  }
  await expect(main(page).getByText("I could not confirm this").first()).toBeVisible();
  await expect(main(page).locator('[data-tone="warn"] svg')).toBeVisible();
  await expect(main(page).getByRole("heading", { name: "What I said myself" })).toBeVisible();
  await expect(main(page).getByRole("heading", { name: "I asked" })).toBeVisible();
  await expect(page.getByText("Check anything important with your clinician.")).toBeVisible();
  await expect(page.getByText("Saved example")).toHaveCount(0);

  // A point highlights its source line (mark plus hidden words) and toggles back.
  const point = main(page).getByRole("button", { name: /Keep a headache diary/ });
  await expect(point).toHaveAttribute("aria-pressed", "false");
  await point.click();
  await expect(point).toHaveAttribute("aria-pressed", "true");
  await expect(main(page).locator("mark")).toHaveCount(1);
  await expect(main(page).locator("mark")).toContainText("Used in the summary");
  await point.click();
  await expect(main(page).locator("mark")).toHaveCount(0);

  // The recap is saved, and the microphone was never asked for.
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("rumi.v1") ?? "{}").recap?.mySpeaker);
  expect(saved).toBe("B");
  expect(await page.evaluate(() => (window as unknown as { __mic: number }).__mic)).toBe(0);

  await share.click();
  await expect(page).toHaveURL(/\/share$/);
});

test("one failure shows Try again, two failures load the saved example", async ({ page }) => {
  await setup(page, 2);
  await page.goto("/remember");
  await page.getByRole("button", { name: "Use the sample visit" }).click();
  await page.getByRole("radio", { name: /Voice A/ }).click();
  await page.getByRole("button", { name: "This voice is me" }).click();

  const retry = main(page).getByRole("button", { name: "Try again" });
  await expect(main(page).getByText("I could not read the visit.")).toBeVisible();
  await expect(primaries(page)).toHaveCount(1);
  await retry.click();

  await expect(page.getByText("Saved example (live AI unavailable).")).toBeVisible();
  await expect(main(page).getByRole("link", { name: "Go to Share" })).toBeVisible();
  await expect(primaries(page)).toHaveCount(1);
});

test("the sample page makes no microphone request", async ({ page }) => {
  await setup(page);
  await page.goto("/remember");
  await page.getByRole("button", { name: "Use the sample visit" }).click();
  expect(await page.evaluate(() => (window as unknown as { __mic: number }).__mic)).toBe(0);
});
