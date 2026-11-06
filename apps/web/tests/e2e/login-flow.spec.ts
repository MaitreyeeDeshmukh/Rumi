/**
 * Log in, sign up, confirm, forgot and reset password in a real browser (MOCK_AI=1, Supabase answered by tests/e2e/supabaseMock.ts
 * plus the account answers below; nothing leaves the machine). The pages themselves need no Supabase. The tests that submit a form need
 * a build with NEXT_PUBLIC_SUPABASE_URL=https://rumi-ci.supabase.test (its CSP then allows that host), so they run with RUMI_E2E_AUTH=1.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { fakeAccessToken, mockSupabase, SUPABASE_HOST, USER_ID } from "./supabaseMock";

// Pages hydrate and mock calls round-trip on a busy CI machine: allow twice the default time per test.
test.describe.configure({ timeout: 60_000 });

const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21aa"];
const PAGES = ["/login", "/signup", "/forgot-password", "/reset-password", "/auth/confirm"] as const;
const PASSWORD = "a long enough passphrase";
const ORIGIN = `https://${SUPABASE_HOST}`;

interface Seen {
  method: string;
  url: string;
  body: string | null;
}

/** Answers the account calls the way Supabase Auth does, for this page only (a page route wins over the context route of the shared mock). */
async function mockAccounts(page: Page, options: { token?: "ok" | "invalid" | "unconfirmed"; signup?: "confirm" | "session" } = {}): Promise<Seen[]> {
  const seen: Seen[] = [];
  const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*", "access-control-expose-headers": "*" };
  const reply = (status: number, body: unknown) => ({ status, headers: { ...cors, "content-type": "application/json" }, body: JSON.stringify(body) });
  const user = { id: USER_ID, aud: "authenticated", role: "authenticated", email: "me@example.test", is_anonymous: false, app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() };
  const session = () => ({ access_token: fakeAccessToken(), token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: "refresh-token-for-tests", user });
  await page.route(`${ORIGIN}/auth/v1/**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    seen.push({ method: req.method(), url: req.url(), body: req.postData() });
    if (url.pathname === "/auth/v1/token") {
      if (options.token === "invalid") return route.fulfill(reply(400, { code: 400, error_code: "invalid_credentials", msg: "Invalid login credentials" }));
      if (options.token === "unconfirmed") return route.fulfill(reply(400, { code: 400, error_code: "email_not_confirmed", msg: "Email not confirmed" }));
      return route.fulfill(reply(200, session()));
    }
    if (url.pathname === "/auth/v1/signup") return route.fulfill(reply(200, options.signup === "session" ? session() : { ...user, identities: [] }));
    return route.fulfill(reply(200, {}));
  });
  return seen;
}

/** Opens a page and, when it has a form, waits until React has attached to it (a click before that would be a plain browser form post). */
async function go(page: Page, url: string): Promise<void> {
  await page.goto(url);
  if ((await page.locator("form").count()) === 0) return;
  await page.waitForFunction(() => {
    const form = document.querySelector("form");
    return form !== null && Object.keys(form).some((k) => k.startsWith("__reactProps"));
  });
}

const calls = (seen: Seen[], path: string): Seen[] => seen.filter((c) => new URL(c.url).pathname === path);

test.describe("the pages render without Supabase", () => {
  for (const route of PAGES) {
    test(`${route}: one h1, noindex, no page error, no horizontal scroll at 320px, axe clean`, async ({ page, context }) => {
      const mock = await mockSupabase(context);
      mock.authMode = "down";
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.name));
      await page.setViewportSize({ width: 320, height: 800 });
      const res = await page.goto(route);
      expect(res?.status()).toBe(200);
      await expect(page.locator("h1")).toHaveCount(1);
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
      await page.waitForLoadState("networkidle");
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
      expect(errors, "uncaught errors on the page").toEqual([]);
      const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
      expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
    });
  }

  test("/login: labelled fields with the right autocomplete, links, no Google button by default", async ({ page }) => {
    await go(page, "/login");
    await expect(page.getByLabel("Email")).toHaveAttribute("autocomplete", "email");
    await expect(page.getByLabel("Password")).toHaveAttribute("autocomplete", "current-password");
    await expect(page.getByLabel("Password")).toHaveAttribute("type", "password");
    await expect(page.getByRole("form").or(page.locator("form"))).toHaveAttribute("method", "post");
    await expect(page.getByRole("link", { name: "Forgot password?" })).toHaveAttribute("href", "/forgot-password");
    await expect(page.getByRole("link", { name: /No account yet\? Sign up/ })).toHaveAttribute("href", "/signup");
    await expect(page.getByRole("link", { name: "Continue without an account" })).toHaveAttribute("href", "/");
    await expect(page.getByRole("button", { name: "Continue with Google" })).toHaveCount(0);
  });

  test("/signup: new-password autocomplete, show and hide password, link to log in keeps a safe next", async ({ page }) => {
    await go(page, "/signup?next=/help");
    const password = page.getByLabel("Password");
    await expect(password).toHaveAttribute("autocomplete", "new-password");
    await page.getByRole("button", { name: "Show password" }).click();
    await expect(password).toHaveAttribute("type", "text");
    await page.getByRole("button", { name: "Hide password" }).click();
    await expect(password).toHaveAttribute("type", "password");
    await expect(page.getByRole("link", { name: /Have an account\? Log in/ })).toHaveAttribute("href", "/login?next=%2Fhelp");
    await page.goto("/signup?next=//evil.test");
    await expect(page.getByRole("link", { name: /Have an account\? Log in/ })).toHaveAttribute("href", "/login");
  });

  test("the buttons and links are at least 44px high on a phone", async ({ page }) => {
    await go(page, "/login");
    for (const target of [page.getByRole("button", { name: "Log in" }), page.getByRole("button", { name: "Show password" }), page.getByRole("link", { name: "Forgot password?" }), page.getByRole("link", { name: "Continue without an account" })]) {
      const box = await target.boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
  });
});

test.describe("validation", () => {
  test("/login: empty submit shows both errors, moves focus to the email, and calls nothing", async ({ page, context }) => {
    const mock = await mockSupabase(context);
    await go(page, "/login");
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page.getByText("Enter your email.")).toBeVisible();
    await expect(page.getByText("Enter your password.")).toBeVisible();
    await expect(page.getByLabel("Email")).toBeFocused();
    await expect(page.getByLabel("Email")).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByLabel("Email")).toHaveAttribute("aria-describedby", "login-email-error");
    expect(mock.to("/auth/v1/")).toEqual([]);
  });

  test("/signup: a short password shows the length error and focuses the password", async ({ page, context }) => {
    const mock = await mockSupabase(context);
    await go(page, "/signup");
    await page.getByLabel("Email").fill("new@example.test");
    await page.getByLabel("Password").fill("short");
    await page.getByRole("button", { name: "Sign up" }).click();
    await expect(page.getByText("Use at least 8 characters.", { exact: true }).first()).toBeVisible();
    await expect(page.getByLabel("Password")).toBeFocused();
    expect(mock.to("/auth/v1/")).toEqual([]);
  });

  test("/signup and axe: the error state has no violations", async ({ page }) => {
    await go(page, "/signup");
    await page.getByRole("button", { name: "Sign up" }).click();
    const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  });

  test("/reset-password with no recovery session says so and links to /forgot-password", async ({ page, context }) => {
    await mockSupabase(context);
    await go(page, "/reset-password");
    await expect(page.getByText("This reset link does not work any more, so ask for a new one.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Ask for a new link" })).toHaveAttribute("href", "/forgot-password");
  });

  test("/auth/confirm with no session says the link did not work, with a way to log in", async ({ page, context }) => {
    await mockSupabase(context);
    await go(page, "/auth/confirm");
    await expect(page.getByText(/This link did not work/)).toBeVisible();
    await expect(page.getByRole("link", { name: "Log in" })).toHaveAttribute("href", "/login");
  });
});

test.describe("submitting, with Supabase answered by the mock", () => {
  test.skip(process.env.RUMI_E2E_AUTH !== "1", "set RUMI_E2E_AUTH=1 and build with NEXT_PUBLIC_SUPABASE_URL=https://rumi-ci.supabase.test");

  test("log in: one password-grant call with the lowercased address, the password only in the body, then home", async ({ page, context }) => {
    await mockSupabase(context);
    const seen = await mockAccounts(page);
    await go(page, "/login");
    await page.getByLabel("Email").fill("  Me@Example.TEST ");
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page).toHaveURL("/");
    const token = calls(seen, "/auth/v1/token");
    expect(token).toHaveLength(1);
    expect(token[0]?.url).toContain("grant_type=password");
    expect(token[0]?.url).not.toContain("passphrase");
    expect(JSON.parse(token[0]?.body ?? "{}")).toMatchObject({ email: "me@example.test", password: PASSWORD });
    expect(page.url()).not.toContain("passphrase");
  });

  test("log in goes to a safe next path, and ignores an address on another site", async ({ page, context }) => {
    await mockSupabase(context);
    await mockAccounts(page);
    await go(page, "/login?next=/help");
    await page.getByLabel("Email").fill("me@example.test");
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page).toHaveURL("/help");

    await context.clearCookies();
    await page.evaluate(() => localStorage.clear());
    await go(page, "/login?next=//evil.test/x");
    await page.getByLabel("Email").fill("me@example.test");
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page).toHaveURL("/");
  });

  test("wrong credentials: one literal sentence in an alert, focus moves to it, the password is not in the address", async ({ page, context }) => {
    await mockSupabase(context);
    const seen = await mockAccounts(page, { token: "invalid" });
    await go(page, "/login");
    await page.getByLabel("Email").fill("me@example.test");
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Log in" }).click();
    const alert = page.getByRole("alert").filter({ hasText: "That email or password is not right." });
    await expect(alert).toBeVisible();
    await expect(alert).toBeFocused();
    expect(calls(seen, "/auth/v1/token")).toHaveLength(1);
    expect(page.url()).not.toContain("passphrase");
  });

  test("log in with an unconfirmed email offers to send the link again", async ({ page, context }) => {
    await mockSupabase(context);
    const seen = await mockAccounts(page, { token: "unconfirmed" });
    await go(page, "/login");
    await page.getByLabel("Email").fill("me@example.test");
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page.getByText("Your email is not confirmed yet, so check your inbox.")).toBeVisible();
    await page.getByRole("button", { name: "Send the link again" }).click();
    await expect.poll(() => calls(seen, "/auth/v1/resend").length).toBe(1);
    expect(JSON.parse(calls(seen, "/auth/v1/resend")[0]?.body ?? "{}")).toMatchObject({ type: "signup", email: "me@example.test" });
  });

  test("sign up with confirmation on: 'Check your email' with the address, and Resend waits out the one-minute cooldown", async ({ page, context }) => {
    await mockSupabase(context);
    const seen = await mockAccounts(page, { signup: "confirm" });
    await go(page, "/signup");
    await page.getByLabel("Email").fill("New@Example.test");
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign up" }).click();
    await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
    await expect(page.getByText("new@example.test", { exact: false }).first()).toBeVisible();
    expect(calls(seen, "/auth/v1/signup")).toHaveLength(1);
    expect(new URL(calls(seen, "/auth/v1/signup")[0]?.url ?? "").searchParams.get("redirect_to")).toMatch(/\/auth\/confirm$/);
    await expect(page.getByRole("link", { name: "Back to log in" })).toHaveAttribute("href", "/login");

    await page.getByRole("button", { name: "Send the link again" }).click();
    await expect(page.getByText("A link was just asked for, so wait one minute before asking again.")).toBeVisible();
    expect(calls(seen, "/auth/v1/resend")).toEqual([]);
    const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  });

  test("sign up when Auth returns a session (confirmation off) signs in and goes home", async ({ page, context }) => {
    await mockSupabase(context);
    await mockAccounts(page, { signup: "session" });
    await go(page, "/signup");
    await page.getByLabel("Email").fill("new@example.test");
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign up" }).click();
    await expect(page).toHaveURL("/");
  });

  test("forgot password: the same neutral answer, one recover call that returns to /reset-password", async ({ page, context }) => {
    await mockSupabase(context);
    const seen = await mockAccounts(page);
    await go(page, "/forgot-password");
    await page.getByLabel("Email").fill("nobody@example.test");
    await page.getByRole("button", { name: "Send reset link" }).click();
    await expect(page.getByText("If that address has an account, we sent a link to reset the password.")).toBeVisible();
    const recover = calls(seen, "/auth/v1/recover");
    expect(recover).toHaveLength(1);
    expect(new URL(recover[0]?.url ?? "").searchParams.get("redirect_to")).toMatch(/\/reset-password$/);
  });
});
