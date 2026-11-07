import { expect, test, type Page } from "@playwright/test";
import { seed } from "./fixtures/rumiState";

// The seeded plan has four lines on: c1 (concern), q1, q2 (questions), a1 (accommodation). The AI is the shim fixture,
// so the clinician's replies are scripted from the plan: each answer covers the next line, the fourth ends the call.
const call = (page: Page) => page.locator("[data-call-screen]");
const main = (page: Page) => page.locator("main");
const leaveSheet = (page: Page) => page.getByRole("dialog", { name: "Leave practice?" });

/** The Practice start: pick "My plan" and start. The chat opens with the clinician's hello and first question. */
async function choosePlan(page: Page) {
  await page.getByRole("radio", { name: "My plan" }).click();
  await page.getByRole("button", { name: "Start practice" }).click();
}

/** Pause, Slow down, Show my plan and Try that again sit under "More". Opens it once. */
async function openMore(layer: ReturnType<typeof call>) {
  const more = layer.locator("details");
  if (!(await more.evaluate((el) => (el as HTMLDetailsElement).open))) await more.locator("summary").click();
}

async function start(page: Page) {
  await seed(page, "planCard");
  await page.goto("/practice");
  await choosePlan(page);
  await expect(call(page)).toBeVisible();
}

async function answer(page: Page, text: string) {
  await call(page).getByLabel("Your answer").fill(text);
  await call(page).getByRole("button", { name: /^(Send|See my summary)$/ }).click();
}

test.describe("practice: before the call", () => {
  test("no plan: General practice is chosen, with My plan, a booked visit and a recording as the other choices", async ({ page }) => {
    await seed(page, "empty");
    await page.goto("/practice");
    await expect(main(page).getByRole("link", { name: /^Back/ })).toBeVisible();
    await expect(main(page).getByText("You need a plan first.")).toHaveCount(0);
    await expect(main(page).getByRole("radio", { name: "General practice" })).toBeChecked();
    await expect(main(page).getByRole("button", { name: "Start practice" })).toBeEnabled();
    await main(page).getByRole("radio", { name: "My plan" }).click();
    await expect(main(page).getByRole("link", { name: "Go to Get ready" })).toHaveAttribute("href", "/get-ready");
    await expect(main(page).getByRole("button", { name: "Start practice" })).toBeDisabled();
    await main(page).getByRole("radio", { name: "A visit I booked" }).click();
    await expect(main(page).getByRole("link", { name: "Book an appointment" })).toHaveAttribute("href", "/appointments/new");
  });

  test("no plan: general practice opens the chat with a hello, the first question and ready-made answers", async ({ page }) => {
    await seed(page, "empty");
    await page.goto("/practice");
    await main(page).getByRole("button", { name: "Start practice" }).click();
    const layer = call(page);
    await expect(layer.getByText("Welcome. I am Dr. Lee. We will practice your visit together.")).toBeVisible();
    await expect(layer.getByText("Hi. What brings you in today?")).toBeVisible();
    // Tapping a ready-made answer fills the box, so nobody has to start from a blank box.
    await layer.getByRole("group", { name: "Tap one to start your answer" }).getByRole("button").first().click();
    await expect(layer.getByLabel("Your answer")).not.toHaveValue("");
  });

  test("a recording or file shows a file button and a link to record a visit", async ({ page }) => {
    await seed(page, "empty");
    await page.goto("/practice");
    await main(page).getByRole("radio", { name: "A recording or file" }).click();
    await expect(main(page).getByRole("button", { name: "Choose a file" })).toBeVisible();
    await expect(main(page).getByRole("link", { name: "Record a visit" })).toHaveAttribute("href", "/record");
  });
});

