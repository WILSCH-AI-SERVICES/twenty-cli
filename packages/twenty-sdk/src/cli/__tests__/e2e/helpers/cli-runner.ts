import path from "node:path";

import { runNodeScript, runNodeScriptAsync, type ProcessRunOptions } from "./process-runner";

export interface BuiltCliRunOptions extends ProcessRunOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  retainInheritedTwentyEnv?: boolean;
}

export {
  BuiltCliRunError,
  assertSuccessfulBuiltCliRun,
  type BuiltCliRunResult,
} from "./process-runner";

export function resolveBuiltCliPath(): string {
  return path.resolve(__dirname, "../../../../../dist/cli/cli.js");
}

export function runBuiltCli(args: string[], options: BuiltCliRunOptions = {}) {
  return runNodeScript(resolveBuiltCliPath(), args, {
    cwd: options.cwd,
    env: composeCliEnv(options),
    timeoutMs: options.timeoutMs,
    throwOnNonZeroExit: options.throwOnNonZeroExit,
  });
}

export async function runBuiltCliAsync(args: string[], options: BuiltCliRunOptions = {}) {
  return await runNodeScriptAsync(resolveBuiltCliPath(), args, {
    cwd: options.cwd,
    env: composeCliEnv(options),
    timeoutMs: options.timeoutMs,
    throwOnNonZeroExit: options.throwOnNonZeroExit,
  });
}

function composeCliEnv(options: BuiltCliRunOptions): NodeJS.ProcessEnv {
  const inheritedEnv = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => options.retainInheritedTwentyEnv || !key.startsWith("TWENTY_"),
    ),
  );

  return {
    ...inheritedEnv,
    ...options.env,
  };
}
