import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { buildState, seed, type StateKind } from "./fixtures/rumiState";

const main = (page: Page) => page.locator("main");
const primary = (page: Page) => main(page).locator('[data-kind="primary"]');
const KINDS: StateKind[] = ["empty", "plan", "planCard", "practiced", "recap"];

test.describe("dashboard (/home)", () => {
  test("a new user: Hi., one primary, three steps not started, no help block", async ({ page }) => {
    await seed(page, "empty");
    await page.goto("/home");
    await expect(main(page).getByRole("heading", { level: 1 })).toHaveText("Hi.");
    await expect(main(page).getByRole("link", { name: /^Back/ })).toHaveAttribute("href", "/");
    await expect(primary(page)).toHaveCount(1);
    await expect(primary(page)).toHaveText("Make your plan");
    await expect(primary(page)).toHaveAttribute("href", "/get-ready");
    await expect(main(page).getByText("Not started", { exact: true })).toHaveCount(3);
    await expect(main(page).getByText("No plan yet.")).toBeVisible();
    await expect(main(page).getByText("No practice yet.")).toBeVisible();
    await expect(main(page).getByText("Help you usually need")).toHaveCount(0);
  });

  test("a plan only: finish the card; step 1 is in progress", async ({ page }) => {
    await seed(page, "plan");
    await page.goto("/home");
    await expect(primary(page)).toHaveText("Finish your support card");
    const steps = main(page).getByRole("list", { name: "The three steps" });
    await expect(steps.getByRole("listitem").first()).toContainText("In progress");
    await expect(main(page).getByText("Headaches for two weeks", { exact: true })).toBeVisible();
    await expect(main(page).getByText("4 lines on, 1 line off")).toBeVisible();
    await expect(main(page).getByRole("link", { name: "Edit plan" })).toHaveAttribute("data-kind", "secondary");
  });

  test("after one practice: sample visit next, last practice and the help words", async ({ page }) => {
    await seed(page, "practiced");
    await page.goto("/home");
    await expect(primary(page)).toHaveText("Try the sample visit");
    const last = main(page).locator("section", { has: page.getByRole("heading", { name: "Last practice" }) });
    await expect(last).toContainText("You practiced: The whole visit.");
    await expect(last).toContainText("You said 2 of 4 things yourself.");
    await expect(last).toContainText("You said 1 with help.");
    await expect(last).not.toContainText("Last time you needed"); // one practice: no trend
    const again = last.getByRole("link", { name: "Practice again" });
    await expect(again).toHaveAttribute("href", "/practice");
    await expect(again).toHaveAttribute("data-kind", "secondary");
    const help = main(page).locator("section", { has: page.getByRole("heading", { name: "Help you usually need" }) });
    await expect(help).toContainText("Describing what is wrong");
    await expect(help.locator("li", { hasText: "Describing what is wrong" })).toContainText("No help");
    await expect(help.locator("li", { hasText: "Asking your questions" })).toContainText("No help");
    await expect(help.locator("li", { hasText: "Asking for what you need" })).toContainText("A hint");
    await expect(help).toContainText("Where your next practice starts.");
  });

  test("two practices: the trend sentence appears only when the help changed", async ({ page }) => {
    const state = JSON.parse(buildState("practiced"));
    state.sessions.push({ ...state.sessions[0], id: "s2", helpLevelUsed: { c1: 0, q1: 0, a1: 1 } });
    await page.addInitScript((json) => localStorage.setItem("rumi.v1", json), JSON.stringify(state));
    await page.goto("/home");
    await expect(main(page)).toContainText("Last time you needed a sentence with blanks. This time you needed a hint.");
  });

  test("everything done: the kit is next", async ({ page }) => {
    await seed(page, "recap");
    await page.goto("/home");
    await expect(primary(page)).toHaveText("See your kit");
    await expect(primary(page)).toHaveAttribute("href", "/kit");
    const kit = main(page).locator("section", { has: page.getByRole("heading", { name: "Your kit" }) });
    await expect(kit).toContainText("Your kit is ready.");
    await expect(kit.getByRole("link", { name: "Open kit" })).toHaveAttribute("href", "/kit");
    await expect(main(page).locator("li[aria-current='step']")).toHaveCount(0);
  });

  for (const kind of KINDS) {
    test(`${kind}: exactly one primary and no score words`, async ({ page }) => {
      await seed(page, kind);
      await page.goto("/home");
      await expect(primary(page)).toHaveCount(1);
      const text = (await main(page).innerText()).toLowerCase();
      for (const word of ["%", "streak", "score", "points", "level up"]) expect(text, word).not.toContain(word);
    });
  }

  test("the step links go to the three steps", async ({ page }) => {
    await seed(page, "empty");
    await page.goto("/home");
    for (const [name, href] of [
      ["Open Get ready", "/get-ready"],
      ["Open Practice", "/practice"],
      ["Open Remember", "/remember"],
    ]) {
      await expect(main(page).getByRole("link", { name })).toHaveAttribute("href", href);
    }
  });

  for (const [kind, current] of [
    ["empty", "Get ready"],
    ["plan", "Get ready"],
    ["planCard", "Practice"],
    ["practiced", "Remember"],
  ] as const) {
    test(`${kind}: the current step is ${current}`, async ({ page }) => {
      await seed(page, kind);
      await page.goto("/home");
      const now = main(page).locator("li[aria-current='step']");
      await expect(now).toHaveCount(1);
      await expect(now).toContainText(current);
    });
  }

  test("with storage blocked the page renders and warns", async ({ page }) => {
    await page.addInitScript(() => {
      Storage.prototype.getItem = () => {
        throw new Error("blocked");
      };
      Storage.prototype.setItem = () => {
        throw new Error("blocked");
      };
    });
    await page.goto("/home");
    await expect(main(page).getByRole("heading", { level: 1 })).toHaveText("Hi.");
    await expect(
      main(page).getByText("Your browser is not saving data. Your work will be lost when you close this page."),
    ).toBeVisible();
    await expect(primary(page)).toHaveText("Make your plan");
  });

  // The saved state loads after the scripts. Delaying the scripts and slowing the CPU makes the skeleton paint,
  // so this catches a skeleton whose blocks are taller or shorter than the real ones.
  for (const [width, height] of [
    [375, 812],
    [768, 1024],
    [1280, 800],
  ]) {
    for (const kind of ["empty", "practiced"] as const) {
      test(`${kind}: no jump when a slow phone swaps the skeleton at ${width} x ${height}`, async ({ page }) => {
        await page.setViewportSize({ width, height });
        await page.route("**/_next/static/**/*.js", async (route) => {
          await new Promise((r) => setTimeout(r, 700));
          await route.continue();
        });
        await page.addInitScript(() => {
          const w = window as unknown as { __cls: number };
          w.__cls = 0;
          new PerformanceObserver((list) => {
            for (const e of list.getEntries() as unknown as { value: number; hadRecentInput: boolean }[]) {
              if (!e.hadRecentInput) w.__cls += e.value;
            }
          }).observe({ type: "layout-shift", buffered: true });
        });
        await seed(page, kind);
        const client = await page.context().newCDPSession(page);
        await client.send("Emulation.setCPUThrottlingRate", { rate: 4 });
        await page.goto("/home", { waitUntil: "commit" });
        await expect(page.getByText("Loading.")).toBeAttached();
        await expect(primary(page)).toBeVisible({ timeout: 20_000 });
        await page.waitForTimeout(600);
        const cls = await page.evaluate(() => (window as unknown as { __cls: number }).__cls);
        expect(cls).toBeLessThan(0.02);
      });
    }
  }

  for (const kind of ["empty", "practiced"] as const) {
    test(`${kind}: the layout does not jump after load`, async ({ page }) => {
      await page.addInitScript(() => {
        const w = window as unknown as { __cls: number };
        w.__cls = 0;
        new PerformanceObserver((list) => {
          for (const e of list.getEntries() as unknown as { value: number; hadRecentInput: boolean }[]) {
            if (!e.hadRecentInput) w.__cls += e.value;
          }
        }).observe({ type: "layout-shift", buffered: true });
      });
      await seed(page, kind);
      await page.goto("/home");
      await expect(primary(page)).toBeVisible();
      await page.waitForTimeout(600);
      const cls = await page.evaluate(() => (window as unknown as { __cls: number }).__cls);
      expect(cls).toBeLessThan(0.02);
    });
  }

  test("junk in storage does not break the page", async ({ page }) => {
    const junk = '{"version":1,"settings":{"theme":"purple","name":5},"plan":{"items":"x"},"sessions":[{"coveredItemIds":3}]}';
    await page.addInitScript((j) => localStorage.setItem("rumi.v1", j), junk);
    await page.goto("/home");
    await expect(main(page).getByRole("heading", { level: 1 })).toHaveText("Hi.");
    await expect(primary(page)).toHaveText("Make your plan");
  });

  test("a failed write shows the not-saving notice", async ({ page }) => {
    await page.addInitScript(() => {
      Storage.prototype.setItem = () => {
        throw new Error("full");
      };
    });
    await page.goto("/welcome");
    await expect(page.getByLabel("Name your helper")).toBeEnabled();
    await primary(page).click();
    await expect(page).toHaveURL(/\/home$/);
    await expect(main(page).getByText("Your browser is not saving data.", { exact: false })).toBeVisible();
  });

  test("data of another version shows the notice and is never overwritten", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("rumi.v1", '{"version":2,"keep":"me"}'));
    await page.goto("/home");
    await expect(main(page).getByText("Your browser is not saving data.", { exact: false })).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem("rumi.v1"))).toBe('{"version":2,"keep":"me"}');
  });

  test("sessions with missing parts are repaired, not dropped; no NaN", async ({ page }) => {
    const state = JSON.parse(buildState("practiced"));
    state.sessions = [{ id: "s9", planId: "plan-1", startedAt: "x", coveredItemIds: ["c1"], helpLevelUsed: { c1: "x" } }];
    await page.addInitScript((j) => localStorage.setItem("rumi.v1", j), JSON.stringify(state));
    await page.goto("/home");
    await expect(main(page)).toContainText("You practiced: The whole visit.");
    await expect(main(page)).toContainText("You said 1 of 4 things yourself.");
    expect(await main(page).innerText()).not.toContain("NaN");
  });

  test("a support card with no lines is not a card", async ({ page }) => {
    const state = JSON.parse(buildState("practiced"));
    state.supportCard.items = [];
    await page.addInitScript((j) => localStorage.setItem("rumi.v1", j), JSON.stringify(state));
    await page.goto("/home");
    await expect(primary(page)).toHaveText("Finish your support card");
    await expect(main(page).getByText("Your kit needs a plan and a support card.")).toBeVisible();
  });

  test("a practice still shows when the plan was removed", async ({ page }) => {
    const state = JSON.parse(buildState("practiced"));
    delete state.plan;
    await page.addInitScript((j) => localStorage.setItem("rumi.v1", j), JSON.stringify(state));
    await page.goto("/home");
    await expect(main(page)).toContainText("You said 2 of 3 things yourself.");
  });

  test("junk setting values fall back to the defaults", async ({ page }) => {
    const state = JSON.parse(buildState("plan"));
    state.settings = { ...state.settings, outputMode: 7, detail: "x", memoryOptIn: "yes", speechRate: "fast" };
    await page.addInitScript((j) => localStorage.setItem("rumi.v1", j), JSON.stringify(state));
    await page.goto("/home");
    await expect(main(page).getByText("Memory: Off")).toBeVisible();
  });

  test("ends with the info links and has Urgent help", async ({ page }) => {
    await seed(page, "plan");
    await page.goto("/home");
    await expect(primary(page)).toBeVisible();
    await expect(page.locator("main footer").getByRole("link")).toHaveCount(5);
    await expect(page.getByRole("link", { name: "Urgent help" }).first()).toBeVisible();
  });

  test("greets the person by name", async ({ page }) => {
    await seed(page, "plan", { name: "Sam" });
    await page.goto("/home");
    await expect(main(page).getByRole("heading", { level: 1 })).toHaveText("Hi, Sam.");
  });

  test("the privacy block shows memory and links to Settings", async ({ page }) => {
    await seed(page, "plan");
    await page.goto("/home");
    await expect(main(page).getByText("Memory: Off")).toBeVisible();
    await expect(main(page).getByRole("link", { name: "Manage in Settings" })).toHaveAttribute("href", "/settings");
    await expect(main(page).getByText("Your plan is saved on this device.")).toBeVisible();
  });
});

