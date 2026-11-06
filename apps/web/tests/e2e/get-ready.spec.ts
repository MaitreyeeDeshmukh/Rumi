import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Route } from "@playwright/test";
import { seed } from "./fixtures/rumiState";

const main = (page: Page) => page.locator("main");
const primary = (page: Page) => main(page).locator('[data-kind="primary"]');
const stored = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem("rumi.v1") ?? "{}"));

const item = (id: string, kind: string, text: string, source = "user", enabled = true) => ({ id, text, kind, source, enabled });
const REPLY = {
  plan: {
    id: "p-test",
    title: "Back pain",
    createdAt: "2026-11-05T10:00:00.000Z",
    mainConcern: "My back hurts when I sit.",
    symptomsInMyWords: [],
    items: [
      item("a", "concern", "My back hurts when I sit."),
      item("b", "question", "Why does it hurt?"),
      item("c", "question", "What should I do next?", "suggested", true), // the reply says on; the screen must show off
    ],
  },
};
const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

async function type(page: Page, text: string) {
  await main(page).getByLabel("Tell me what is going on. Speak or type.").fill(text);
}

test.describe("get ready (/get-ready)", () => {
  test("empty state: Back first, one primary, blank submit shows an error and sends nothing", async ({ page }) => {
    let calls = 0;
    await page.route("**/api/plan", (r) => (calls++, json(r, REPLY)));
    await seed(page, "empty");
    await page.goto("/get-ready");
    await expect(main(page).getByRole("link", { name: /^Back/ })).toBeVisible();
    await expect(primary(page)).toHaveCount(1);
    await expect(primary(page)).toHaveText("Make my plan");
    await primary(page).click();
    await expect(main(page).getByText("Write one sentence first.")).toBeVisible();
    await expect(main(page).getByLabel("Tell me what is going on. Speak or type.")).toBeFocused();
    expect(calls).toBe(0);
  });

  test("plan -> edit, remove, undo -> Looks right -> support card -> Go to Practice", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.route("**/api/plan", (r) => json(r, REPLY));
    await seed(page, "empty");
    await page.goto("/get-ready");
    await type(page, "My back hurts when I sit.");
    await primary(page).click();

    // Plan state: Looks right is the only primary; suggested starts off.
    await expect(primary(page)).toHaveText("Looks right");
    await expect(primary(page)).toHaveCount(1);
    await expect(main(page).getByText("You said this")).toHaveCount(2);
    await expect(main(page).getByText("Suggested. Off until you turn it on")).toBeVisible();
    await expect(main(page).getByRole("switch", { name: /What should I do next/ })).not.toBeChecked();

    // Edit
    await main(page).getByRole("button", { name: /^Edit: Why does it hurt/ }).click();
    await main(page).getByLabel("Change this line").fill("Why does my back hurt?");
    await main(page).getByRole("button", { name: "Save", exact: true }).click();
    await expect(main(page).getByText("Why does my back hurt?")).toBeVisible();

    // Remove -> Removed. Undo stays until the next action
    await main(page).getByRole("button", { name: /^Remove: Why does my back hurt/ }).click();
    await expect(main(page).getByRole("status").filter({ hasText: "Removed." })).toContainText("Removed. Undo");
    await expect(main(page).getByText("Why does my back hurt?")).toHaveCount(0);
    await page.waitForTimeout(1200);
    await expect(main(page).getByRole("button", { name: "Undo" })).toBeVisible();
    await main(page).getByRole("button", { name: "Undo" }).click();
    await expect(main(page).getByText("Why does my back hurt?")).toBeVisible();
    await expect(main(page).getByRole("button", { name: "Undo" })).toHaveCount(0);

    // Add my own
    await main(page).getByLabel("Add my own").fill("I want it in writing.");
    await main(page).getByRole("button", { name: "Add line" }).click();
    await expect(main(page).getByText("I want it in writing.")).toBeVisible();

    // Looks right saves the plan and shows the card
    await primary(page).click();
    await expect(main(page).getByText("Your plan is saved.")).toBeVisible();
    await expect(primary(page)).toHaveCount(1);
    await expect(primary(page)).toHaveText("Go to Practice");
    await expect(primary(page)).toHaveAttribute("href", "/practice");
    const s = await stored(page);
    expect(s.plan.mainConcern).toBe("My back hurts when I sit.");
    expect(s.supportCard.items).toHaveLength(6);

    // Support card: toggles, own sentence, questions, preview, copy
    const preview = main(page).locator("pre.printable");
    await expect(preview).toContainText("My main concern");
    await expect(preview).toContainText("1. Why does my back hurt?");
    await expect(preview).not.toContainText("How I like to be supported");
    await main(page).getByRole("switch", { name: "Please speak slowly." }).click();
    await expect(preview).toContainText("How I like to be supported");
    await expect(preview).toContainText("- Please speak slowly.");
    await main(page).getByLabel("Add your own").fill("Please use short words.");
    await main(page).getByRole("button", { name: "Add sentence" }).click();
    await expect(preview).toContainText("- Please use short words.");
    await main(page).getByLabel("Add your own").fill("one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen");
    await main(page).getByRole("button", { name: "Add sentence" }).click();
    await expect(main(page).getByText(/Make it shorter and clearer/)).toBeVisible();
    await main(page).getByRole("button", { name: "Copy card" }).click();
    await expect(main(page).getByText("Copied.")).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("- Please speak slowly.");
    await expect(main(page).getByRole("button", { name: "Print card" })).toBeEnabled();
  });

  test("error: warning notice keeps the text; Try again recovers", async ({ page }) => {
    let n = 0;
    await page.route("**/api/plan", (r) => (n++ === 0 ? json(r, { error: { code: "ai_unavailable", message: "Please try again." } }, 502) : json(r, REPLY)));
    await seed(page, "empty");
    await page.goto("/get-ready");
    await type(page, "My back hurts when I sit.");
    await primary(page).click();
    const notice = main(page).locator('[data-tone="warn"]');
    await expect(notice).toContainText("Please try again.");
    await expect(main(page).getByLabel("Tell me what is going on. Speak or type.")).toHaveValue("My back hurts when I sit.");
    await expect(primary(page)).toHaveCount(1);
    await notice.getByRole("button", { name: "Try again" }).click();
    await expect(primary(page)).toHaveText("Looks right");
  });

  test("crisis from the server opens the crisis dialog and keeps the text", async ({ page }) => {
    await page.route("**/api/plan", (r) => json(r, { crisis: true }));
    await seed(page, "empty");
    await page.goto("/get-ready");
    await type(page, "I am having a bad day.");
    await primary(page).click();
    await expect(page.locator("dialog[open]")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator("dialog[open]")).toBeVisible();
    await expect(main(page).getByLabel("Tell me what is going on. Speak or type.")).toHaveValue("I am having a bad day.");
  });

  test("crisis typed in the box opens the dialog and sends no request", async ({ page }) => {
    let calls = 0;
    await page.route("**/api/plan", (r) => (calls++, json(r, REPLY)));
    await seed(page, "empty");
    await page.goto("/get-ready");
    await type(page, "I want to end my life.");
    await primary(page).click();
    await expect(page.locator("dialog[open]")).toBeVisible();
    expect(calls).toBe(0);
  });

  test("degraded reply shows the built-in help notice; loading shows status and aria-busy", async ({ page }) => {
    await page.route("**/api/plan", async (r) => {
      await new Promise((res) => setTimeout(res, 700));
      await json(r, { ...REPLY, degraded: true });
    });
    await seed(page, "empty");
    await page.goto("/get-ready");
    await type(page, "My back hurts when I sit.");
    await primary(page).click();
    await expect(primary(page)).toHaveAttribute("aria-busy", "true");
    await expect(main(page).getByRole("status").filter({ hasText: "Making your plan…" })).toBeVisible();
    await expect(main(page).getByText("The AI is not available. Rumi is using simple built-in help.")).toBeVisible();
    await expect(primary(page)).toHaveText("Looks right");
  });

  test("a saved plan and card open straight on Go to Practice", async ({ page }) => {
    await seed(page, "planCard");
    await page.goto("/get-ready");
    await expect(primary(page)).toHaveText("Go to Practice");
    await expect(main(page).getByRole("heading", { name: "How I like to be supported" })).toBeVisible();
    await expect(main(page).locator('[data-needs-js]')).toBeVisible();
  });

  for (const kind of ["plan", "planCard"] as const) {
    test(`no accessibility violations (${kind})`, async ({ page }) => {
      await seed(page, kind);
      await page.goto("/get-ready");
      await expect(main(page).getByRole("heading", { name: "Your plan" })).toBeVisible();
      const results = await new AxeBuilder({ page }).analyze();
      expect(results.violations.map((v) => `${v.id}: ${v.nodes[0]?.html}`)).toEqual([]);
    });
  }

  for (const theme of ["soft", "contrast", "low"]) {
    test(`print (${theme}): only the card is visible`, async ({ page }) => {
      await seed(page, "planCard", { theme });
      await page.goto("/get-ready");
      await expect(main(page).locator("pre.printable")).toContainText("Please speak slowly.");
      await page.emulateMedia({ media: "print" });
      await expect(main(page).locator("pre.printable")).toBeVisible();
      await expect(main(page).getByRole("heading", { level: 1 })).toBeHidden();
      await expect(main(page).getByRole("button", { name: "Copy card" })).toBeHidden();
    });
  }
});
