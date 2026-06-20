import path from "path";

import { parse } from "dotenv";
import fs from "fs-extra";

export interface LoadCliEnvironmentOptions {
  argv?: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  explicitEnvFile?: string;
}

export interface LoadedCliEnvironment {
  loadedFiles: string[];
  explicitEnvFile?: string;
}

export function resolveEnvFileFromArgv(argv: string[] = []): string | undefined {
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === undefined) {
      continue;
    }
    if (value === "--env-file") {
      return argv[index + 1];
    }
    if (value.startsWith("--env-file=")) {
      return value.slice("--env-file=".length);
    }
  }

  return undefined;
}

export function loadCliEnvironment(options: LoadCliEnvironmentOptions = {}): LoadedCliEnvironment {
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const configuredEnvFile =
    options.explicitEnvFile ??
    resolveEnvFileFromArgv(options.argv ?? process.argv) ??
    env.TWENTY_ENV_FILE;

  const defaultFiles = [path.join(cwd, ".env"), path.join(cwd, ".env.local")];
  const explicitEnvFile = configuredEnvFile ? path.resolve(cwd, configuredEnvFile) : undefined;
  const candidateFiles = explicitEnvFile ? [...defaultFiles, explicitEnvFile] : defaultFiles;

  const loadedFiles: string[] = [];
  const mergedEnv: Record<string, string> = {};

  for (const filePath of new Set(candidateFiles)) {
    if (!pathExists(filePath)) {
      continue;
    }

    const content = readFile(filePath);
    if (content === undefined) {
      continue;
    }

    Object.assign(mergedEnv, parse(content));
    loadedFiles.push(filePath);
  }

  const originalKeys = new Set(Object.keys(env));
  for (const [key, value] of Object.entries(mergedEnv)) {
    if (originalKeys.has(key)) {
      continue;
    }
    env[key] = value;
  }

  return {
    loadedFiles,
    explicitEnvFile,
  };
}

export async function upsertEnvValue(filePath: string, key: string, value: string): Promise<void> {
  const existing = (await fs.pathExists(filePath)) ? await fs.readFile(filePath, "utf-8") : "";
  const lines = existing ? existing.split(/\r?\n/) : [];
  const rendered = `${key}=${formatEnvValue(value)}`;
  let updated = false;

  const nextLines = lines.map((line) => {
    if (line.trimStart().startsWith(`${key}=`)) {
      updated = true;
      return rendered;
    }

    return line;
  });

  if (!updated) {
    if (nextLines.length > 0 && nextLines[nextLines.length - 1] === "") {
      nextLines.splice(nextLines.length - 1, 0, rendered);
    } else {
      nextLines.push(rendered);
    }
  }

  await fs.outputFile(filePath, `${nextLines.join("\n").replace(/\n*$/, "")}\n`, "utf-8");
}

function formatEnvValue(value: string): string {
  if (/^[A-Za-z0-9_./:@+-]+$/.test(value)) {
    return value;
  }

  return JSON.stringify(value);
}

function pathExists(filePath: string): boolean {
  if (typeof fs.pathExistsSync !== "function") {
    return false;
  }

  return fs.pathExistsSync(filePath);
}

function readFile(filePath: string): string | undefined {
  if (typeof fs.readFileSync !== "function") {
    return undefined;
  }

  return fs.readFileSync(filePath, "utf-8");
}