test.describe("theme sync", () => {
  test("a Look choice survives opening /home and a reload; the saved plan stays", async ({ page }) => {
    await seed(page, "practiced");
    await page.goto("/help");
    const group = page.locator("footer").getByRole("radiogroup", { name: "Look" });
    await group.getByRole("radio", { name: "High Contrast" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-app-theme", "contrast");
    await page.goto("/home");
    await expect(primary(page)).toHaveText("Try the sample visit"); // the Look change did not erase the state
    await expect(page.locator("html")).toHaveAttribute("data-app-theme", "contrast");
    await page.reload();
    await expect(primary(page)).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-app-theme", "contrast");
  });

  test("a new person on a dark system keeps Low Light after the app loads", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/home");
    await expect(primary(page)).toBeVisible();
    await page.waitForTimeout(300);
    await expect(page.locator("html")).toHaveAttribute("data-app-theme", "low");
  });

  test("a stored text size and theme are applied", async ({ page }) => {
    await seed(page, "plan", { theme: "low", textScale: 1.3 });
    await page.goto("/home");
    await expect(primary(page)).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-app-theme", "low");
    expect(await page.evaluate(() => document.documentElement.style.getPropertyValue("--scale"))).toBe("1.3");
  });
});

// ---- Welcome (Task 13) ----
const TABBABLE = `a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])`;
const stored = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem("rumi.v1") ?? "null"));

