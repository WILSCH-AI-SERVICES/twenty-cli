import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/cli/__tests__/e2e/**/*.spec.ts"],
    environment: "node",
    pool: "forks",
  },
});
