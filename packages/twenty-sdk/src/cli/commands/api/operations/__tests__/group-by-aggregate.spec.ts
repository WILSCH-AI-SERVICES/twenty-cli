import { describe, expect, it } from "vitest";

import { normalizeGroupByAggregate } from "../group-by.operation";

describe("normalizeGroupByAggregate", () => {
  it("rewrites totalCount to countNotEmptyId in param aggregates", () => {
    const out = normalizeGroupByAggregate(undefined, { aggregate: ["totalCount"] });
    expect(JSON.parse(out.params.aggregate[0])).toEqual(["countNotEmptyId"]);
  });

  it("is idempotent for already-normalized aliases", () => {
    const out = normalizeGroupByAggregate(undefined, { aggregate: ["countNotEmptyId"] });
    expect(JSON.parse(out.params.aggregate[0])).toEqual(["countNotEmptyId"]);
  });

  it("moves a payload.aggregate into params and normalizes it", () => {
    const out = normalizeGroupByAggregate(
      { groupBy: [{ stage: true }], aggregate: ["totalCount"] },
      {},
    );
    expect((out.payload as Record<string, unknown>).aggregate).toBeUndefined();
    expect(JSON.parse(out.params.aggregate[0])).toEqual(["countNotEmptyId"]);
  });

  it("parses a JSON-array aggregate string", () => {
    const out = normalizeGroupByAggregate(undefined, { aggregate: ['["totalCount","sumAmount"]'] });
    expect(JSON.parse(out.params.aggregate[0])).toEqual(["countNotEmptyId", "sumAmount"]);
  });

  it("throws on an empty aggregate string", () => {
    expect(() => normalizeGroupByAggregate(undefined, { aggregate: [" "] })).toThrowError(
      /non-empty/,
    );
  });
});
