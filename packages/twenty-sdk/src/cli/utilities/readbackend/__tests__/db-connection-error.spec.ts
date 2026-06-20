import { describe, expect, it } from "vitest";

import { DbConnectionError } from "../types";

describe("DbConnectionError", () => {
  it("exposes the underlying pg SQLSTATE as .code", () => {
    const pgErr = Object.assign(new Error('column "x" does not exist'), { code: "42703" });
    const wrapped = new DbConnectionError("db read failed", { cause: pgErr });

    expect(wrapped.code).toBe("42703");
  });

  it("leaves .code undefined when the cause has none", () => {
    const wrapped = new DbConnectionError("db read failed", { cause: new Error("boom") });

    expect(wrapped.code).toBeUndefined();
  });
});
