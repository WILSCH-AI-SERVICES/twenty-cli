import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: ["src/cli/__tests__/e2e/**"],
    coverage: {
      provider: "v8",
      thresholds: {
        statements: 83,
        branches: 70,
        functions: 83,
        lines: 83,
      },
      exclude: [
        "src/cli/__tests__/e2e/**",
        "src/**/__tests__/**",
        "src/**/*.spec.ts",
        "src/**/live/**",
      ],
    },
  },
});
