#!/usr/bin/env node
// Browser smoke test for the site and the web app, run with `bun run e2e`.
//
// It uses the Playwright that Claude Code cloud sessions ship with (found through NODE_PATH),
// or one you install yourself. If nothing is listening on E2E_BASE_URL it starts `bun run dev`
// and stops it at the end.
//
// Signed out, it checks the marketing pages, the app's CSP, the sign-in redirect and the
// failed sign-in screen. To check the signed-in app too, give it a WorkOS Staging test user:
//
//   WORKOS_API_KEY        Staging API key (sk_test_…); the password grant needs it.
//   ALAVU_E2E_EMAIL       Test user's email.
//   ALAVU_E2E_PASSWORD    Test user's password.
//
// or ALAVU_E2E_REFRESH_TOKEN, a Staging refresh token (WorkOS rotates these, so one only
// works once). Screenshots go to E2E_OUTPUT (default e2e/output).

import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const webDir = join(here, "..");
const base = (process.env.E2E_BASE_URL ?? "http://localhost:8787").replace(/\/$/, "");
const output = process.env.E2E_OUTPUT ?? join(here, "output");
// Staging client ID, the same public value as VITE_WORKOS_CLIENT_ID in .env.development.
const clientId = process.env.VITE_WORKOS_CLIENT_ID ?? "client_01M6DXC6397GAZ507HQ6CDZCZW";

const { chromium } = loadPlaywright();
mkdirSync(output, { recursive: true });

const results = [];
async function check(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`  ✓ ${name}`);
  } catch (error) {
    results.push({ name, ok: false });
    console.log(`  ✗ ${name}\n    ${String(error?.message ?? error).split("\n")[0]}`);
  }
}
function expect(condition, message) {
  if (!condition) throw new Error(message);
}

