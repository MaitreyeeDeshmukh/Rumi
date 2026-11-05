/**
 * The anonymous flow in a real browser (MOCK_AI=1, Supabase answered by tests/e2e/supabaseMock.ts, nothing leaves the machine).
 *
 * Runs now: the mock itself, "Supabase is unreachable" for every page (the app still works, axe is clean, no page
 * error, and no browser request ever carries a secret), and the anonymous sign-in on page load (needs RUMI_E2E_AUTH=1 and a
 * build with NEXT_PUBLIC_SUPABASE_URL=https://rumi-ci.supabase.test). Still skipped: the tests that need UI that does not exist yet,
 * each marked `test.fixme` below with the missing piece named.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { ROUTES } from "../../src/lib/site";
import { mockSupabase, SUPABASE_HOST, USER_ID } from "./supabaseMock";

const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21aa"];
const SECRET_SHAPES = /service_role|sb_secret_|gsk_[A-Za-z0-9]{20,}|SUPABASE_SECRET_KEY/;

/** Literal text the app must show. The first is frozen in 08-production-addendum.md section 3 (AuthProvider). */
const UI = {
  pausedLine: "Saving is paused. Your work is on this device.",
  deviceOnlyNotice: /data on this device only/i,
};

/** Collects every request the page makes, with its headers, so a test can search them. */
function watchRequests(page: Page): { seen: string[] } {
  const seen: string[] = [];
  page.on("request", (r) => {
    void r.allHeaders().then((h) => seen.push(`${r.method()} ${r.url()} ${JSON.stringify(h)}`));
  });
  return { seen };
}

test.describe("the Supabase mock answers like Supabase", () => {
  /** Calls the mocked host from the page, so CORS and the route interception are both exercised. */
  const call = (page: Page, path: string, init: { method?: string; body?: string } = {}) =>
    page.evaluate(
      async ([host, p, i]) => {
        try {
          const res = await fetch(`https://${host}${p}`, { method: i.method ?? "GET", headers: { "content-type": "application/json", apikey: "sb_publishable_test" }, body: i.body });
          return { status: res.status, text: await res.text() };
        } catch {
          return { status: 0, text: "network error" };
        }
      },
      [SUPABASE_HOST, path, init] as const,
    );

  test("anonymous sign-up returns a session for the test user, and the call is recorded", async ({ page, context }) => {
    const mock = await mockSupabase(context);
    await page.goto("about:blank"); // not "/": the site CSP (connect-src) does not allow the Supabase host until the auth lane adds it
    const res = await call(page, "/auth/v1/signup", { method: "POST", body: "{}" });
    expect(res.status).toBe(200);
    const session = JSON.parse(res.text) as { access_token: string; user: { id: string; is_anonymous: boolean } };
    expect(session.user).toMatchObject({ id: USER_ID, is_anonymous: true });
    expect(session.access_token.split(".")).toHaveLength(3);
    expect(mock.to("/auth/v1/").map((c) => `${c.method} ${c.path}`)).toEqual(["POST /auth/v1/signup"]);
  });

  test("each failure mode answers with the status Supabase would use", async ({ page, context }) => {
    const mock = await mockSupabase(context);
    await page.goto("about:blank");
    mock.authMode = "anonymous_disabled";
    expect((await call(page, "/auth/v1/signup", { method: "POST", body: "{}" })).status).toBe(422);
    mock.authMode = "rate_limited";
    expect((await call(page, "/auth/v1/signup", { method: "POST", body: "{}" })).status).toBe(429);
    mock.authMode = "down";
    expect((await call(page, "/auth/v1/signup", { method: "POST", body: "{}" })).status).toBe(0);
    mock.authMode = "ok";
    mock.restDown = true;
    expect((await call(page, "/rest/v1/plan_visit_plans")).status).toBe(0);
    mock.restDown = false;
    expect((await call(page, "/rest/v1/plan_visit_plans")).status).toBe(200);
    expect((await call(page, "/rest/v1/rpc/persona_upsert_facts", { method: "POST", body: "[]" })).status).toBe(200);
  });
});

test.describe("Supabase is unreachable: every page still works", () => {
  for (const route of ROUTES) {
    test(`${route}: loads, no page error, no accessibility violation, no secret in any request`, async ({ page, context }) => {
      const mock = await mockSupabase(context);
      mock.authMode = "down";
      mock.restDown = true;
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.name));
      const { seen } = watchRequests(page);

      const res = await page.goto(route);
      expect(res?.status()).toBe(200);
      await expect(page.locator("main")).toBeVisible();
      await page.waitForLoadState("networkidle");

      expect(errors, "uncaught errors on the page").toEqual([]);
      const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
      expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
      expect(seen.filter((l) => SECRET_SHAPES.test(l))).toEqual([]);
    });
  }
});

