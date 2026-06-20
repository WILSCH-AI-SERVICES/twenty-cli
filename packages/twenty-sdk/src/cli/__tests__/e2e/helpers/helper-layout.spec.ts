import fs from "node:fs";

import { describe, expect, it } from "vitest";

describe("helper layout", () => {
  it("keeps only the authoritative implementation helpers", () => {
    const helperFiles = fs
      .readdirSync(__dirname)
      .filter((file) => file.endsWith(".ts") && !file.endsWith(".spec.ts"))
      .sort();

    expect(helperFiles).toEqual([
      "cli-runner.ts",
      "live-config.ts",
      "mock-server.ts",
      "process-runner.ts",
      "temp-home.ts",
    ]);
  });
});
