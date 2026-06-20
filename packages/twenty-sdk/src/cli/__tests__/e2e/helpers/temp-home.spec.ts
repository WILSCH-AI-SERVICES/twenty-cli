import fs from "node:fs";

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { BuiltCliRunOptions, BuiltCliRunResult } from "./cli-runner";

const runBuiltCliMock = vi.fn();
const runBuiltCliAsyncMock = vi.fn();

vi.mock("./cli-runner", () => ({
  runBuiltCli: runBuiltCliMock,
  runBuiltCliAsync: runBuiltCliAsyncMock,
}));

describe("temp home helper", () => {
  beforeEach(() => {
    vi.resetModules();
    runBuiltCliMock.mockReset();
    runBuiltCliAsyncMock.mockReset();
  });

  it("exports only the authoritative temp-home helpers", async () => {
    const tempHomeModule = await import("./temp-home");

    expect(Object.keys(tempHomeModule).sort()).toEqual([
      "runBuiltCliWithTempHome",
      "runBuiltCliWithTempHomeAsync",
    ]);
  });

  it("delegates sync runs to the built CLI runner with a temp home", async () => {
    let homeDir: string | undefined;
    runBuiltCliMock.mockImplementation(
      (_args: string[], options: BuiltCliRunOptions = {}): BuiltCliRunResult => {
        homeDir = options.cwd;

        expect(homeDir).toBeDefined();
        expect(fs.existsSync(homeDir as string)).toBe(true);
        expect(options.env).toEqual(
          expect.objectContaining({
            CUSTOM_ENV: "present",
            HOME: homeDir,
            USERPROFILE: homeDir,
          }),
        );

        return {
          exitCode: 0,
          stdout: "sync stdout",
          stderr: "",
        };
      },
    );

    const { runBuiltCliWithTempHome } = await import("./temp-home");
    const result = runBuiltCliWithTempHome(["auth", "status"], {
      env: {
        CUSTOM_ENV: "present",
      },
    });

    expect(result).toEqual({
      exitCode: 0,
      stdout: "sync stdout",
      stderr: "",
    });
    expect(runBuiltCliMock).toHaveBeenCalledWith(["auth", "status"], expect.any(Object));
    expect(fs.existsSync(homeDir as string)).toBe(false);
  });

  it("delegates async runs to the built CLI runner with a temp home", async () => {
    let homeDir: string | undefined;
    runBuiltCliAsyncMock.mockImplementation(
      async (_args: string[], options: BuiltCliRunOptions = {}): Promise<BuiltCliRunResult> => {
        homeDir = options.cwd;

        expect(homeDir).toBeDefined();
        expect(fs.existsSync(homeDir as string)).toBe(true);
        expect(options.env).toEqual(
          expect.objectContaining({
            CUSTOM_ENV: "present",
            HOME: homeDir,
            USERPROFILE: homeDir,
          }),
        );

        return {
          exitCode: 0,
          stdout: "async stdout",
          stderr: "",
        };
      },
    );

    const { runBuiltCliWithTempHomeAsync } = await import("./temp-home");
    const result = await runBuiltCliWithTempHomeAsync(["auth", "status"], {
      env: {
        CUSTOM_ENV: "present",
      },
    });

    expect(result).toEqual({
      exitCode: 0,
      stdout: "async stdout",
      stderr: "",
    });
    expect(runBuiltCliAsyncMock).toHaveBeenCalledWith(["auth", "status"], expect.any(Object));
    expect(fs.existsSync(homeDir as string)).toBe(false);
  });

  it("removes the temp home when the async runner rejects", async () => {
    const expectedError = new Error("runner failed");
    let homeDir: string | undefined;
    runBuiltCliAsyncMock.mockImplementation(
      async (_args: string[], options: BuiltCliRunOptions = {}) => {
        homeDir = options.cwd;

        expect(homeDir).toBeDefined();
        expect(fs.existsSync(homeDir as string)).toBe(true);

        throw expectedError;
      },
    );

    const { runBuiltCliWithTempHomeAsync } = await import("./temp-home");

    await expect(runBuiltCliWithTempHomeAsync(["auth", "status"])).rejects.toThrow(expectedError);
    expect(fs.existsSync(homeDir as string)).toBe(false);
  });
});
