import { describe, expect, it } from "vitest";
import { buildProgram } from "../../../program";
import { auditAliasCoverage } from "../alias-coverage";

describe("alias coverage", () => {
  it("reports complete alias coverage for the built CLI", () => {
    expect(auditAliasCoverage(buildProgram())).toMatchObject({
      ok: true,
      missingCommandAliases: [],
      missingOptionAliases: [],
      optionAliasCollisions: [],
    });
  });
});
