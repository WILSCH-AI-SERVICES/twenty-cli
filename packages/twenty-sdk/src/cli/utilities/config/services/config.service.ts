import os from "os";
import path from "path";

import fs from "fs-extra";

import { CliError } from "../../errors/cli-error";

export const API_TOKEN_ENV_VAR = "TWENTY_API_TOKEN";
export const LEGACY_API_TOKEN_ENV_VAR = "TWENTY_TOKEN";

export interface WorkspaceConfig {
  apiUrl?: string;
  apiKey?: string;
  db?: WorkspaceDbConfig;
}

export interface DbProfileConfig {
  name: string;
  workspace: string;
  workspaceId?: string;
  databaseSchema?: string;
  databaseUrl: string;
  credentialSource: string;
  cachedUser?: string;
  /** @deprecated DB profile passwords are env-backed and are not persisted. */
  cachedPassword?: string;
  lastRefreshedAt?: string;
  lastValidatedAt?: string;
  notes?: string;
}

export interface WorkspaceDbConfig {
  activeProfile?: string;
  profiles?: Record<string, DbProfileConfig>;
}

export interface TwentyConfigFile {
  workspaces?: Record<string, WorkspaceConfig>;
  defaultWorkspace?: string;
}

export interface WorkspaceInfo {
  name: string;
  isDefault: boolean;
  apiUrl?: string;
}

export interface ResolvedConfig {
  apiUrl: string;
  apiKey: string;
  workspace?: string;
  tokenSource?: "env" | "legacy-config" | "none";
}

export interface ConfigOverrides {
  workspace?: string;
  apiUrl?: string;
  apiKey?: string;
}

export interface ResolveApiConfigOptions extends ConfigOverrides {
  requireAuth?: boolean;
  missingAuthSuggestion?: string;
}

export class ConfigService {
  private configPath: string;

  constructor(configPath?: string) {
    this.configPath = configPath ?? path.join(os.homedir(), ".twenty", "config.json");
  }

  async loadConfigFile(): Promise<TwentyConfigFile | null> {
    try {
      const exists = await fs.pathExists(this.configPath);
      if (!exists) return null;
      const content = await fs.readFile(this.configPath, "utf-8");
      return JSON.parse(content) as TwentyConfigFile;
    } catch {
      throw new CliError(
        `Failed to read config at ${this.configPath}`,
        "INVALID_ARGUMENTS",
        "Check the config file format or remove the file to recreate it.",
      );
    }
  }

  async getConfig(overrides?: ConfigOverrides): Promise<ResolvedConfig> {
    const resolved = await this.resolveApiConfig({
      ...overrides,
      requireAuth: true,
      missingAuthSuggestion:
        "Set TWENTY_API_TOKEN in .env, .env.local, --env-file, or your shell before running authenticated commands.",
    });

    return {
      apiUrl: resolved.apiUrl,
      apiKey: resolved.apiKey,
      workspace: resolved.workspace,
      tokenSource: resolved.tokenSource,
    };
  }

  async resolveApiConfig(overrides?: ResolveApiConfigOptions): Promise<ResolvedConfig> {
    const fileConfig = await this.loadConfigFile();
    const workspace =
      overrides?.workspace ??
      process.env.TWENTY_PROFILE ??
      fileConfig?.defaultWorkspace ??
      "default";

    const workspaceConfig = fileConfig?.workspaces?.[workspace] ?? {};

    const apiUrl =
      overrides?.apiUrl ??
      process.env.TWENTY_BASE_URL ??
      workspaceConfig.apiUrl ??
      "https://api.twenty.com";

    const envApiKey = process.env[API_TOKEN_ENV_VAR] || process.env[LEGACY_API_TOKEN_ENV_VAR];
    const legacyApiKey = workspaceConfig.apiKey;
    const apiKey = overrides?.apiKey ?? envApiKey ?? legacyApiKey ?? "";
    const tokenSource = envApiKey ? "env" : legacyApiKey ? "legacy-config" : "none";

    if (overrides?.requireAuth && !apiKey) {
      throw new CliError(
        "Missing API token.",
        "AUTH",
        overrides.missingAuthSuggestion ??
          "Set TWENTY_API_TOKEN in .env, .env.local, --env-file, or your shell before running authenticated commands.",
      );
    }

    return {
      apiUrl,
      apiKey,
      workspace,
      tokenSource,
    };
  }