// ---------------------------------------------------------------------------------------------------------------------
// AuthProvider is mounted in layout.tsx and signs in anonymously, so the first test runs. The others need UI that belongs to
// the UI lane and is not in this branch: nothing renders the paused-saving line (useAuth().status is not shown anywhere), and
// there is no cloud-sync consent control, "Save plan" button or "data on this device only" notice. They stay as test.fixme
// until that UI lands; then change test.fixme back to test and confirm the texts in `UI` above against it.
// ---------------------------------------------------------------------------------------------------------------------
test.describe("anonymous flow with a working Supabase", () => {
  test.skip(process.env.RUMI_E2E_AUTH !== "1", "set RUMI_E2E_AUTH=1 (the CI e2e job does)");

  test("a fresh browser signs in anonymously without being asked, and the page stays usable", async ({ page, context }) => {
    const mock = await mockSupabase(context);
    await page.goto("/");
    await expect.poll(() => mock.to("/auth/v1/signup").length, { message: "anonymous sign-in call" }).toBe(1);
    await expect(page.locator("main")).toBeVisible();
    expect(await page.locator("body").innerText()).not.toContain(UI.pausedLine);
  });

  // Needs UI lane: a cloud-sync consent checkbox and a "Save plan" button. Neither exists in the built app.
  test.fixme("saving a plan with consent writes to Supabase as the signed-in user, then keeps working offline and syncs on reconnect", async ({ page, context }) => {
    const mock = await mockSupabase(context);
    await page.goto("/");
    await expect.poll(() => mock.to("/auth/v1/signup").length).toBe(1);

    await page.getByRole("checkbox", { name: /save .*(account|cloud|sync|my plans)/i }).check();
    await page.getByRole("button", { name: /save (my )?plan/i }).click();
    await expect.poll(() => mock.to("/rest/v1/").filter((c) => c.method !== "GET").length, { message: "first cloud write" }).toBeGreaterThan(0);
    const firstWrite = mock.to("/rest/v1/").find((c) => c.method !== "GET");
    expect(firstWrite?.authorization, "writes use the user's token, not the publishable key").toMatch(/^Bearer eyJ/);

    const before = mock.to("/rest/v1/").filter((c) => c.method !== "GET").length;
    await context.setOffline(true);
    await page.getByRole("button", { name: /save (my )?plan/i }).click();
    await expect(page.locator("main")).toBeVisible();
    expect(mock.to("/rest/v1/").filter((c) => c.method !== "GET").length, "no cloud write is possible while offline").toBe(before);

    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect.poll(() => mock.to("/rest/v1/").filter((c) => c.method !== "GET").length, { message: "sync after reconnect" }).toBeGreaterThan(before);
  });

  // Needs UI lane: the "data on this device only" notice (shown when the identity changed). Not in the built app.
  test.fixme("clearing site data shows the 'data on this device only' notice", async ({ page, context }) => {
    await mockSupabase(context);
    await page.goto("/");
    await context.clearCookies();
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await page.reload();
    await expect(page.getByText(UI.deviceOnlyNotice)).toBeVisible();
  });

  // Needs UI lane: the notice state it checks does not exist (the signed-in half is covered by the per-page axe tests above).
  test.fixme("axe passes on the signed-in state and the notice state", async ({ page, context }) => {
    await mockSupabase(context);
    await page.goto("/");
    await expect(page.locator("main")).toBeVisible();
    const signedIn = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
    expect(signedIn.violations.map((v) => v.id)).toEqual([]);
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    const notice = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
    expect(notice.violations.map((v) => v.id)).toEqual([]);
  });
});

// Needs UI lane: nothing renders the paused-saving line from useAuth().status yet, so these cannot find it.
test.describe.fixme("sign-in refused", () => {
  test.skip(process.env.RUMI_E2E_AUTH !== "1", "set RUMI_E2E_AUTH=1 (the CI e2e job does)");

  for (const mode of ["anonymous_disabled", "rate_limited", "down"] as const) {
    test(`${mode}: the paused-saving line shows, the app still works, axe passes`, async ({ page, context }) => {
      const mock = await mockSupabase(context);
      mock.authMode = mode;
      await page.goto("/");
      await expect(page.getByText(UI.pausedLine)).toBeVisible();
      await expect(page.locator("main")).toBeVisible();
      const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
      expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
      expect(mock.to("/rest/v1/"), "nothing is written to the cloud without a user").toEqual([]);
    });
  }
});
