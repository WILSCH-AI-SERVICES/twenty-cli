import type { ReadSource } from "../../shared/global-options";
import { DbConfigResolverService } from "./db-config-resolver.service";
import { DbConnectionService } from "./db-connection.service";
import { redactDatabaseUrl, redactDbSecrets } from "./db-secret-redaction.service";
import { DbTableResolverService } from "./db-table-resolver.service";

export interface DbStatusSummary {
  workspace: string;
  configured: boolean;
  mode: "api" | "db";
  source: "env" | "profile" | "none" | "override";
  profileName?: string;
  databaseUrl?: string;
  databaseSchema?: string;
}

export interface DbDoctorSummary extends DbStatusSummary {
  ok: boolean;
  checkedAt: string;
  effectiveSslmode?: string;
  sslmodeSource?: "url" | "default";
  hasConnectTimeout?: boolean;
  resolvedSchema?: string;
  resources?: DbDoctorResourceSummary[];
  warnings: string[];
  connection?: {
    ok: boolean;
    errorCode?: string;
    message?: string;
  };
}

export interface DbDoctorResourceSummary {
  name: string;
  readable: boolean;
  reason?: string;
}

const DOCTOR_RESOURCES = [
  { name: "people", tableName: "person" },
  { name: "companies", tableName: "company" },
  { name: "opportunities", tableName: "opportunity" },
  { name: "tasks", tableName: "task" },
  { name: "notes", tableName: "note" },
];

export class DbStatusService {
  constructor(
    private readonly dbConfigResolver: DbConfigResolverService,
    private readonly dbConnectionService = new DbConnectionService(),
    private readonly tableResolver = new DbTableResolverService(),
  ) {}

  async getStatus(options?: {
    workspace?: string;
    readSource?: ReadSource;
  }): Promise<DbStatusSummary> {
    const resolved = await this.dbConfigResolver.resolve(options);

    return {
      workspace: resolved.workspace,
      configured: resolved.mode === "db",
      mode: resolved.mode,
      source: resolved.source,
      profileName: resolved.profileName,
      ...(resolved.databaseSchema ? { databaseSchema: resolved.databaseSchema } : {}),
    };
  }

  async doctor(options?: {
    workspace?: string;
    readSource?: ReadSource;
  }): Promise<DbDoctorSummary> {
    const resolved = await this.dbConfigResolver.resolve(options);
    const urlOptions = inspectDatabaseUrlOptions(resolved.databaseUrl);
    const base: DbStatusSummary = {
      workspace: resolved.workspace,
      configured: resolved.mode === "db",
      mode: resolved.mode,
      source: resolved.source,
      profileName: resolved.profileName,
      databaseUrl: redactDatabaseUrl(resolved.databaseUrl),
      ...(resolved.databaseSchema ? { databaseSchema: resolved.databaseSchema } : {}),
    };

    if (resolved.mode !== "db" || !resolved.databaseUrl) {
      return {
        ...base,
        ...urlOptions,
        ok: false,
        checkedAt: new Date().toISOString(),
        warnings: urlOptions.warnings,
        connection: {
          ok: false,
          errorCode: "DB_NOT_CONFIGURED",
          message: "No DB URL resolved; supported reads will use the API.",
        },
      };
    }

    try {
      let resolvedSchema = resolved.databaseSchema;
      let resources: DbDoctorResourceSummary[] = [];
      await this.dbConnectionService.withClient(
        { databaseUrl: resolved.databaseUrl },
        async (client) => {
          await this.dbConnectionService.ping(client);
          const resourceSummary = await this.resolveResources(client, resolved);
          resolvedSchema = resolvedSchema ?? resourceSummary.resolvedSchema;
          resources = resourceSummary.resources;
        },
      );

      return {
        ...base,
        ...urlOptions,
        ok: true,
        checkedAt: new Date().toISOString(),
        ...(resolvedSchema ? { resolvedSchema } : {}),
        resources,
        warnings: urlOptions.warnings,
        connection: { ok: true },
      };
    } catch (error) {
      return {
        ...base,
        ...urlOptions,
        ok: false,
        checkedAt: new Date().toISOString(),
        warnings: urlOptions.warnings,
        connection: {
          ok: false,
          errorCode: "DB_CONNECTION_FAILED",
          message: redactDbSecrets(
            error instanceof Error ? error.message : "DB connection failed.",
          ),
        },
      };
    }
  }

  private async resolveResources(
    client: Parameters<Parameters<DbConnectionService["withClient"]>[1]>[0],
    target: Awaited<ReturnType<DbConfigResolverService["resolve"]>>,
  ): Promise<{ resolvedSchema?: string; resources: DbDoctorResourceSummary[] }> {
    let resolvedSchema: string | undefined;
    const resources: DbDoctorResourceSummary[] = [];

    for (const resource of DOCTOR_RESOURCES) {
      try {
        const table = await this.tableResolver.resolve(client, target, resource.tableName);
        resolvedSchema = resolvedSchema ?? table.schemaName;
        resources.push({ name: resource.name, readable: true });
      } catch (error) {
        resources.push({
          name: resource.name,
          readable: false,
          reason: redactDbSecrets(error instanceof Error ? error.message : "not readable"),
        });
      }
    }

    return { ...(resolvedSchema ? { resolvedSchema } : {}), resources };
  }
}

function inspectDatabaseUrlOptions(databaseUrl: string | undefined): {
  effectiveSslmode: string;
  sslmodeSource: "url" | "default";
  hasConnectTimeout: boolean;
  warnings: string[];
} {
  if (!databaseUrl) {
    return {
      effectiveSslmode: "prefer",
      sslmodeSource: "default",
      hasConnectTimeout: false,
      warnings: [],
    };
  }

  try {
    const url = new URL(databaseUrl);
    const sslmode = url.searchParams.get("sslmode");
    return {
      effectiveSslmode: sslmode ?? "prefer",
      sslmodeSource: sslmode ? "url" : "default",
      hasConnectTimeout: url.searchParams.has("connect_timeout"),
      warnings: [],
    };
  } catch {
    return {
      effectiveSslmode: "prefer",
      sslmodeSource: "default",
      hasConnectTimeout: false,
      warnings: ["Could not parse DB URL options."],
    };
  }
}