test.describe("practice: the call screen", () => {
  test("top bar, inert shell, a full turn with every toolbar control", async ({ page }) => {
    await start(page);
    const layer = call(page);
    expect(await layer.evaluate((el) => getComputedStyle(el).zIndex)).toBe("40");

    // Own top bar: Back (visible text Back); the shell behind is not reachable.
    const back = layer.getByRole("button", { name: "Back to Practice" });
    await expect(back).toHaveText("Back");
    expect(await page.locator("main").evaluate((el) => el.closest("[inert]") !== null)).toBe(true);
    for (let i = 0; i < 25; i++) {
      await page.keyboard.press("Tab");
      const inside = await page.evaluate(
        () => document.activeElement === document.body || !!document.activeElement?.closest("[data-call-screen], dialog"),
      );
      expect(inside).toBe(true);
    }

    await expect(layer.getByText("This is practice. Not a real doctor.")).toBeVisible();
    await expect(layer.getByText("Hi. What brings you in today?")).toBeVisible();
    await expect(layer.locator('[data-kind="primary"]')).toHaveText("Send");

    // Blank Send says what to do.
    await layer.getByRole("button", { name: "Send" }).click();
    await expect(layer.getByText("Type an answer first, or tap Help me say it.")).toBeVisible();

    // Repeat shows the line again, marked.
    await layer.getByRole("button", { name: "Repeat" }).click();
    await expect(layer.getByText("Clinician (repeated)")).toBeVisible();

    // The less used controls are under More.
    await openMore(layer);

    // Slow down (when speech is on) says so.
    const slow = layer.getByRole("button", { name: "Slow down" });
    if (await slow.count()) {
      await slow.click();
      await expect(layer.getByText("I will speak more slowly.")).toBeVisible();
    }

    // Show my plan: the lines that are on, and a Close.
    await layer.getByRole("button", { name: "Show my plan" }).click();
    const plan = page.getByRole("dialog", { name: "Your plan" });
    await expect(plan.getByText("Please speak slowly.")).toBeVisible();
    await expect(plan.getByText("Please write the steps down.")).toHaveCount(0);
    await plan.getByRole("button", { name: "Close", exact: true }).click();
    await expect(plan).toHaveCount(0);

    // First answer, then Try that again puts it back in the box.
    await answer(page, "I have had headaches for two weeks.");
    await expect(layer.getByText("What would you like to ask me?")).toBeVisible();
    await layer.getByRole("button", { name: "Try that again" }).click();
    await expect(layer.getByLabel("Your answer")).toHaveValue("I have had headaches for two weeks.");
    await expect(layer.getByText("What would you like to ask me?")).toHaveCount(0);
    await layer.getByRole("button", { name: "Send" }).click();
    await expect(layer.getByText("What would you like to ask me?")).toBeVisible();

    // Pause: Resume is the only primary, Send cannot be used.
    await layer.getByRole("button", { name: "Pause" }).click();
    const paused = page.getByRole("dialog", { name: "Paused" });
    await expect(paused.getByText("Nothing moves on until you are ready.", { exact: false })).toBeVisible();
    await expect(paused.getByRole("button", { name: "Resume" })).toHaveAttribute("data-kind", "primary");
    await expect(layer.locator('[data-kind="primary"]')).toHaveCount(0);
    await expect(layer.locator("button[type=submit]")).toBeDisabled();
    await paused.getByRole("button", { name: "Resume" }).click();
    await expect(paused).toHaveCount(0);
    await expect(layer.getByRole("button", { name: "Send" })).toBeEnabled();
  });

  test("Help me say it: hint, then a sentence with a blank, then the whole sentence", async ({ page }) => {
    await start(page);
    const layer = call(page);
    await layer.getByRole("button", { name: "Help me say it" }).click();
    const sheet = page.getByRole("dialog", { name: "Help me say it" });
    await expect(sheet.getByTestId("help-text")).toContainText("Say what is wrong");
    await expect(sheet.getByRole("button", { name: "Use this" })).toHaveCount(0);

    await sheet.getByRole("button", { name: "Show more help" }).click();
    await expect(sheet.getByTestId("help-prefix")).toHaveText("I have had headaches for two");
    await expect(sheet.getByRole("button", { name: "Use this" })).toBeDisabled();
    await expect(sheet.getByText("Fill in the blank first.")).toBeVisible();
    await sheet.getByLabel("Fill in the blank").fill("ok");
    await expect(sheet.getByRole("button", { name: "Use this" })).toBeEnabled();

    await sheet.getByRole("button", { name: "Show more help" }).click();
    await expect(sheet.getByTestId("help-text")).toHaveText("I have had headaches for two weeks.");
    await expect(sheet.getByRole("button", { name: "Show more help" })).toHaveCount(0);
    await sheet.getByRole("button", { name: "Use this" }).click();
    await expect(sheet).toHaveCount(0);
    await expect(layer.getByLabel("Your answer")).toHaveValue("I have had headaches for two weeks.");
  });

  test("finishing: See my summary, wording, ticks, Practice again, Go to Home", async ({ page }) => {
    await start(page);
    const layer = call(page);
    // Use help for the first line only; say the other three alone.
    await layer.getByRole("button", { name: "Help me say it" }).click();
    const sheet = page.getByRole("dialog", { name: "Help me say it" });
    await sheet.getByRole("button", { name: "Show more help" }).click();
    await sheet.getByRole("button", { name: "Show more help" }).click();
    await sheet.getByRole("button", { name: "Use this" }).click();
    await layer.getByRole("button", { name: "Send" }).click();
    await answer(page, "What could cause this?");
    await answer(page, "Do I need a test?");
    await expect(layer.getByRole("button", { name: "Send" })).toHaveCount(1);
    await answer(page, "Please speak slowly.");
    await expect(layer.getByText("Thank you. That is everything I wanted to ask.")).toBeVisible();
    await expect(layer.locator('[data-kind="primary"]')).toHaveText("See my summary");
    await expect(layer.getByLabel("Your answer")).toHaveCount(0);
    await layer.getByRole("button", { name: "See my summary" }).click();

    await expect(call(page)).toHaveCount(0);
    await expect(main(page).getByText("You practiced: The whole visit.")).toBeVisible();
    await expect(main(page).getByText("You said 3 of 4 things yourself.")).toBeVisible();
    await expect(main(page).getByText("You said 1 with help.")).toBeVisible();
    await expect(main(page).getByText("You used Help me say it 1 time.")).toBeVisible();
    await expect(main(page).getByRole("button", { name: "Save plan" })).toHaveCount(0);
    const primary = main(page).locator('[data-kind="primary"]');
    await expect(primary).toHaveCount(1);
    await expect(primary).toHaveText("Practice again");
    await expect(main(page).getByRole("link", { name: "Go to Home" })).toHaveAttribute("data-kind", "secondary");

    // Untick one line: the count follows. The session is stored.
    await main(page).getByRole("switch", { name: "What could cause this?" }).click();
    await expect(main(page).getByText("You said 2 of 4 things yourself.")).toBeVisible();
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("rumi.v1") ?? "{}").sessions.length);
    expect(stored).toBe(1);

    await primary.click();
    await expect(call(page)).toBeVisible(); // Practice again goes straight back into the chat
  });

  test("End practice asks first, then shows the summary", async ({ page }) => {
    await start(page);
    await call(page).getByRole("button", { name: "End practice" }).click();
    const sheet = page.getByRole("dialog", { name: "End practice?" });
    await sheet.getByRole("button", { name: "Keep practicing" }).click();
    await expect(sheet).toHaveCount(0);
    await call(page).getByRole("button", { name: "End practice" }).click();
    await page.getByRole("dialog", { name: "End practice?" }).getByRole("button", { name: "End now" }).click();
    await expect(main(page).getByText("You said 0 of 4 things yourself.")).toBeVisible();
  });
});

