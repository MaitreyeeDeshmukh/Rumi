import { expect, test } from "@playwright/test";

// The Menu button appears only after hydration. Its slot is reserved, so the header must not grow when it does.
for (const scale of [1, 1.5]) {
  test(`the header keeps its height when the page becomes interactive (320 px, text ${scale * 100}%)`, async ({
    browser,
    baseURL,
  }) => {
    const context = await browser.newContext({ baseURL, viewport: { width: 320, height: 640 } });
    await context.addInitScript(
      (s) => localStorage.setItem("rumi.v1", JSON.stringify({ version: 1, settings: { textScale: s } })),
      scale,
    );
    const height = (page: import("@playwright/test").Page) =>
      page.locator("header").evaluate((el) => el.getBoundingClientRect().height);

    // No script runs on this page, so the Menu button never mounts: this is the height before hydration.
    const before = await context.newPage();
    await before.route("**/*.js", (route) => route.abort());
    await before.goto("/");
    await expect(before.locator("[data-menu-slot]")).toBeAttached();
    const server = await height(before);

    const after = await context.newPage();
    await after.goto("/");
    await expect(after.getByRole("button", { name: "Menu" })).toBeVisible();
    const client = await height(after);

    expect(Math.abs(client - server), `server ${server}px, client ${client}px`).toBeLessThanOrEqual(1);
    await context.close();
  });
}
