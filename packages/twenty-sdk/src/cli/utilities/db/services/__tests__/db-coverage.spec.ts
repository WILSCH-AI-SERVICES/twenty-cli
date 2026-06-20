import { describe, expect, it } from "vitest";

import { buildDbCoverage } from "../db-coverage";

describe("buildDbCoverage", () => {
  const commands = [
    "api list",
    "api get",
    "search",
    "api create",
    "api raw",
    "auth status",
    "db doctor",
  ];

  it("classifies reads vs mutations vs escape hatches", () => {
    const { items } = buildDbCoverage(commands);
    const byCmd = Object.fromEntries(items.map((item) => [item.command, item]));

    expect(byCmd["api list"]?.status).toBe("db_backed_read");
    expect(byCmd.search?.status).toBe("db_backed_read");
    expect(byCmd["api create"]?.status).toBe("api_only_mutation");
    expect(byCmd["api raw"]?.status).toBe("raw_api_escape_hatch");
    expect(byCmd["auth status"]?.status).toBe("local_only");
  });

  it("summarizes totals by status and priority", () => {
    const { meta } = buildDbCoverage(commands);

    expect(meta.total).toBe(commands.length);
    expect(meta.statuses.db_backed_read).toBeGreaterThanOrEqual(2);
    expect(typeof meta.priorities.P0).toBe("number");
  });
});
