import { CliError } from "../../errors/cli-error";
import type { ReadSource } from "../../shared/global-options";
import { resolveProfileDatabaseUrl } from "./db-profile-url";
import { DbProfileService } from "./db-profile.service";

export interface ResolvedDbConfig {
  workspace: string;
  mode: "api" | "db";
  source: "env" | "profile" | "none" | "override";
  databaseUrl?: string;
  databaseSchema?: string;
  profileName?: string;
}

export class DbConfigResolverService {
  constructor(private readonly dbProfiles: DbProfileService) {}

  async resolve(options?: {
    workspace?: string;
    readSource?: ReadSource;
  }): Promise<ResolvedDbConfig> {
    const workspace = await this.dbProfiles.resolveWorkspace(options?.workspace);

    if (options?.readSource === "api") {
      return {
        workspace,
        mode: "api",
        source: "override",
      };
    }

    const activeProfile = await this.dbProfiles.getActiveProfile(workspace);
    const envDatabaseUrl = process.env.TWENTY_DATABASE_URL?.trim();
    const envDatabasePassword = normalizeOptionalEnv(process.env.TWENTY_DATABASE_PASSWORD);
    const envDatabaseSchema = normalizeOptionalEnv(process.env.TWENTY_DATABASE_SCHEMA);

    if (envDatabaseUrl) {
      return {
        workspace,
        mode: "db",
        source: "env",
        databaseUrl: envDatabaseUrl,
        databaseSchema: envDatabaseSchema,
      };
    }

    if (activeProfile?.databaseUrl) {
      const profileDatabaseUrl = resolveProfileDatabaseUrl(
        activeProfile.databaseUrl,
        envDatabasePassword,
      );

      return {
        workspace,
        mode: "db",
        source: "profile",
        databaseUrl: profileDatabaseUrl,
        databaseSchema: envDatabaseSchema ?? activeProfile.databaseSchema,
        profileName: activeProfile.name,
      };
    }

    if (options?.readSource === "db") {
      throw new CliError(
        "No DB URL resolved for --read-source db.",
        "INVALID_ARGUMENTS",
        "Set TWENTY_DATABASE_URL or select a db profile with `twenty db profile use <name>`.",
      );
    }

    return {
      workspace,
      mode: "api",
      source: "none",
    };
  }
}

function normalizeOptionalEnv(value: string | undefined): string | undefined {
  const trimmed = value?.trim();

  return trimmed ? trimmed : undefined;
}
