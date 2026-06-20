import { describe, expect, it } from "vitest";

import { BENCHMARK_OPERATIONS } from "../db-benchmark-operations";

describe("DB benchmark operations", () => {
  it("uses strict read-source flags for every operation", () => {
    for (const operation of BENCHMARK_OPERATIONS) {
      const args = operation.buildArgs("db", {
        object: "people",
        objectCommand: "people",
        recordId: "record-id",
        groupByField: "city",
        query: "acme",
      });

      expect(args).toContain("--rs");
      expect(args).toContain("db");
      expect(args).toContain("--output");
      expect(args).toContain("json");
    }
  });

  it("covers the expected operation keys", () => {
    expect(BENCHMARK_OPERATIONS.map((operation) => operation.key)).toEqual([
      "search",
      "api-list",
      "api-list-all",
      "api-get",
      "api-export-json",
      "api-group-by",
      "records-list",
      "records-get",
      "records-group-by",
    ]);
  });
});
