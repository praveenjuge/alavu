/// <reference types="vite/client" />
// Serves /app/*: sign-in routes and the SPA fallback. Everything else on the site is
// plain static assets and never reaches this Worker.
//
// Sign-in uses WorkOS AuthKit's hosted pages (Apple, Google, and any email check WorkOS
// needs) with a public client and PKCE. The refresh token lives only in an HttpOnly
// cookie; the SPA asks /app/auth/token for short-lived access tokens and never sees it.

interface Env {
  ASSETS: Fetcher;
}

const WORKOS = "https://api.workos.com/user_management";
const CLIENT_ID = import.meta.env.VITE_WORKOS_CLIENT_ID as string;
const CONVEX_URL = import.meta.env.VITE_CONVEX_URL as string;

const SESSION = "__Host-alavu_session";
const PENDING = "__Host-alavu_pending";
const SESSION_MAX_AGE = 60 * 60 * 24 * 365;
const SHORT_MAX_AGE = 60 * 15;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/app/auth/")) {
      try {
        return await auth(request, url);
      } catch {
        return json({ error: "Something went wrong. Please try again." }, 500);
      }
    }
    return await spa(request, url, env);
  },
} satisfies ExportedHandler<Env>;

// MARK: SPA

async function spa(request: Request, url: URL, env: Env) {
  let response = await env.ASSETS.fetch(request);
  const isPage = !/\.[a-z0-9]+$/i.test(url.pathname);
  if (response.status === 404 && isPage) {
    response = await env.ASSETS.fetch(new Request(new URL("/app/", url), request));
  }
  if (!(response.headers.get("content-type") ?? "").includes("text/html")) return response;
  const headers = new Headers(response.headers);
  const convex = new URL(CONVEX_URL);
  headers.set(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      // Vite's dev server injects an inline Fast Refresh preamble; production stays strict.
      import.meta.env.DEV ? "script-src 'self' 'unsafe-inline'" : "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https://*.r2.cloudflarestorage.com",
      `connect-src 'self' https://${convex.host} wss://${convex.host} https://*.r2.cloudflarestorage.com https://us.i.posthog.com`,
      "font-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'none'",
      "form-action 'self'",
    ].join("; "),
  );
  headers.set("Referrer-Policy", "no-referrer");
  // The app is behind sign-in; only the marketing pages belong in search results.
  headers.set("X-Robots-Tag", "noindex");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Cache-Control", "no-cache");
  return new Response(response.body, { status: response.status, headers });
}

// MARK: Auth routes

async function auth(request: Request, url: URL): Promise<Response> {
  const route = url.pathname.slice("/app/auth/".length);
  if (request.method === "GET" && route === "start") return start(url);
  if (request.method === "GET" && route === "callback") return callback(request, url);
  if (request.method !== "POST") return json({ error: "Not found" }, 404);
  if (!sameOrigin(request, url)) return json({ error: "Forbidden" }, 403);
  switch (route) {
    case "token":
      return token(request);
    case "signout":
      return json({ ok: true }, 200, [clear(SESSION)]);
    case "test-session":
      // Local development only: start a session from a test user's refresh token.
      // `import.meta.env.DEV` is false in production builds, so this route is removed.
      if (import.meta.env.DEV) return testSession(request);
      return json({ error: "Not found" }, 404);
    default:
      return json({ error: "Not found" }, 404);
  }
}

/** Requests with side effects must come from this site's own pages. */
function sameOrigin(request: Request, url: URL) {
  return request.headers.get("Origin") === url.origin && request.headers.get("X-Alavu") === "1";
}

async function start(url: URL) {
  const verifier = randomToken(48);
  const state = randomToken(24);
  const authorize = new URL(`${WORKOS}/authorize`);
  authorize.search = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: new URL("/app/auth/callback", url).toString(),
    response_type: "code",
    provider: "authkit",
    state,
    code_challenge: await challenge(verifier),
    code_challenge_method: "S256",
  }).toString();
  return redirect(authorize.toString(), [
    cookie(PENDING, JSON.stringify({ verifier, state }), SHORT_MAX_AGE),
  ]);
}

async function callback(request: Request, url: URL) {
  const failed = (reason: string) =>
    redirect(new URL(`/app/?signin=${reason}`, url).toString(), [clear(PENDING)]);
  const saved = parseJSON<{ verifier: string; state: string }>(cookies(request)[PENDING]);
  const code = url.searchParams.get("code");
  if (!saved || !code || url.searchParams.get("state") !== saved.state) return failed("expired");

  const response = await fetch(`${WORKOS}/authenticate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: CLIENT_ID,
      grant_type: "authorization_code",
      code,
      code_verifier: saved.verifier,
    }),
  });
  const body: Record<string, unknown> = await response
    .json<Record<string, unknown>>()
    .catch(() => ({}));
  if (!response.ok || typeof body.refresh_token !== "string") return failed("failed");
  return redirect(new URL("/app/", url).toString(), [
    clear(PENDING),
    cookie(SESSION, body.refresh_token, SESSION_MAX_AGE),
  ]);
}

/** Refreshes the session and returns a fresh access token, rotating the cookie. */
async function token(request: Request) {
  const refreshToken = cookies(request)[SESSION];
  if (!refreshToken) return json({ error: "Signed out" }, 401);
  const response = await fetch(`${WORKOS}/authenticate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: CLIENT_ID,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });
  if (response.status === 400 || response.status === 401) {
    return json({ error: "Signed out" }, 401, [clear(SESSION)]);
  }
  if (!response.ok) return json({ error: "Couldn't reach the sign-in service" }, 502);
  return session(await response.json());
}

async function testSession(request: Request) {
  const { refreshToken } = await request.json<{ refreshToken?: unknown }>();
  if (typeof refreshToken !== "string") return json({ error: "refreshToken required" }, 400);
  return json({ ok: true }, 200, [cookie(SESSION, refreshToken, SESSION_MAX_AGE)]);
}

function session(body: {
  access_token: string;
  refresh_token: string;
  user: { id: string; email: string; first_name?: string | null; last_name?: string | null };
}) {
  const name = [body.user.first_name, body.user.last_name].filter(Boolean).join(" ");
  return json(
    {
      accessToken: body.access_token,
      user: { id: body.user.id, email: body.user.email, name: name || null },
    },
    200,
    [cookie(SESSION, body.refresh_token, SESSION_MAX_AGE)],
  );
}

// MARK: Helpers

function json(body: unknown, status = 200, setCookies: string[] = []) {
  const headers = new Headers({ "Content-Type": "application/json", "Cache-Control": "no-store" });
  for (const c of setCookies) headers.append("Set-Cookie", c);
  return new Response(JSON.stringify(body), { status, headers });
}

function redirect(location: string, setCookies: string[]) {
  const headers = new Headers({ Location: location, "Cache-Control": "no-store" });
  for (const c of setCookies) headers.append("Set-Cookie", c);
  return new Response(null, { status: 302, headers });
}

function cookie(name: string, value: string, maxAge: number) {
  return `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}

function clear(name: string) {
  return `${name}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}

function cookies(request: Request): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (request.headers.get("Cookie") ?? "").split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    const key = part.slice(0, index).trim();
    try {
      out[key] = decodeURIComponent(part.slice(index + 1).trim());
    } catch {
      // Ignore cookies that aren't ours or aren't valid.
    }
  }
  return out;
}

function parseJSON<T>(value: string | undefined): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function base64url(bytes: Uint8Array) {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function randomToken(bytes: number) {
  return base64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

async function challenge(verifier: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}
