import fs from "node:fs";

import { describe, it, expect, vi } from "vitest";

import {
  assertSuccessfulBuiltCliRun,
  resolveBuiltCliPath,
  runBuiltCli,
  type BuiltCliRunOptions,
  type BuiltCliRunResult,
} from "./helpers/cli-runner";
import { resolveLiveSmokeConfig } from "./helpers/live-config";

const config = resolveLiveSmokeConfig({ required: false });
const cliPath = resolveBuiltCliPath();
const canRun = !!config && fs.existsSync(cliPath);

const describeIf = canRun ? describe : describe.skip;

describeIf("twenty api e2e", () => {
  it("lists people as json", () => {
    const env = {
      ...(config?.token ? { TWENTY_API_TOKEN: config.token } : {}),
      ...(config?.baseUrl ? { TWENTY_BASE_URL: config.baseUrl } : {}),
      ...(config?.profile ? { TWENTY_PROFILE: config.profile } : {}),
    };

    const output = runBuiltCli(["api", "list", "people", "--limit", "1", "--output", "json"], {
      env,
      throwOnNonZeroExit: true,
    }).stdout;

    const parsed = JSON.parse(output);
    expect(Array.isArray(parsed)).toBe(true);
  });
});

const describeMutations = process.env.TWENTY_E2E_MUTATION === "true" ? describe : describe.skip;

describeMutations("twenty api e2e mutations", () => {
  it("creates and deletes a person", () => {
    if (!config) {
      throw new Error("Missing config");
    }
    runCreateAndDeletePerson({ config, runCommand: runBuiltCli });
  });
});

describe("api mutation cleanup helper", () => {
  it("deletes created records even when later work fails", () => {
    const calls: Array<{ args: string[]; options: BuiltCliRunOptions | undefined }> = [];
    const runCommand = vi.fn((args: string[], options?: BuiltCliRunOptions) => {
      calls.push({ args, options });
      if (args[1] === "create") {
        return {
          exitCode: 0,
          stdout: JSON.stringify({ id: "person-123" }),
          stderr: "",
        };
      }

      return {
        exitCode: 0,
        stdout: "",
        stderr: "",
      };
    });

    expect(() =>
      runCreateAndDeletePerson({
        config: {
          token: "env-token",
          baseUrl: "https://api.example.com",
          profile: "smoke",
        },
        runCommand,
        afterCreate: () => {
          throw new Error("later failure");
        },
      }),
    ).toThrow("later failure");

    expect(calls.map(({ args }) => args[1])).toEqual(["create", "delete"]);
    expect(runCommand).toHaveBeenCalledWith(
      ["api", "delete", "people", "person-123", "--yes"],
      expect.objectContaining({
        env: expect.objectContaining({
          TWENTY_API_TOKEN: "env-token",
          TWENTY_BASE_URL: "https://api.example.com",
          TWENTY_PROFILE: "smoke",
        }),
      }),
    );
  });

  it("fails fast with CLI diagnostics when create exits nonzero", () => {
    const runCommand = vi.fn(() => ({
      exitCode: 3,
      stdout: "partial output",
      stderr: "Missing API token.",
    }));

    expect(() =>
      runCreateAndDeletePerson({
        config: {
          token: "env-token",
          baseUrl: "https://api.example.com",
          profile: "smoke",
        },
        runCommand,
      }),
    ).toThrow(/Built CLI exited with code 3[\s\S]*Missing API token\.[\s\S]*partial output/);

    expect(runCommand).toHaveBeenCalledTimes(1);
  });

  it("surfaces delete cleanup failures with the created record id", () => {
    const runCommand = vi
      .fn()
      .mockReturnValueOnce({
        exitCode: 0,
        stdout: JSON.stringify({ id: "person-123" }),
        stderr: "",
      })
      .mockReturnValueOnce({
        exitCode: 1,
        stdout: "",
        stderr: "delete failed",
      });

    expect(() =>
      runCreateAndDeletePerson({
        config: {
          token: "env-token",
          baseUrl: "https://api.example.com",
          profile: "smoke",
        },
        runCommand,
      }),
    ).toThrow(/Failed to clean up created person person-123[\s\S]*Built CLI exited with code 1/);
  });

  it("preserves the main failure while attaching cleanup failure context", () => {
    const runCommand = vi
      .fn()
      .mockReturnValueOnce({
        exitCode: 0,
        stdout: JSON.stringify({ id: "person-123" }),
        stderr: "",
      })
      .mockReturnValueOnce({
        exitCode: 1,
        stdout: "",
        stderr: "delete failed",
      });

    expect(() =>
      runCreateAndDeletePerson({
        config: {
          token: "env-token",
          baseUrl: "https://api.example.com",
          profile: "smoke",
        },
        runCommand,
        afterCreate: () => {
          throw new Error("later failure");
        },
      }),
    ).toThrow(
      /later failure[\s\S]*cleanup also failed[\s\S]*person-123[\s\S]*Built CLI exited with code 1/,
    );
  });
});

interface RunCreateAndDeletePersonOptions {
  config: NonNullable<typeof config>;
  runCommand: (args: string[], options: BuiltCliRunOptions) => BuiltCliRunResult;
  afterCreate?: () => void;
}

function runCreateAndDeletePerson({
  config: liveConfig,
  runCommand,
  afterCreate,
}: RunCreateAndDeletePersonOptions): void {
  const env = {
    ...(liveConfig.token ? { TWENTY_API_TOKEN: liveConfig.token } : {}),
    ...(liveConfig.baseUrl ? { TWENTY_BASE_URL: liveConfig.baseUrl } : {}),
    ...(liveConfig.profile ? { TWENTY_PROFILE: liveConfig.profile } : {}),
  };

  const createPayload = JSON.stringify({ name: { firstName: "E2E", lastName: "Test" } });
  let createdId: string | undefined;
  let primaryError: unknown;
  let cleanupError: Error | undefined;

  try {
    const createArgs = ["api", "create", "people", "--data", createPayload, "--output", "json"];
    const createdRaw = assertSuccessfulBuiltCliRun(
      createArgs,
      runCommand(createArgs, {
        env,
      }),
    ).stdout;
    const created = JSON.parse(createdRaw);
    createdId = created.id;
    expect(created.id).toBeTruthy();
    afterCreate?.();
  } catch (error) {
    primaryError = error;
  } finally {
    if (createdId) {
      const deleteArgs = ["api", "delete", "people", createdId, "--yes"];

      try {
        assertSuccessfulBuiltCliRun(
          deleteArgs,
          runCommand(deleteArgs, {
            env,
          }),
        );
      } catch (error) {
        cleanupError = new Error(
          `Failed to clean up created person ${createdId}: ${getErrorMessage(error)}`,
          {
            cause: error,
          },
        );
      }
    }
  }

  if (primaryError) {
    if (cleanupError) {
      throw new Error(
        `${getErrorMessage(primaryError)}\ncleanup also failed: ${cleanupError.message}`,
        {
          cause: primaryError,
        },
      );
    }

    throw primaryError;
  }

  if (cleanupError) {
    throw cleanupError;
  }
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
