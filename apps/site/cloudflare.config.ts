import { defineConfig } from "cf/config";

export default defineConfig({
  worker: {
    name: "alavu-site",
    compatibilityDate: "2026-10-06",
    domains: ["alavu.praveenjuge.com"],
    observability: { enabled: true },
  },
});
