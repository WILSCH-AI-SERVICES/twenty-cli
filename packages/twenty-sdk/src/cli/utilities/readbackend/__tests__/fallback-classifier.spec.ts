import { describe, expect, it } from "vitest";

import { shouldFallbackToApi } from "../fallback-classifier";
import { DbConnectionError, UnsupportedDbReadError } from "../types";

const codeErr = (code: string) =>
  new DbConnectionError("x", { cause: Object.assign(new Error(), { code }) });

describe("shouldFallbackToApi", () => {
  it("falls back on UnsupportedDbReadError (capability gap)", () => {
    expect(shouldFallbackToApi(new UnsupportedDbReadError("no include"))).toBe(true);
  });

  it.each([
    "08006",
    "08001",
    "28000",
    "28P01",
    "57014",
    "57P01",
    "53300",
    "42703",
    "42P01",
    "42883",
    "42501",
  ])("falls back on recoverable SQLSTATE %s", (code) =>
    expect(shouldFallbackToApi(codeErr(code))).toBe(true),
  );

  it("falls back on a scan-shape message", () => {
    expect(shouldFallbackToApi(new Error("cannot scan into dest[2]"))).toBe(true);
  });

  it.each(["23505", "22P02", "42601"])("does NOT fall back on fatal SQLSTATE %s", (code) =>
    expect(shouldFallbackToApi(codeErr(code))).toBe(false),
  );

  it("does not fall back on an unrelated error", () => {
    expect(shouldFallbackToApi(new Error("kaboom"))).toBe(false);
  });
});