  async listWorkspaces(): Promise<WorkspaceInfo[]> {
    const config = await this.loadConfigFile();
    if (!config?.workspaces) {
      return [];
    }

    return Object.entries(config.workspaces).map(([name, workspaceConfig]) => ({
      name,
      isDefault: config.defaultWorkspace === name,
      apiUrl: workspaceConfig.apiUrl,
    }));
  }

  async setDefaultWorkspace(name: string): Promise<void> {
    const config = await this.loadConfigFile();
    if (!config?.workspaces?.[name]) {
      throw new CliError(
        `Workspace '${name}' does not exist`,
        "INVALID_ARGUMENTS",
        'Use "twenty auth list" to see available workspaces.',
      );
    }

    config.defaultWorkspace = name;
    await this.saveConfigFile(config);
  }

  async saveWorkspace(name: string, workspaceConfig: WorkspaceConfig): Promise<void> {
    let config = await this.loadConfigFile();

    if (!config) {
      config = {
        workspaces: {},
        defaultWorkspace: name,
      };
    }

    if (!config.workspaces) {
      config.workspaces = {};
    }

    // Set as default if this is the first workspace
    if (Object.keys(config.workspaces).length === 0) {
      config.defaultWorkspace = name;
    }

    config.workspaces[name] = {
      ...config.workspaces[name],
      ...workspaceConfig,
    };
    await this.saveConfigFile(config);
  }

  async removeWorkspace(name: string): Promise<void> {
    const config = await this.loadConfigFile();
    if (!config?.workspaces?.[name]) {
      throw new CliError(
        `Workspace '${name}' does not exist`,
        "INVALID_ARGUMENTS",
        'Use "twenty auth list" to see available workspaces.',
      );
    }

    delete config.workspaces[name];

    // Handle default workspace removal
    if (config.defaultWorkspace === name) {
      const remainingWorkspaces = Object.keys(config.workspaces);
      config.defaultWorkspace = remainingWorkspaces.length > 0 ? remainingWorkspaces[0] : undefined;
    }

    await this.saveConfigFile(config);
  }

  async saveDbProfile(workspace: string, profile: DbProfileConfig): Promise<void> {
    const config = await this.loadConfigFile();
    if (!config) {
      throw new CliError(
        `Workspace '${workspace}' does not exist`,
        "INVALID_ARGUMENTS",
        'Use "twenty auth list" to see available workspaces.',
      );
    }
    const workspaceConfig = this.ensureWorkspaceExists(config, workspace);

    if (!workspaceConfig.db) {
      workspaceConfig.db = {};
    }
    if (!workspaceConfig.db.profiles) {
      workspaceConfig.db.profiles = {};
    }

    workspaceConfig.db.profiles[profile.name] = sanitizeDbProfile(profile);
    await this.saveConfigFile(config);
  }

  async setActiveDbProfile(workspace: string, name: string): Promise<void> {
    const config = await this.loadConfigFile();
    if (!config) {
      throw new CliError(
        `Workspace '${workspace}' does not exist`,
        "INVALID_ARGUMENTS",
        'Use "twenty auth list" to see available workspaces.',
      );
    }
    const workspaceConfig = this.ensureWorkspaceExists(config, workspace);
    this.getDbProfileFromWorkspaceConfig(workspaceConfig, workspace, name);

    if (!workspaceConfig.db) {
      workspaceConfig.db = {};
    }

    workspaceConfig.db.activeProfile = name;
    await this.saveConfigFile(config);
  }