test.describe("welcome (/welcome)", () => {
  test("Back first, then Skip for now, then the form; one primary: Start", async ({ page }) => {
    await page.goto("/welcome");
    const stops = main(page).locator(TABBABLE);
    await expect(stops.nth(0)).toHaveText("Back");
    await expect(stops.nth(1)).toHaveText("Skip for now");
    await expect(stops.nth(2)).toHaveAttribute("name", /.*/);
    await expect(main(page).getByRole("heading", { level: 1 })).toHaveText("Welcome to Rumi.");
    await expect(main(page).getByText("Four quick questions. You can skip all of them.")).toBeVisible();
    await expect(primary(page)).toHaveCount(1);
    await expect(primary(page)).toHaveText("Start");
    await expect(main(page).getByText("You can change this later in Settings.")).toBeVisible();
    await expect(main(page).getByRole("link", { name: /^Back/ })).toHaveAttribute("href", "/");
    await expect(page.locator('nav[aria-label="App"]')).toHaveCount(0);
  });

  test("the fields stay as typed after the page loads, and the theme card shows the real look", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/welcome");
    const name = page.getByLabel("What should I call you?");
    await expect(name).toBeEnabled();
    await name.fill("Sam");
    await page.waitForTimeout(500);
    await expect(name).toHaveValue("Sam");
    await expect(page.getByRole("radio", { name: /Low Light/ })).toBeChecked();
  });

  test("the fields have their labels and the helper is called Rumi", async ({ page }) => {
    await page.goto("/welcome");
    await expect(page.getByLabel("What should I call you?")).toHaveValue("");
    await expect(page.getByLabel("Name your helper")).toHaveValue("Rumi");
    await expect(page.getByText("How do you like to get information?")).toBeVisible();
    await expect(page.getByText("Pick how it looks")).toBeVisible();
    for (const name of ["Read", "Listen", "Both", "Short", "Detailed"]) {
      await expect(page.getByRole("radio", { name, exact: true })).toBeVisible();
    }
  });

  test("choosing Low Light applies at once and survives a reload", async ({ page }) => {
    await page.goto("/welcome");
    await page.getByRole("radio", { name: /Low Light/ }).click();
    await expect(page.locator("html")).toHaveAttribute("data-app-theme", "low");
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-app-theme", "low");
    await expect(page.getByRole("radio", { name: /Low Light/ })).toBeChecked();
  });

  test("a name and Start lead to a greeting; setup is saved", async ({ page }) => {
    await page.goto("/welcome");
    await page.getByLabel("What should I call you?").fill("Sam");
    await page.getByRole("radio", { name: "Listen", exact: true }).click();
    await page.getByRole("radio", { name: "Detailed", exact: true }).click();
    await primary(page).click();
    await expect(page).toHaveURL(/\/home$/);
    await expect(main(page).getByRole("heading", { level: 1 })).toHaveText("Hi, Sam.");
    const state = await stored(page);
    expect(state.settings).toMatchObject({ onboarded: true, name: "Sam", outputMode: "listen", detail: "detailed" });
  });

  test("Skip for now saves setup and leaves the name unset", async ({ page }) => {
    await page.goto("/welcome");
    await page.getByRole("link", { name: "Skip for now" }).click();
    await expect(page).toHaveURL(/\/home$/);
    await expect(main(page).getByRole("heading", { level: 1 })).toHaveText("Hi.");
    const state = await stored(page);
    expect(state.settings.onboarded).toBe(true);
    expect(state.settings.name).toBeFalsy();
  });

  test("Skip for now keeps what was typed", async ({ page }) => {
    await page.goto("/welcome");
    await page.getByLabel("What should I call you?").fill("Alex");
    await page.getByRole("link", { name: "Skip for now" }).click();
    await expect(main(page).getByRole("heading", { level: 1 })).toHaveText("Hi, Alex.");
  });

  for (const how of ["Start", "Skip for now"]) {
    test(`with storage blocked, ${how} still goes to /home`, async ({ page }) => {
      await page.addInitScript(() => {
        Storage.prototype.getItem = () => {
          throw new Error("blocked");
        };
        Storage.prototype.setItem = () => {
          throw new Error("blocked");
        };
      });
      await page.goto("/welcome");
      await expect(page.getByLabel("Name your helper")).toBeVisible();
      await page.getByRole(how === "Start" ? "button" : "link", { name: how }).click();
      await expect(page).toHaveURL(/\/home$/);
    });
  }

  test("Open Rumi goes to /home once setup is saved", async ({ page }) => {
    await page.goto("/welcome");
    await primary(page).click();
    await expect(page).toHaveURL(/\/home$/);
    await page.goto("/help");
    await expect(page.locator("header").getByRole("link", { name: "Open Rumi" }).or(page.locator("footer").getByRole("link", { name: "Open Rumi" })).first()).toHaveAttribute("href", "/home");
  });
});

test.describe("app screens in every look", () => {
  for (const theme of ["soft", "contrast", "low"]) {
    for (const [route, kind] of [["/home", "practiced"], ["/welcome", "empty"]] as const) {
      test(`${route} has no accessibility violations in ${theme}`, async ({ page }) => {
        await seed(page, kind, { theme });
        await page.goto(route);
        await expect(main(page).locator("[data-needs-js]").first()).toBeVisible();
        await page.waitForTimeout(400);
        const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
        expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
      });
    }
  }
});
