import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { main } from "../cli";
import { maybeHandleInlineHelp } from "../help";
import { buildProgram } from "../program";
import { loadCliEnvironment } from "../utilities/config/services/environment.service";
import { getLastSourceTracker, resetLastSourceTracker } from "../utilities/shared/services";

vi.mock("../utilities/config/services/environment.service", () => ({
  loadCliEnvironment: vi.fn(),
}));

vi.mock("../program", () => ({
  buildProgram: vi.fn(),
}));

vi.mock("../help", () => ({
  maybeHandleInlineHelp: vi.fn(),
}));

vi.mock("../utilities/shared/services", () => ({
  getLastSourceTracker: vi.fn(),
  resetLastSourceTracker: vi.fn(),
}));

describe("CLI entrypoint", () => {
  let events: string[];
  let program: Command;

  beforeEach(() => {
    events = [];
    program = new Command();
    program.parseAsync = vi.fn(async () => {
      events.push("parse");
      return program;
    });

    vi.mocked(loadCliEnvironment).mockImplementation(() => {
      events.push("load-env");
      return { loadedFiles: [] };
    });
    vi.mocked(buildProgram).mockImplementation(() => {
      events.push("build-program");
      return program;
    });
    vi.mocked(maybeHandleInlineHelp).mockResolvedValue(false);
    vi.mocked(getLastSourceTracker).mockReturnValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
    process.exitCode = undefined;
  });

  it("loads environment files before building dynamic commands", async () => {
    const argv = ["node", "twenty", "--env-file", ".env.production", "records"];

    await main(argv);

    expect(events).toEqual(["load-env", "build-program", "parse"]);
    expect(loadCliEnvironment).toHaveBeenCalledWith({
      argv,
      cwd: process.cwd(),
    });
    expect(maybeHandleInlineHelp).toHaveBeenCalledWith(program, [
      "--env-file",
      ".env.production",
      "records",
    ]);
  });

  it("prints one json error in agent mode for parse failures", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const originalExitCode = process.exitCode;
    program.parseAsync = vi.fn(async () => {
      throw { message: "unknown command 'explode'", code: "commander.unknownCommand", exitCode: 2 };
    });

    await main(["node", "twenty", "--agent-mode", "auth", "explode"]);

    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(errorSpy.mock.calls[0][0]))).toMatchObject({
      ok: false,
      error: {
        code: "INVALID_ARGUMENTS",
        exit_code: 2,
        retryable: false,
      },
    });

    process.exitCode = originalExitCode;
    errorSpy.mockRestore();
  });

  it("prints one json error when TWENTY_AGENT_MODE requests agent mode", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const originalExitCode = process.exitCode;
    const originalAgentMode = process.env.TWENTY_AGENT_MODE;
    process.env.TWENTY_AGENT_MODE = "true";
    program.parseAsync = vi.fn(async () => {
      throw { message: "unknown command 'explode'", code: "commander.unknownCommand", exitCode: 2 };
    });

    await main(["node", "twenty", "auth", "explode"]);

    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(errorSpy.mock.calls[0][0]))).toMatchObject({
      ok: false,
      error: {
        code: "INVALID_ARGUMENTS",
        exit_code: 2,
        retryable: false,
      },
    });

    process.exitCode = originalExitCode;
    if (originalAgentMode === undefined) {
      delete process.env.TWENTY_AGENT_MODE;
    } else {
      process.env.TWENTY_AGENT_MODE = originalAgentMode;
    }
    errorSpy.mockRestore();
  });

  it("keeps text errors outside agent mode", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const originalExitCode = process.exitCode;
    program.parseAsync = vi.fn(async () => {
      throw { message: "unknown command 'explode'", code: "commander.unknownCommand", exitCode: 2 };
    });

    await main(["node", "twenty", "auth", "explode"]);

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("unknown command"));

    process.exitCode = originalExitCode;
    errorSpy.mockRestore();
  });

  it("prints a db fallback diagnostic after a successful non-agent command", async () => {
    const writeSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    vi.mocked(getLastSourceTracker).mockReturnValue({
      lastFallbackReason: "schema drift (42703)",
    } as never);

    await main(["node", "twenty", "api", "list", "people"]);

    expect(resetLastSourceTracker).toHaveBeenCalledOnce();
    expect(writeSpy).toHaveBeenCalledWith(
      expect.stringContaining("twenty: db read fell back to api (schema drift (42703))"),
    );

    writeSpy.mockRestore();
  });

  it("suppresses the db fallback diagnostic in agent mode", async () => {
    const writeSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    vi.mocked(getLastSourceTracker).mockReturnValue({
      lastFallbackReason: "schema drift (42703)",
    } as never);

    await main(["node", "twenty", "--agent-mode", "api", "list", "people"]);

    expect(writeSpy).not.toHaveBeenCalled();

    writeSpy.mockRestore();
  });
});
