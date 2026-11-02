import { useCallback, useEffect, useMemo, useState } from "react";

// The session lives in an HttpOnly cookie held by the Worker. This module asks the
// Worker for short-lived access tokens and keeps them in memory only.
//
// WorkOS rotates the refresh token on every refresh, so two tabs refreshing at once
// would sign each other out. A Web Lock makes refreshes run one at a time across tabs,
// and a BroadcastChannel shares the fresh token so other tabs skip their own refresh.

export interface SessionUser {
  id: string;
  email: string;
  name: string | null;
}

interface Cached {
  token: string;
  expiresAt: number;
  user: SessionUser;
}

const LOCK = "alavu-auth";
const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel("alavu-auth");
let cached: Cached | null = null;
const listeners = new Set<() => void>();

channel?.addEventListener("message", (event: MessageEvent) => {
  if (event.data?.type === "token") cached = event.data.value;
  if (event.data?.type === "signout") {
    cached = null;
    location.replace("/app/");
  }
  for (const listener of listeners) listener();
});

/** Reads one claim from a JWT without verifying it; the server verifies tokens. */
function claim(jwt: string, name: string): unknown {
  try {
    return JSON.parse(atob(jwt.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")))[name];
  } catch {
    return undefined;
  }
}

function expiry(jwt: string): number {
  const exp = claim(jwt, "exp");
  return typeof exp === "number" ? exp * 1000 : 0;
}

const fresh = (c: Cached | null): c is Cached => !!c && c.expiresAt - Date.now() > 60_000;

export class SignedOutError extends Error {}

export async function post<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", "X-Alavu": "1" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await response.json().catch(() => ({}))) as { error?: string };
  if (response.status === 401) throw new SignedOutError();
  if (!response.ok) throw new Error(data.error ?? "Something went wrong. Please try again.");
  return data as T;
}

async function refresh(force: boolean): Promise<Cached | null> {
  const run = async () => {
    if (!force && fresh(cached)) return cached;
    try {
      const data = await post<{ accessToken: string; user: SessionUser }>("/app/auth/token");
      cached = { token: data.accessToken, expiresAt: expiry(data.accessToken), user: data.user };
      channel?.postMessage({ type: "token", value: cached });
      return cached;
    } catch (error) {
      if (error instanceof SignedOutError) {
        cached = null;
        return null;
      }
      throw error;
    }
  };
  return navigator.locks ? navigator.locks.request(LOCK, run) : run();
}

/** Session state for ConvexProviderWithAuth and the rest of the app. */
export function useWorkerAuth() {
  const [state, setState] = useState<{ loading: boolean; user: SessionUser | null }>({
    loading: true,
    user: null,
  });

  useEffect(() => {
    const update = () => setState({ loading: false, user: cached?.user ?? null });
    listeners.add(update);
    refresh(false)
      .then(update)
      .catch(() => setState({ loading: false, user: null }));
    return () => {
      listeners.delete(update);
    };
  }, []);

  const fetchAccessToken = useCallback(
    async ({ forceRefreshToken }: { forceRefreshToken: boolean }) => {
      const session = await refresh(forceRefreshToken).catch(() => null);
      return session?.token ?? null;
    },
    [],
  );

  return useMemo(
    () => ({
      isLoading: state.loading,
      isAuthenticated: !!state.user,
      user: state.user,
      fetchAccessToken,
    }),
    [state, fetchAccessToken],
  );
}

export function signIn() {
  location.assign("/app/auth/start");
}

/** Ends both Alavu's session and the WorkOS AuthKit session, then returns to /app. */
export async function signOut() {
  const session = cached ?? (await refresh(false).catch(() => null));
  const sid = session ? claim(session.token, "sid") : null;
  await post("/app/auth/signout").catch(() => undefined);
  cached = null;
  channel?.postMessage({ type: "signout" });
  if (typeof sid !== "string") return location.replace("/app/");
  const logout = new URL("https://api.workos.com/user_management/sessions/logout");
  logout.search = new URLSearchParams({
    session_id: sid,
    return_to: `${location.origin}/app/`,
  }).toString();
  location.replace(logout.toString());
}
