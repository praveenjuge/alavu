import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@convex": fileURLToPath(new URL("../../convex", import.meta.url)) } },
  test: { include: ["src/**/*.test.ts"], environment: "node" },
});