test.describe("practice: leaving and history", () => {
  test("Back opens Leave practice?; Keep practicing stays; Leave goes to Home with no stray entry", async ({ page }) => {
    await seed(page, "planCard");
    await page.goto("/home");
    await main(page).getByRole("link", { name: "Start practice" }).first().click();
    await expect(page).toHaveURL(/\/practice$/);
    await choosePlan(page);
    await expect(call(page)).toBeVisible();
    expect(await page.evaluate(() => history.state?.rumiCall)).toBe(true);

    await call(page).getByRole("button", { name: "Back to Practice" }).click();
    const sheet = leaveSheet(page);
    await expect(sheet.getByText("This practice will not be saved. You can start again any time.")).toBeVisible();
    await expect(sheet.getByRole("button", { name: "Keep practicing" })).toHaveAttribute("data-kind", "primary");
    await expect(sheet.getByRole("button", { name: "Leave" })).toHaveAttribute("data-kind", "secondary");
    await sheet.getByRole("button", { name: "Keep practicing" }).click();
    await expect(sheet).toHaveCount(0);

    await call(page).getByRole("button", { name: "Back to Practice" }).click();
    await leaveSheet(page).getByRole("button", { name: "Leave" }).click();
    await expect(page).toHaveURL(/\/home$/);
    // Back from Home lands on the practice page itself, not on a hidden call entry.
    await page.goBack();
    await expect(page).toHaveURL(/\/practice$/);
    await expect(call(page)).toHaveCount(0);
    expect(await page.evaluate(() => history.state?.rumiCall ?? false)).toBe(false);
    await expect(main(page).getByRole("button", { name: "Start practice" })).toBeVisible();
  });

  test("the browser Back button opens the leave sheet and the URL still shows the call", async ({ page }) => {
    await start(page);
    await page.goBack();
    await expect(leaveSheet(page)).toBeVisible();
    await expect(page).toHaveURL(/\/practice$/);
    await expect(call(page)).toBeVisible();
    // Keep practicing puts the entry back, so Back works again.
    await leaveSheet(page).getByRole("button", { name: "Keep practicing" }).click();
    await expect(leaveSheet(page)).toHaveCount(0);
    expect(await page.evaluate(() => history.state?.rumiCall)).toBe(true);
    await page.goBack();
    await expect(leaveSheet(page)).toBeVisible();
  });

  test("after End practice the browser Back goes to the page before practice", async ({ page }) => {
    await seed(page, "planCard");
    await page.goto("/home");
    await page.goto("/practice");
    await choosePlan(page);
    await expect(call(page)).toBeVisible();
    await call(page).getByRole("button", { name: "End practice" }).click();
    await page.getByRole("dialog", { name: "End practice?" }).getByRole("button", { name: "End now" }).click();
    await expect(main(page).getByText("You said 0 of 4 things yourself.")).toBeVisible();
    expect(await page.evaluate(() => history.state?.rumiCall ?? false)).toBe(false);
    await page.goBack();
    await expect(page).toHaveURL(/\/home$/);
  });

  test("Esc closes only the top layer; with none open it opens the leave sheet", async ({ page }) => {
    await start(page);
    const layer = call(page);
    await layer.getByRole("button", { name: "Help me say it" }).click();
    const help = page.getByRole("dialog", { name: "Help me say it" });
    await expect(help).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(help).toHaveCount(0);
    await expect(leaveSheet(page)).toHaveCount(0);

    await openMore(layer);
    await layer.getByRole("button", { name: "Show my plan" }).click();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Your plan" })).toHaveCount(0);
    await expect(leaveSheet(page)).toHaveCount(0);

    // From the text box, with nothing open, Esc opens the leave sheet; a second Esc closes it.
    await layer.getByLabel("Your answer").focus();
    await page.keyboard.press("Escape");
    await expect(leaveSheet(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(leaveSheet(page)).toHaveCount(0);
    await expect(call(page)).toBeVisible();
  });
});

test.describe("practice: crisis help", () => {

  test("crisis words in an answer show help and are not sent", async ({ page }) => {
    await start(page);
    await call(page).getByLabel("Your answer").fill("I want to end my life");
    await call(page).getByRole("button", { name: "Send" }).click();
    await expect(page.getByRole("dialog", { name: "You may need help right now" })).toBeVisible();
    await page.getByRole("button", { name: "I understand" }).click();
    await expect(call(page).getByText("What would you like to ask me?")).toHaveCount(0);
    await expect(call(page).getByLabel("Your answer")).toHaveValue("I want to end my life");
  });
});

test("phone: the sticky Send stays inside the screen", async ({ page, isMobile }) => {
  test.skip(!isMobile, "phone only");
  await start(page);
  const bar = call(page).locator(".sticky-actions");
  await expect(bar).toHaveAttribute("data-sticky", "true");
  const send = call(page).getByRole("button", { name: "Send" });
  const box = await send.boundingBox();
  const viewport = page.viewportSize();
  expect(box && viewport && box.y + box.height <= viewport.height).toBe(true);
});
