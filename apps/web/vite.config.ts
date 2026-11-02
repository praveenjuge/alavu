import { fileURLToPath } from "node:url";
import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), cloudflare()],
  // The SPA lives at /app/; its scripts and styles stay under /assets/ so they are served
  // straight from static assets without running the Worker.
  environments: { client: { build: { rollupOptions: { input: { app: "app/index.html" } } } } },
  // The Convex API types are generated at the repository root; use one copy of `convex`.
  resolve: {
    alias: { "@convex": fileURLToPath(new URL("../../convex", import.meta.url)) },
    dedupe: ["convex", "react", "react-dom"],
  },
  server: { port: 8787, strictPort: true },
});
