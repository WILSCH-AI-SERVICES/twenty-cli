import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  runBuiltCli,
  runBuiltCliAsync,
  type BuiltCliRunOptions,
  type BuiltCliRunResult,
} from "./cli-runner";

export interface TempHomeCliRunOptions extends BuiltCliRunOptions {}

export function runBuiltCliWithTempHome(
  args: string[],
  options: TempHomeCliRunOptions = {},
): BuiltCliRunResult {
  const homeDir = createTempHomeDir();

  try {
    return runBuiltCli(args, {
      ...options,
      cwd: homeDir,
      env: createTempHomeEnv(homeDir, options),
    });
  } finally {
    fs.rmSync(homeDir, { recursive: true, force: true });
  }
}

export async function runBuiltCliWithTempHomeAsync(
  args: string[],
  options: TempHomeCliRunOptions = {},
): Promise<BuiltCliRunResult> {
  const homeDir = createTempHomeDir();

  try {
    return await runBuiltCliAsync(args, {
      ...options,
      cwd: homeDir,
      env: createTempHomeEnv(homeDir, options),
    });
  } finally {
    fs.rmSync(homeDir, { recursive: true, force: true });
  }
}

function createTempHomeDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "twenty-cli-home-"));
}

function createTempHomeEnv(homeDir: string, options: TempHomeCliRunOptions): NodeJS.ProcessEnv {
  return {
    ...options.env,
    HOME: homeDir,
    USERPROFILE: homeDir,
  };
}
