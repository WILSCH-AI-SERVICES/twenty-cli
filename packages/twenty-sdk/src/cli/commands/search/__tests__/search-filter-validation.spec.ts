import { describe, expect, it } from "vitest";

import { validateSearchFilter } from "../search.command";

describe("validateSearchFilter", () => {
  it("accepts supported scalar fields with supported operators", () => {
    expect(() =>
      validateSearchFilter({ id: { eq: "abc" }, createdAt: { gte: "2020" } }),
    ).not.toThrow();
  });

  it("accepts and/or arrays and not objects recursively", () => {
    expect(() =>
      validateSearchFilter({
        and: [{ id: { eq: "a" } }],
        or: [{ updatedAt: { lt: "x" } }],
        not: { id: { neq: "z" } },
      }),
    ).not.toThrow();
  });

  it("rejects an unsupported field", () => {
    expect(() => validateSearchFilter({ name: { eq: "x" } })).toThrowError(/is not supported/);
  });

  it("rejects an unsupported operator", () => {
    expect(() => validateSearchFilter({ id: { like: "x" } })).toThrowError(
      /operator .* is not supported/,
    );
  });

  it("rejects a non-object operator bag", () => {
    expect(() => validateSearchFilter({ id: "x" })).toThrowError(/must be an object of operators/);
  });

  it("rejects a non-array and/or", () => {
    expect(() => validateSearchFilter({ and: { id: { eq: "x" } } })).toThrowError(
      /must be an array/,
    );
  });
});
