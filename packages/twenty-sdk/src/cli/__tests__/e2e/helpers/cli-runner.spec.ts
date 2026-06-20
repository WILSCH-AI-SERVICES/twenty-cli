import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

const runNodeScriptMock = vi.fn();
const runNodeScriptAsyncMock = vi.fn();

vi.mock("./process-runner", () => ({
  runNodeScript: runNodeScriptMock,
  runNodeScriptAsync: runNodeScriptAsyncMock,
}));

describe("cli runner", () => {
  beforeEach(() => {
    runNodeScriptMock.mockReset();
    runNodeScriptAsyncMock.mockReset();
    delete process.env.TWENTY_API_TOKEN;
    delete process.env.TWENTY_BASE_URL;
    delete process.env.UNRELATED_ENV;
  });

  it("resolves the built CLI artifact path", async () => {
    const { resolveBuiltCliPath } = await import("./cli-runner");

    expect(resolveBuiltCliPath()).toBe(path.resolve(__dirname, "../../../../../dist/cli/cli.js"));
  });

  it("runs the built CLI synchronously through the process helper", async () => {
    runNodeScriptMock.mockReturnValue({
      exitCode: 0,
      stdout: '{"ok":true}',
      stderr: "",
    });

    const { runBuiltCli } = await import("./cli-runner");
    const result = runBuiltCli(["api", "list", "people", "--output", "json"], {
      cwd: "/tmp/twenty-cli",
      env: {
        CUSTOM_ENV: "present",
      },
    });

    expect(result).toEqual({
      exitCode: 0,
      stdout: '{"ok":true}',
      stderr: "",
    });
    expect(runNodeScriptMock).toHaveBeenCalledWith(
      path.resolve(__dirname, "../../../../../dist/cli/cli.js"),
      ["api", "list", "people", "--output", "json"],
      expect.objectContaining({
        cwd: "/tmp/twenty-cli",
        env: expect.objectContaining({
          CUSTOM_ENV: "present",
        }),
      }),
    );
  });

  it("runs the built CLI asynchronously through the process helper", async () => {
    runNodeScriptAsyncMock.mockResolvedValue({
      exitCode: 0,
      stdout: "hello world",
      stderr: "warn",
    });

    const { runBuiltCliAsync } = await import("./cli-runner");
    const result = await runBuiltCliAsync(["auth", "discover", "https://acme.twenty.com"], {
      timeoutMs: 250,
    });

    expect(result).toEqual({
      exitCode: 0,
      stdout: "hello world",
      stderr: "warn",
    });
    expect(runNodeScriptAsyncMock).toHaveBeenCalledWith(
      path.resolve(__dirname, "../../../../../dist/cli/cli.js"),
      ["auth", "discover", "https://acme.twenty.com"],
      expect.objectContaining({
        timeoutMs: 250,
      }),
    );
  });

  it("filters inherited TWENTY_* env vars unless explicitly retained", async () => {
    process.env.UNRELATED_ENV = "keep-me";
    process.env.TWENTY_API_TOKEN = "drop-me";
    process.env.TWENTY_BASE_URL = "https://example.com/drop";
    runNodeScriptMock.mockReturnValue({
      exitCode: 0,
      stdout: "",
      stderr: "",
    });

    const { runBuiltCli } = await import("./cli-runner");

    runBuiltCli(["auth", "status"], {
      env: {
        TWENTY_PROFILE: "from-options",
      },
    });

    expect(runNodeScriptMock.mock.calls[0]?.[2]).toEqual(
      expect.objectContaining({
        env: expect.objectContaining({
          UNRELATED_ENV: "keep-me",
          TWENTY_PROFILE: "from-options",
        }),
      }),
    );
    expect(runNodeScriptMock.mock.calls[0]?.[2]?.env).not.toHaveProperty("TWENTY_API_TOKEN");
    expect(runNodeScriptMock.mock.calls[0]?.[2]?.env).not.toHaveProperty("TWENTY_BASE_URL");

    runBuiltCli(["auth", "status"], {
      retainInheritedTwentyEnv: true,
    });

    expect(runNodeScriptMock.mock.calls[1]?.[2]).toEqual(
      expect.objectContaining({
        env: expect.objectContaining({
          TWENTY_API_TOKEN: "drop-me",
          TWENTY_BASE_URL: "https://example.com/drop",
          UNRELATED_ENV: "keep-me",
        }),
      }),
    );
  });
});
