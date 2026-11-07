import { expect, test, type Page } from "@playwright/test";
import { PAGES } from "../../src/lib/pages";
import { ROUTES, SITE } from "../../src/lib/site";
import { TEAM } from "../../src/lib/team";

/** The footer Look switcher exists only after hydration; wait for it before pressing keys. */
async function ready(page: Page) {
  await expect(page.locator("footer").getByRole("radio").first()).toBeVisible();
}

const mainPrimary = (page: Page) => page.locator('main [data-kind="primary"]');

test.describe("home", () => {
  test("has one h1, one Open Rumi primary and seven h2 in order", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("h1")).toHaveCount(1);
    await expect(page.locator("h1")).toHaveText(PAGES["/"].h1);
    await ready(page);
    const primaries = mainPrimary(page);
    await expect(primaries).toHaveCount(1);
    await expect(primaries.nth(0)).toHaveText("Open Rumi");
    expect(await page.locator("main h2").allTextContents()).toEqual([
      "A visit is short. The questions are fast.",
      "Made for neurodivergent people.",
      "Three steps.",
      "Four things Rumi does.",
      "You stay in control.",
      "Questions people ask.",
      "Ready to try it?",
    ]);
  });

  test("the honesty line is visible at 375 x 667 without scrolling", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/");
    const line = page.getByText("Rumi is an AI helper. It is not a doctor. This is a student project. All examples are made up.");
    await expect(line).toBeVisible();
    const box = await line.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.y + box!.height).toBeLessThanOrEqual(667);
  });

  test("the FAQ opens and closes with Enter and with Space", async ({ page }) => {
    await page.goto("/");
    await ready(page);
    const item = page.locator("main [data-faq-item]", { hasText: "Is Rumi a doctor?" });
    const trigger = item.locator("summary");
    await expect(item).not.toHaveAttribute("open", "");
    await trigger.focus();
    for (const key of ["Enter", "Space"]) {
      await page.keyboard.press(key);
      await expect(item).toHaveAttribute("open", "");
      await page.keyboard.press(key);
      await expect(item).not.toHaveAttribute("open", "");
    }
  });

  test("the device frame is a static, hidden example with a caption", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    const frame = page.locator("[data-device-frame]");
    await expect(frame).toHaveAttribute("aria-hidden", "true");
    await expect(frame).toHaveAttribute("inert", "");
    expect(await frame.locator("h1, h2, h3, button, a, input").count()).toBe(0);
    await expect(page.getByText("Example plan. Made up.")).toBeVisible();
    const cards = await page.locator("[data-example-card]").all();
    expect(cards.length).toBe(3);
    for (const card of cards) {
      await expect(card).toHaveAttribute("aria-hidden", "true");
      expect(await card.locator("h1, h2, h3, button, a, input").count()).toBe(0);
    }
    await expect(page.getByText("Made up", { exact: true }).first()).toBeVisible();
  });

  test("says where the plan is saved", async ({ page }) => {
    await page.goto("/");
    await expect(
      page.getByText("Your plan is saved on your device. It goes to the AI service only when you press a button."),
    ).toBeVisible();
  });
});

test.describe("how it works", () => {
  test("has the three-step list and one primary", async ({ page }) => {
    await page.goto("/how-it-works");
    const list = page.getByRole("list", { name: "The three steps" });
    await expect(list.getByRole("listitem")).toHaveCount(3);
    await expect(mainPrimary(page)).toHaveCount(1);
    await expect(mainPrimary(page)).toHaveText("Open Rumi");
    await expect(page.locator("[data-example-card]")).toHaveCount(3);
  });
});

test.describe("help", () => {
  test("has seven questions and the Contact us primary", async ({ page }) => {
    await page.goto("/help");
    await expect(page.locator('main [data-faq-item]')).toHaveCount(7);
    await expect(mainPrimary(page)).toHaveCount(1);
    await expect(mainPrimary(page)).toHaveText("Contact us");
    await expect(mainPrimary(page)).toHaveAttribute("href", "/contact");
  });
});

test.describe("safety", () => {
  test("has the three call links and Call 988 as the only primary", async ({ page }) => {
    await page.goto("/safety");
    for (const href of ["tel:988", "sms:988", "tel:911"]) await expect(page.locator(`main a[href="${href}"]`)).toHaveCount(1);
    await expect(mainPrimary(page)).toHaveCount(1);
    await expect(mainPrimary(page)).toHaveText("Call 988");
    await expect(mainPrimary(page)).toHaveAttribute("href", "tel:988");
  });
});

test.describe("privacy", () => {
  test("has a captioned table with four rows", async ({ page }) => {
    await page.goto("/privacy");
    const table = page.locator("main table");
    await expect(table.locator("caption")).toHaveText("What Rumi keeps and what it sends");
    await expect(table.locator("tr")).toHaveCount(4);
    await expect(mainPrimary(page)).toHaveText("Open Rumi");
  });
});

test.describe("accessibility", () => {
  test("the primary reports a problem on the contact page", async ({ page }) => {
    await page.goto("/accessibility");
    await expect(mainPrimary(page)).toHaveCount(1);
    await expect(mainPrimary(page)).toHaveText("Report a problem");
    await expect(mainPrimary(page)).toHaveAttribute("href", "/contact");
  });
});

test.describe("about", () => {
  test("leaves out Who we are while there are no real names, and has no credits", async ({ page }) => {
    await page.goto("/about");
    await expect(page.locator("main h2", { hasText: "Who we are" })).toHaveCount(TEAM.length === 0 ? 0 : 1);
    await expect(page.locator("main h2", { hasText: /credits/i })).toHaveCount(0);
    await expect(page.locator("main h2", { hasText: "How Rumi uses AI" })).toHaveCount(1);
    await expect(mainPrimary(page)).toHaveText("Open Rumi");
  });
});

test.describe("every public page", () => {
  for (const route of ROUTES.filter((r) => !["/welcome", "/home"].includes(r))) {
    test(`${route}: no pricing, social-proof or store wording`, async ({ page }) => {
      await page.goto(route);
      const text = await page.locator("main").innerText();
      expect(text).not.toMatch(/\b(pricing|free|paid)\b|testimonial|trusted by|download the app/i);
    });
  }

  for (const route of ROUTES) {
    test(`${route}: the title is "{title} | Rumi" (the home page is absolute)`, async ({ page }) => {
      await page.goto(route);
      const { title } = PAGES[route];
      await expect(page).toHaveTitle(route === "/" ? title : `${title} | Rumi`);
    });
  }

  test("the default title and Open Graph text are the new product text", async ({ page }) => {
    await page.goto("/");
    expect(await page.locator('meta[property="og:title"]').getAttribute("content")).toBe(PAGES["/"].title);
    const home = await page.locator('meta[property="og:description"]').getAttribute("content");
    expect(home).toBe(SITE.description);
    expect(home).not.toMatch(/find your people/i);
    // Every other page shares its own title and description.
    await page.goto("/help");
    const og = await page.locator('meta[property="og:title"]').getAttribute("content");
    expect(og).not.toMatch(/your world, your pace, your way/i);
    expect(og).toBe(PAGES["/help"].title);
    expect(await page.locator('meta[property="og:description"]').getAttribute("content")).toBe(PAGES["/help"].description);
  });
});
