import type { PostHog } from "posthog-js";

// Anonymous pageviews and error reports through PostHog, production only, matching the
// privacy policy: never tied to the account, never amounts, titles, notes or names.
// No cookies: PostHog keeps its anonymous id in memory for the page's lifetime.
// The library loads after the app so it never slows the first screen.

const KEY = import.meta.env.VITE_POSTHOG_KEY as string | undefined;
const OPT_OUT = "alavu.analyticsOptOut";
let client: Promise<PostHog> | null = null;

export function analyticsOptedOut() {
  try {
    return localStorage.getItem(OPT_OUT) === "1";
  } catch {
    return false;
  }
}

export function startAnalytics() {
  if (!KEY || client || analyticsOptedOut()) return;
  client = import("posthog-js").then(({ default: posthog }) => {
    posthog.init(KEY, {
      api_host: "https://us.i.posthog.com",
      persistence: "memory",
      autocapture: false,
      capture_pageview: "history_change",
      capture_exceptions: true,
      disable_session_recording: true,
      disable_surveys: true,
      disable_external_dependency_loading: true,
      person_profiles: "identified_only",
    });
    return posthog;
  });
}

export function setAnalyticsOptOut(optOut: boolean) {
  try {
    if (optOut) localStorage.setItem(OPT_OUT, "1");
    else localStorage.removeItem(OPT_OUT);
  } catch {
    // The choice still applies for this visit.
  }
  if (optOut) void client?.then((p) => p.opt_out_capturing());
  else if (client) void client.then((p) => p.opt_in_capturing());
  else startAnalytics();
}
