import { describe, expect, it } from "vitest";

import { CliError } from "../../errors/cli-error";
import { requireYes } from "../confirmation";

describe("requireYes", () => {
  it("does not throw when --yes is provided", () => {
    expect(() => requireYes({ yes: true }, "Delete")).not.toThrow();
  });

  it("throws the standardized CLI error when --yes is missing", () => {
    let error: unknown;

    try {
      requireYes({}, "Destroy");
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(CliError);
    expect(error).toMatchObject({
      message: "Destroy requires --yes.",
      code: "INVALID_ARGUMENTS",
      suggestion: "Re-run with --yes to confirm destroy.",
    });
  });
});
