import { bindings, defineConfig } from "cf/config";
import * as entrypoint from "./src/worker/index.ts" with { type: "cf-worker" };

// One Worker serves alavu.praveenjuge.com: the marketing pages and the SPA are static
// assets; only /app/* runs the Worker first, for sign-in routes and the SPA fallback.
export default defineConfig({
  worker: {
    name: "alavu-site",
    compatibilityDate: "2026-10-23",
    entrypoint,
    domains: ["alavu.praveenjuge.com"],
    observability: { enabled: true },
    assets: {
      htmlHandling: "auto-trailing-slash",
      notFoundHandling: "404-page",
      runWorkerFirst: ["/app", "/app/*"],
    },
    env: { ASSETS: bindings.assets() },
  },
});
