import { describe, it, expect, vi } from "vitest";

import { CliError } from "../../../../utilities/errors/cli-error";
import { runFindDuplicatesOperation } from "../find-duplicates.operation";

describe("runFindDuplicatesOperation", () => {
  it("throws helpful error when no payload provided", async () => {
    const ctx = {
      object: "people",
      options: {},
      globalOptions: { output: "json" },
      services: {
        records: { findDuplicates: vi.fn() },
        output: { render: vi.fn() },
      },
    };

    await expect(runFindDuplicatesOperation(ctx as any)).rejects.toThrow(CliError);

    // Verify the error has a helpful suggestion with example
    try {
      await runFindDuplicatesOperation(ctx as any);
    } catch (err) {
      expect(err).toBeInstanceOf(CliError);
      const cliErr = err as CliError;
      expect(cliErr.code).toBe("INVALID_ARGUMENTS");
      expect(cliErr.suggestion).toMatch(/--ids/);
      expect(cliErr.suggestion).toMatch(/"ids"/);
    }
  });

  it("parses comma-separated ids correctly", async () => {
    const mockResponse = { data: { duplicates: [] } };
    const ctx = {
      object: "people",
      options: { ids: "person_1, person_2, person_3" },
      globalOptions: { output: "json" },
      services: {
        records: {
          findDuplicates: vi.fn().mockResolvedValue(mockResponse),
        },
        output: { render: vi.fn() },
      },
    };

    await runFindDuplicatesOperation(ctx as any);

    expect(ctx.services.records.findDuplicates).toHaveBeenCalledWith("people", {
      ids: ["person_1", "person_2", "person_3"],
    });
  });

  it("passes through upstream data payloads", async () => {
    const mockResponse = { data: { duplicates: [] } };
    const ctx = {
      object: "people",
      options: { data: '{"data":[{"name":{"firstName":"John","lastName":"Doe"}}]}' },
      globalOptions: { output: "json" },
      services: {
        records: {
          findDuplicates: vi.fn().mockResolvedValue(mockResponse),
        },
        output: { render: vi.fn() },
      },
    };

    await runFindDuplicatesOperation(ctx as any);

    expect(ctx.services.records.findDuplicates).toHaveBeenCalledWith("people", {
      data: [
        {
          name: {
            firstName: "John",
            lastName: "Doe",
          },
        },
      ],
    });
  });
});
