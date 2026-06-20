import { AxiosError } from "axios";
import { describe, it, expect } from "vitest";

import { CliError } from "../cli-error";
import { toExitCode, formatError, formatAgentError } from "../error-handler";

describe("error-handler", () => {
  describe("toExitCode", () => {
    describe("CliError codes", () => {
      it("returns 2 for INVALID_ARGUMENTS", () => {
        const error = new CliError("Invalid args", "INVALID_ARGUMENTS");
        expect(toExitCode(error)).toBe(2);
      });

      it("returns 3 for AUTH", () => {
        const error = new CliError("Auth failed", "AUTH");
        expect(toExitCode(error)).toBe(3);
      });

      it("returns 4 for NETWORK", () => {
        const error = new CliError("Network error", "NETWORK");
        expect(toExitCode(error)).toBe(4);
      });

      it("returns 5 for RATE_LIMIT", () => {
        const error = new CliError("Rate limited", "RATE_LIMIT");
        expect(toExitCode(error)).toBe(5);
      });

      it("returns 1 for unknown CliError code", () => {
        const error = new CliError("Unknown error", "UNKNOWN_CODE");
        expect(toExitCode(error)).toBe(1);
      });
    });

    describe("Commander errors", () => {
      it("returns 0 for commander.help", () => {
        const error = { message: "help", code: "commander.help", exitCode: 0 };
        expect(toExitCode(error)).toBe(0);
      });

      it("returns 0 for commander.helpDisplayed", () => {
        const error = { message: "help", code: "commander.helpDisplayed", exitCode: 0 };
        expect(toExitCode(error)).toBe(0);
      });

      it("returns 0 for commander.version", () => {
        const error = { message: "version", code: "commander.version", exitCode: 0 };
        expect(toExitCode(error)).toBe(0);
      });

      it("returns exitCode from commander error when present", () => {
        const error = { message: "error", code: "commander.error", exitCode: 42 };
        expect(toExitCode(error)).toBe(42);
      });

      it("returns 2 for commander error without exitCode", () => {
        const error = { message: "error", code: "commander.missingArgument" };
        expect(toExitCode(error)).toBe(2);
      });
    });

    describe("AxiosError codes", () => {
      it("returns 3 for 401 status", () => {
        const error = {
          isAxiosError: true,
          response: { status: 401 },
          message: "Unauthorized",
        } as AxiosError;
        expect(toExitCode(error)).toBe(3);
      });

      it("returns 3 for 403 status", () => {
        const error = {
          isAxiosError: true,
          response: { status: 403 },
          message: "Forbidden",
        } as AxiosError;
        expect(toExitCode(error)).toBe(3);
      });

      it("returns 5 for 429 status", () => {
        const error = {
          isAxiosError: true,
          response: { status: 429 },
          message: "Too Many Requests",
        } as AxiosError;
        expect(toExitCode(error)).toBe(5);
      });

      it("returns 4 for network error (no response)", () => {
        const error = {
          isAxiosError: true,
          response: undefined,
          message: "Network Error",
        } as AxiosError;
        expect(toExitCode(error)).toBe(4);
      });

      it("returns 1 for other status codes", () => {
        const error = {
          isAxiosError: true,
          response: { status: 500 },
          message: "Internal Server Error",
        } as AxiosError;
        expect(toExitCode(error)).toBe(1);
      });
    });

    describe("generic errors", () => {
      it("returns 1 for generic Error", () => {
        const error = new Error("Something went wrong");
        expect(toExitCode(error)).toBe(1);
      });

      it("returns 1 for unknown error type", () => {
        expect(toExitCode("string error")).toBe(1);
        expect(toExitCode(null)).toBe(1);
        expect(toExitCode(undefined)).toBe(1);
        expect(toExitCode(123)).toBe(1);
      });
    });
  });

  describe("formatError", () => {
    describe("CliError formatting", () => {
      it("returns message for CliError", () => {
        const error = new CliError("Something failed", "GENERIC");
        expect(formatError(error)).toEqual(["Something failed"]);
      });

      it("includes suggestion when present", () => {
        const error = new CliError("Auth failed", "AUTH", 'Run "twenty auth login"');
        expect(formatError(error)).toEqual(["Auth failed", 'Suggestion: Run "twenty auth login"']);
      });
    });

    describe("Commander error formatting", () => {
      it("returns empty array for commander.help", () => {
        const error = { message: "help output", code: "commander.help" };
        expect(formatError(error)).toEqual([]);
      });

      it("returns empty array for commander.helpDisplayed", () => {
        const error = { message: "help output", code: "commander.helpDisplayed" };
        expect(formatError(error)).toEqual([]);
      });

      it("returns empty array for commander.version", () => {
        const error = { message: "version output", code: "commander.version" };
        expect(formatError(error)).toEqual([]);
      });

      it("returns message for other commander errors", () => {
        const error = { message: "Missing argument", code: "commander.missingArgument" };
        expect(formatError(error)).toEqual(["Missing argument"]);
      });
    });

    describe("AxiosError formatting", () => {
      it("formats error with status and string response data", () => {
        const error = {
          isAxiosError: true,
          response: { status: 400, data: "Bad Request" },
          message: "Request failed",
        } as AxiosError;
        expect(formatError(error)).toEqual(["Request failed with status 400.", "Bad Request"]);
      });

      it("formats error with status and object response data", () => {
        const error = {
          isAxiosError: true,
          response: { status: 422, data: { error: "Validation failed" } },
          message: "Request failed",
        } as AxiosError;
        const result = formatError(error);
        expect(result[0]).toBe("Request failed with status 422.");
        expect(JSON.parse(result[1])).toEqual({ error: "Validation failed" });
      });

      it("formats error with status and no response data", () => {
        const error = {
          isAxiosError: true,
          response: { status: 500, data: null },
          message: "Request failed",
        } as AxiosError;
        expect(formatError(error)).toEqual(["Request failed with status 500.", "{}"]);
      });

      it("formats network error (no response)", () => {
        const error = {
          isAxiosError: true,
          response: undefined,
          message: "Network Error",
        } as AxiosError;
        expect(formatError(error)).toEqual(["Network error: Network Error"]);
      });
    });

    describe("generic Error formatting", () => {
      it("returns message for generic Error", () => {
        const error = new Error("Something went wrong");
        expect(formatError(error)).toEqual(["Something went wrong"]);
      });
    });

    describe("unknown error formatting", () => {
      it('returns "Unknown error" for non-Error objects', () => {
        expect(formatError("string error")).toEqual(["Unknown error"]);
        expect(formatError(null)).toEqual(["Unknown error"]);
        expect(formatError(undefined)).toEqual(["Unknown error"]);
        expect(formatError(123)).toEqual(["Unknown error"]);
      });
    });
  });

  describe("formatAgentError", () => {
    it("formats CliError as agent json", () => {
      const error = new CliError(
        "Missing database URL.",
        "INVALID_ARGUMENTS",
        "Set TWENTY_DATABASE_URL.",
      );

      expect(formatAgentError(error)).toEqual({
        ok: false,
        error: {
          message: "Missing database URL.",
          code: "INVALID_ARGUMENTS",
          exit_code: 2,
          retryable: false,
          suggestion: "Set TWENTY_DATABASE_URL.",
        },
      });
    });

    it("marks network and rate-limit errors retryable", () => {
      expect(formatAgentError(new CliError("Slow down.", "RATE_LIMIT")).error.retryable).toBe(true);
      expect(formatAgentError(new CliError("Network failed.", "NETWORK")).error.retryable).toBe(
        true,
      );
    });
  });
});
