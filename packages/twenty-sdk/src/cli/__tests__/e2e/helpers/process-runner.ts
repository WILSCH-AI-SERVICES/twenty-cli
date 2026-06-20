import { spawn, spawnSync } from "node:child_process";

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_BUFFER = 20 * 1024 * 1024;

export interface ProcessRunOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  throwOnNonZeroExit?: boolean;
}

export interface BuiltCliRunResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

export class BuiltCliRunError extends Error {
  constructor(
    readonly args: string[],
    readonly result: BuiltCliRunResult,
  ) {
    super(formatRunFailure(args, result));
    this.name = "BuiltCliRunError";
  }
}

export function runNodeScript(
  scriptPath: string,
  args: string[],
  options: ProcessRunOptions = {},
): BuiltCliRunResult {
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: options.cwd,
    env: options.env,
    encoding: "utf-8",
    maxBuffer: MAX_BUFFER,
    killSignal: "SIGKILL",
    timeout: options.timeoutMs,
  });

  const scriptResult = {
    exitCode: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };

  if (isSyncTimeoutError(result.error)) {
    const timedOutResult = {
      ...scriptResult,
      exitCode: null,
    };

    return options.throwOnNonZeroExit
      ? assertSuccessfulBuiltCliRun(args, timedOutResult)
      : timedOutResult;
  }

  if (result.error) {
    throw result.error;
  }

  return options.throwOnNonZeroExit
    ? assertSuccessfulBuiltCliRun(args, scriptResult)
    : scriptResult;
}

export async function runNodeScriptAsync(
  scriptPath: string,
  args: string[],
  options: ProcessRunOptions = {},
): Promise<BuiltCliRunResult> {
  const child = spawn(process.execPath, [scriptPath, ...args], {
    cwd: options.cwd,
    env: options.env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";

  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString("utf-8");
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString("utf-8");
  });

  return await new Promise<BuiltCliRunResult>((resolve, reject) => {
    let exitCode: number | null = null;
    let timedOut = false;

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    timeout.unref();

    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    child.once("exit", (code) => {
      exitCode = code;
    });

    child.once("close", (closeCode) => {
      clearTimeout(timeout);
      const scriptResult = {
        exitCode: closeCode ?? (timedOut ? null : exitCode),
        stdout,
        stderr,
      };

      if (options.throwOnNonZeroExit) {
        try {
          resolve(assertSuccessfulBuiltCliRun(args, scriptResult));
        } catch (error) {
          reject(error);
        }
        return;
      }

      resolve(scriptResult);
    });
  });
}

export function assertSuccessfulBuiltCliRun(
  args: string[],
  result: BuiltCliRunResult,
): BuiltCliRunResult {
  if (result.exitCode === 0) {
    return result;
  }

  throw new BuiltCliRunError(args, result);
}

function formatRunFailure(args: string[], result: BuiltCliRunResult): string {
  return [
    `Built CLI exited with code ${result.exitCode ?? "null"}`,
    `args: ${args.join(" ")}`,
    `stderr:\n${result.stderr || "(empty)"}`,
    `stdout:\n${result.stdout || "(empty)"}`,
  ].join("\n");
}

function isSyncTimeoutError(error: unknown): error is NodeJS.ErrnoException {
  return (error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT";
}
