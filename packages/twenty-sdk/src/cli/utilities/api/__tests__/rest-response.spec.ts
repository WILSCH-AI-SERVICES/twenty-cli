import { describe, expect, it } from "vitest";

import {
  extractCollection,
  extractDeleteResult,
  extractFirstValue,
  extractResource,
  getDataSection,
} from "../rest-response";

describe("REST response helpers", () => {
  it("returns object data sections and falls back to an empty object", () => {
    expect(getDataSection({ data: { people: [{ id: "1" }] } })).toEqual({
      people: [{ id: "1" }],
    });
    expect(getDataSection({ data: null })).toEqual({});
    expect(getDataSection({ data: ["not", "object"] })).toEqual({});
  });

  it("extracts the first object value", () => {
    expect(extractFirstValue({ person: { id: "1" } })).toEqual({ id: "1" });
    expect(extractFirstValue({})).toBeUndefined();
  });

  it("extracts collections from direct, nested, and fallback shapes", () => {
    expect(extractCollection([{ id: "direct" }], "people")).toEqual([{ id: "direct" }]);
    expect(extractCollection({ data: { people: [{ id: "nested" }] } }, "people")).toEqual([
      { id: "nested" },
    ]);
    expect(extractCollection({ data: { items: [{ id: "fallback" }] } }, "people")).toEqual([
      { id: "fallback" },
    ]);
    expect(extractCollection({ people: [{ id: "top" }] }, "people")).toEqual([{ id: "top" }]);
    expect(extractCollection({ data: [{ id: "data" }] }, "people")).toEqual([{ id: "data" }]);
    expect(extractCollection({}, "people")).toEqual([]);
  });

  it("extracts resources from nested, top-level, data object, and empty shapes", () => {
    expect(extractResource({ data: { person: { id: "nested" } } }, "person")).toEqual({
      id: "nested",
    });
    expect(extractResource({ person: { id: "top" } }, "person")).toEqual({ id: "top" });
    expect(extractResource({ data: { id: "data" } }, "person")).toEqual({ id: "data" });
    expect(extractResource(undefined, "person")).toEqual({});
  });

  it("extracts delete results from supported shapes", () => {
    expect(extractDeleteResult(true)).toBe(true);
    expect(extractDeleteResult({ success: true })).toBe(true);
    expect(extractDeleteResult({ data: { success: true } })).toBe(true);
    expect(extractDeleteResult({ data: true })).toBe(true);
    expect(extractDeleteResult({})).toBe(false);
  });
});
