import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface LiveSmokeConfig {
  token: string;
  baseUrl: string;
  profile?: string;
}

interface ResolveLiveSmokeConfigOptions {
  required?: boolean;
}

interface TwentyConfigFile {
  workspaces?: Record<string, { apiKey?: string; apiUrl?: string }>;
  defaultWorkspace?: string;
}

export function resolveLiveSmokeConfig(
  options: ResolveLiveSmokeConfigOptions = {},
): LiveSmokeConfig | null {
  const fileConfig = readConfigFile();
  const profile = process.env.TWENTY_PROFILE || fileConfig?.defaultWorkspace || "default";
  const workspaceConfig = fileConfig?.workspaces?.[profile];
  const token =
    process.env.TWENTY_API_TOKEN || process.env.TWENTY_TOKEN || workspaceConfig?.apiKey || "";
  const baseUrl =
    process.env.TWENTY_BASE_URL || workspaceConfig?.apiUrl || "https://api.twenty.com";

  if (options.required && !token) {
    throw new Error("Missing live smoke configuration");
  }

  if (!token) {
    return null;
  }

  return {
    token,
    baseUrl,
    profile,
  };
}

export function isLiveSmokeEnabled(): boolean {
  return process.env.TWENTY_LIVE_SMOKE === "true";
}

function readConfigFile(): TwentyConfigFile | null {
  const configPath = path.join(os.homedir(), ".twenty", "config.json");
  if (!fs.existsSync(configPath)) {
    return null;
  }

  try {
    const raw = fs.readFileSync(configPath, "utf-8");
    return JSON.parse(raw) as TwentyConfigFile;
  } catch {
    return null;
  }
}