  async getDbProfile(workspace: string, name: string): Promise<DbProfileConfig> {
    const config = await this.loadConfigFile();
    const workspaceConfig = this.ensureWorkspaceExists(config, workspace);
    return this.getDbProfileFromWorkspaceConfig(workspaceConfig, workspace, name);
  }

  async getActiveDbProfile(workspace: string): Promise<DbProfileConfig | undefined> {
    const config = await this.loadConfigFile();
    const workspaceConfig = this.ensureWorkspaceExists(config, workspace);
    const activeProfile = workspaceConfig.db?.activeProfile;
    if (!activeProfile) {
      return undefined;
    }

    return this.getDbProfileFromWorkspaceConfig(workspaceConfig, workspace, activeProfile);
  }

  async listDbProfiles(workspace: string): Promise<DbProfileConfig[]> {
    const config = await this.loadConfigFile();
    const workspaceConfig = this.ensureWorkspaceExists(config, workspace);
    return Object.values(workspaceConfig.db?.profiles ?? {}).map(sanitizeDbProfile);
  }

  async removeDbProfile(workspace: string, name: string): Promise<void> {
    const config = await this.loadConfigFile();
    if (!config) {
      throw new CliError(
        `Workspace '${workspace}' does not exist`,
        "INVALID_ARGUMENTS",
        'Use "twenty auth list" to see available workspaces.',
      );
    }
    const workspaceConfig = this.ensureWorkspaceExists(config, workspace);
    const profiles = workspaceConfig.db?.profiles;
    if (!profiles || !profiles[name]) {
      throw new CliError(
        `DB profile '${name}' does not exist in workspace '${workspace}'`,
        "INVALID_ARGUMENTS",
        'Use "twenty db profile list" to see available profiles.',
      );
    }

    delete profiles[name];

    if (workspaceConfig.db?.activeProfile === name) {
      const remainingProfiles = Object.keys(profiles);
      workspaceConfig.db.activeProfile = remainingProfiles[0];
    }

    await this.saveConfigFile(config);
  }

  private async saveConfigFile(config: TwentyConfigFile): Promise<void> {
    await fs.outputFile(this.configPath, JSON.stringify(config, null, 2), "utf-8");
  }

  private ensureWorkspaceExists(
    config: TwentyConfigFile | null,
    workspace: string,
  ): WorkspaceConfig {
    const workspaceConfig = config?.workspaces?.[workspace];
    if (!config?.workspaces || !workspaceConfig) {
      throw new CliError(
        `Workspace '${workspace}' does not exist`,
        "INVALID_ARGUMENTS",
        'Use "twenty auth list" to see available workspaces.',
      );
    }

    return workspaceConfig;
  }

  private getDbProfileFromWorkspaceConfig(
    workspaceConfig: WorkspaceConfig,
    workspace: string,
    name: string,
  ): DbProfileConfig {
    const profile = workspaceConfig.db?.profiles?.[name];
    if (!profile) {
      throw new CliError(
        `DB profile '${name}' does not exist in workspace '${workspace}'`,
        "INVALID_ARGUMENTS",
        'Use "twenty db profile list" to see available profiles.',
      );
    }

    return sanitizeDbProfile(profile);
  }
}

function sanitizeDbProfile(profile: DbProfileConfig): DbProfileConfig {
  const { cachedPassword: _cachedPassword, ...safeProfile } = profile;

  return {
    ...safeProfile,
    databaseUrl: stripDatabaseUrlPassword(safeProfile.databaseUrl),
  };
}

function stripDatabaseUrlPassword(databaseUrl: string): string {
  try {
    const url = new URL(databaseUrl);
    if (!url.password) {
      return databaseUrl;
    }

    url.password = "";

    return url.toString();
  } catch {
    return databaseUrl.replace(/:\/\/([^:\s/@]+):([^@\s]+)@/, "://$1@");
  }
}