const server = await ensureServer();
const browser = await chromium.launch();
try {
  console.log(`Smoke testing ${base}`);
  await signedOut();
  const refreshToken = await mintRefreshToken();
  if (refreshToken) await signedIn(refreshToken);
  else if (refreshToken === null) {
    console.log("  - Signed-in checks skipped: no WorkOS test user configured (see e2e/smoke.mjs)");
  }
} finally {
  await browser.close();
  server?.kill("SIGTERM");
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed} passed, ${failed} failed. Screenshots in ${output}`);
process.exit(failed ? 1 : 0);

// MARK: Checks

async function signedOut() {
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = collectErrors(page);

  await check("landing page renders with a link to the app", async () => {
    const response = await page.goto(`${base}/`);
    expect(response?.status() === 200, `status ${response?.status()}`);
    expect((await page.title()).startsWith("Alavu"), `title "${await page.title()}"`);
    expect((await page.locator('a[href="/app/"]').count()) > 0, "no link to /app/");
    await page.screenshot({ path: join(output, "landing.png"), fullPage: true });
  });

  for (const path of ["/privacy/", "/terms/", "/support/"]) {
    await check(`${path} renders`, async () => {
      const response = await page.goto(`${base}${path}`);
      expect(response?.status() === 200, `status ${response?.status()}`);
    });
  }

  await check("/app/ sends a CSP and noindex", async () => {
    const response = await page.request.get(`${base}/app/`);
    const headers = response.headers();
    expect(headers["content-security-policy"]?.includes("default-src 'self'"), "missing CSP");
    expect(headers["x-robots-tag"] === "noindex", "missing X-Robots-Tag");
  });

  await check("/app/ redirects a signed-out visitor to WorkOS AuthKit", async () => {
    // Playwright doesn't route redirect hops, so watch requests and leave once WorkOS is hit.
    const authorize = page.waitForRequest((r) => r.url().includes("/user_management/authorize"), {
      timeout: 15_000,
    });
    await page.goto(`${base}/app/`).catch(() => {});
    const url = (await authorize).url();
    await page.goto("about:blank");
    expect(url.includes(`client_id=${clientId}`), `unexpected client_id in ${url}`);
  });

  await check("a failed sign-in shows Try Again instead of looping", async () => {
    await page.goto(`${base}/app/?signin=failed`);
    await page.getByRole("button", { name: "Try Again" }).waitFor({ timeout: 15_000 });
    await page.screenshot({ path: join(output, "signin-failed.png") });
  });

  await check("no console errors while signed out", async () => {
    expect(errors.length === 0, errors.join(" | "));
  });
  await context.close();
}

async function signedIn(refreshToken) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const page = await context.newPage();
  const errors = collectErrors(page);

  await check("test session starts", async () => {
    const response = await page.request.post(`${base}/app/auth/test-session`, {
      headers: { Origin: base, "X-Alavu": "1" },
      data: { refreshToken },
    });
    expect(response.ok(), `status ${response.status()}: ${await response.text()}`);
  });

  await check("app loads the account (Overview or first-run setup)", async () => {
    // A rejected session sends the app to WorkOS; tell that apart from a slow load.
    const signedOut = page
      .waitForRequest((r) => r.url().includes("/user_management/authorize"), { timeout: 30_000 })
      .then(() => "signed out");
    signedOut.catch(() => {});
    await page.goto(`${base}/app/`);
    const overview = page.getByRole("heading", { name: "Overview" });
    const setup = page.getByRole("heading", { name: "Welcome to Alavu" });
    const loaded = overview
      .or(setup)
      .first()
      .waitFor({ timeout: 30_000 })
      .then(() => "loaded");
    loaded.catch(() => {});
    const outcome = await Promise.race([loaded, signedOut]).catch(() => "timed out");
    expect(outcome !== "signed out", "WorkOS rejected the session and the app went to sign in");
    expect(outcome === "loaded", "neither Overview nor setup appeared within 30 seconds");
    await page.screenshot({ path: join(output, "app-home.png"), fullPage: true });
    if (await setup.isVisible()) {
      console.log("    (account is on first-run setup; finish it once to check every view)");
    }
  });

  const views = [
    ["activity", "Activity"],
    ["budgets", "Budgets"],
    ["settings", "Settings"],
    ["settings/spaces", "Spaces"],
    ["settings/categories", "Categories"],
    ["settings/payment-methods", "Payment Methods"],
    ["settings/repeating", "Repeating"],
  ];
  if (await page.getByRole("heading", { name: "Overview" }).isVisible()) {
    for (const [path, name] of views) {
      await check(`/app/${path} renders`, async () => {
        await page.goto(`${base}/app/${path}`);
        await page.locator("main, [role=main], h1").first().waitFor({ timeout: 15_000 });
        await page.waitForLoadState("networkidle").catch(() => {});
        await page.screenshot({
          path: join(output, `app-${path.replaceAll("/", "-")}.png`),
          fullPage: true,
        });
        expect(!(await page.getByText("Something went wrong").isVisible()), `${name} errored`);
      });
    }
  }

  await check("no console errors while signed in", async () => {
    expect(errors.length === 0, errors.join(" | "));
  });
  await context.close();
}

// MARK: Helpers

function collectErrors(page) {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const source = message.location().url ?? "";
    // Only this site's pages count, not WorkOS's hosted sign-in page.
    if (source && !source.startsWith(base)) return;
    // Signed out, the SPA asks for a token first and gets the expected 401.
    if (source.startsWith(`${base}/app/auth/token`)) return;
    errors.push(`${message.text()} (${source})`);
  });
  return errors;
}

async function mintRefreshToken() {
  if (process.env.ALAVU_E2E_REFRESH_TOKEN) return process.env.ALAVU_E2E_REFRESH_TOKEN;
  const { WORKOS_API_KEY, ALAVU_E2E_EMAIL, ALAVU_E2E_PASSWORD } = process.env;
  if (!WORKOS_API_KEY || !ALAVU_E2E_EMAIL || !ALAVU_E2E_PASSWORD) return null;
  const response = await fetch("https://api.workos.com/user_management/authenticate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: WORKOS_API_KEY,
      grant_type: "password",
      email: ALAVU_E2E_EMAIL,
      password: ALAVU_E2E_PASSWORD,
    }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || typeof body.refresh_token !== "string") {
    results.push({ name: "WorkOS test user signs in", ok: false });
    console.log(
      `  ✗ WorkOS test user signs in\n    ${body.error_description ?? body.message ?? response.status}`,
    );
    return false;
  }
  return body.refresh_token;
}

async function ensureServer() {
  if (await reachable()) return null;
  if (process.env.E2E_BASE_URL) throw new Error(`${base} isn't reachable`);
  console.log("Starting the dev server…");
  const child = spawn("bun", ["run", "dev"], { cwd: webDir, stdio: "ignore", detached: false });
  for (let i = 0; i < 60; i++) {
    if (await reachable()) return child;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  child.kill("SIGTERM");
  throw new Error("The dev server didn't start within 60 seconds");
}

async function reachable() {
  try {
    return (await fetch(`${base}/`, { signal: AbortSignal.timeout(2000) })).ok;
  } catch {
    return false;
  }
}

function loadPlaywright() {
  const require = createRequire(import.meta.url);
  try {
    return require("playwright");
  } catch {
    console.error(
      "Playwright isn't available. Cloud sessions have it pre-installed; locally, run\n" +
        "`npm i -g playwright && npx playwright install chromium` (or set NODE_PATH).",
    );
    process.exit(2);
  }
}
