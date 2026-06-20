import { describe, expect, it } from "vitest";

import { CliError } from "../../errors/cli-error";
import {
  assertGraphqlSuccess,
  formatGraphqlErrors,
  getGraphqlField,
  requireGraphqlField,
  hasGraphqlField,
  hasSchemaErrorSymbol,
} from "../graphql-response";

describe("graphql response helpers", () => {
  it("formats graphql errors into a newline-joined message", () => {
    expect(
      formatGraphqlErrors({
        errors: [{ message: "First error" }, { message: "Second error" }],
      }),
    ).toBe("First error\nSecond error");
  });

  it("throws on graphql errors before checking data", () => {
    expect(() =>
      assertGraphqlSuccess(
        {
          errors: [{ message: "Forbidden" }],
        },
        "Fallback",
      ),
    ).toThrowError(new CliError("Forbidden", "API_ERROR"));
  });

  it("throws on missing data when no graphql errors exist", () => {
    expect(() => assertGraphqlSuccess({}, "Missing data")).toThrowError(
      new CliError("Missing data", "API_ERROR"),
    );
  });

  it("detects field presence on graphql payloads", () => {
    expect(
      hasGraphqlField(
        {
          data: {
            currentWorkspace: { id: "ws_123" },
          },
        },
        "currentWorkspace",
      ),
    ).toBe(true);
  });

  it("returns a named field from graphql data", () => {
    expect(
      getGraphqlField(
        {
          data: {
            currentWorkspace: { id: "ws_123" },
          },
        },
        "currentWorkspace",
      ),
    ).toEqual({ id: "ws_123" });
  });

  it("throws when a required graphql field is missing", () => {
    expect(() =>
      requireGraphqlField(
        {
          data: {},
        },
        "currentWorkspace",
        "Failed to load workspace.",
      ),
    ).toThrowError(new CliError("Failed to load workspace.", "API_ERROR"));
  });

  it("detects schema-symbol compatibility errors", () => {
    expect(
      hasSchemaErrorSymbol(
        {
          errors: [{ message: 'Unknown argument "packageJson" on field "syncApplication".' }],
        },
        ["packageJson", "yarnLock"],
      ),
    ).toBe(true);
  });
});
