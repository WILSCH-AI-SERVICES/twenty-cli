import { ConfigService, type DbProfileConfig } from "../../config/services/config.service";
import { CliError } from "../../errors/cli-error";
import { DbConnectionService } from "./db-connection.service";
import { resolveProfileDatabaseUrl } from "./db-profile-url";

export interface DbProfileInitInput {
  workspace?: string;
  name: string;
  databaseUrl: string;
  notes?: string;
  workspaceId?: string;
  databaseSchema?: string;
  cachedUser?: string;
  cachedPassword?: string;
}

export class DbProfileService {
  constructor(
    private readonly configService: ConfigService,
    private readonly dbConnectionService = new DbConnectionService(),
  ) {}

  async resolveWorkspace(workspace?: string): Promise<string> {
    const resolved = await this.configService.resolveApiConfig({
      workspace,
      requireAuth: false,
    });

    return resolved.workspace ?? workspace ?? "default";
  }

  async initProfile(input: DbProfileInitInput): Promise<DbProfileConfig> {
    const workspace = await this.resolveWorkspace(input.workspace);
    const profile: DbProfileConfig = {
      name: input.name,
      workspace,
      databaseUrl: input.databaseUrl,
      credentialSource: "manual",
      notes: input.notes,
      workspaceId: input.workspaceId,
      ...(input.databaseSchema ? { databaseSchema: input.databaseSchema } : {}),
      cachedUser: input.cachedUser,
      cachedPassword: input.cachedPassword,
    };

    await this.configService.saveDbProfile(workspace, profile);

    return profile;
  }

  async saveProfile(workspace: string | undefined, profile: DbProfileConfig): Promise<void> {
    await this.configService.saveDbProfile(await this.resolveWorkspace(workspace), profile);
  }

  async setActiveProfile(workspace: string | undefined, name: string): Promise<DbProfileConfig> {
    const resolvedWorkspace = await this.resolveWorkspace(workspace);
    await this.configService.setActiveDbProfile(resolvedWorkspace, name);

    return this.getProfile(resolvedWorkspace, name);
  }

  async getProfile(workspace: string | undefined, name: string): Promise<DbProfileConfig> {
    return this.configService.getDbProfile(await this.resolveWorkspace(workspace), name);
  }

  async getActiveProfile(workspace: string | undefined): Promise<DbProfileConfig | undefined> {
    const resolvedWorkspace = await this.resolveWorkspace(workspace);

    try {
      return await this.configService.getActiveDbProfile(resolvedWorkspace);
    } catch (error) {
      if (this.isMissingWorkspace(error, resolvedWorkspace)) {
        return undefined;
      }

      throw error;
    }
  }

  async listProfiles(workspace: string | undefined): Promise<DbProfileConfig[]> {
    return this.configService.listDbProfiles(await this.resolveWorkspace(workspace));
  }

  async removeProfile(workspace: string | undefined, name: string): Promise<void> {
    await this.configService.removeDbProfile(await this.resolveWorkspace(workspace), name);
  }

  async refreshCreds(workspace: string | undefined, name: string): Promise<DbProfileConfig> {
    const resolvedWorkspace = await this.resolveWorkspace(workspace);
    const profile = await this.getProfile(resolvedWorkspace, name);
    const refreshed = {
      ...profile,
      lastRefreshedAt: new Date().toISOString(),
    };

    await this.configService.saveDbProfile(resolvedWorkspace, refreshed);

    return refreshed;
  }

  async test(workspace: string | undefined, name: string): Promise<DbProfileConfig> {
    const resolvedWorkspace = await this.resolveWorkspace(workspace);
    const profile = await this.getProfile(resolvedWorkspace, name);
    const databaseUrl = resolveProfileDatabaseUrl(
      profile.databaseUrl,
      normalizeOptionalEnv(process.env.TWENTY_DATABASE_PASSWORD),
    );
    await this.dbConnectionService.withClient({ databaseUrl }, (client) =>
      this.dbConnectionService.ping(client),
    );

    const validated = {
      ...profile,
      lastValidatedAt: new Date().toISOString(),
    };

    await this.configService.saveDbProfile(resolvedWorkspace, validated);

    return validated;
  }

  private isMissingWorkspace(error: unknown, workspace: string): boolean {
    return (
      error instanceof CliError &&
      error.code === "INVALID_ARGUMENTS" &&
      error.message === `Workspace '${workspace}' does not exist`
    );
  }
}

function normalizeOptionalEnv(value: string | undefined): string | undefined {
  const trimmed = value?.trim();

  return trimmed ? trimmed : undefined;
}
