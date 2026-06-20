import type { Client } from "pg";

import { UnsupportedDbReadError } from "../../readbackend/types";
import type { ResolvedDbConfig } from "./db-config-resolver.service";
import type { DbTableReference } from "./db-sql-identifiers";

type DbTableResolverClient = Pick<Client, "query">;

interface WorkspaceSchemaRow {
  schemaName?: string | null;
}

interface TableSchemaRow {
  schemaName?: string | null;
}

const SYSTEM_SCHEMAS = ["pg_catalog", "information_schema", "core"];

export class DbTableResolverService {
  private readonly schemaCache = new Map<string, string | undefined>();
  private readonly workspaceSchemaCache = new Map<string, Promise<string | undefined>>();
  private readonly workspaceTableSetCache = new Map<string, Promise<Set<string>>>();

  async resolve(
    client: DbTableResolverClient,
    target: ResolvedDbConfig,
    tableName: string,
  ): Promise<DbTableReference> {
    const configuredSchema = normalizeSchemaName(target.databaseSchema);

    if (configuredSchema) {
      return { schemaName: configuredSchema, tableName };
    }

    const cacheKey = `${target.databaseUrl ?? ""}:${tableName}`;
    if (this.schemaCache.has(cacheKey)) {
      return { schemaName: this.schemaCache.get(cacheKey), tableName };
    }

    const workspaceSchema = await this.getWorkspaceSchema(client, target.databaseUrl);
    if (
      workspaceSchema &&
      (await this.workspaceSchemaHasTable(client, target.databaseUrl, workspaceSchema, tableName))
    ) {
      this.schemaCache.set(cacheKey, workspaceSchema);
      return { schemaName: workspaceSchema, tableName };
    }

    const tableSchema = await this.resolveSingleTableSchema(client, tableName);
    this.schemaCache.set(cacheKey, tableSchema);

    return { schemaName: tableSchema, tableName };
  }

  private getWorkspaceSchema(
    client: DbTableResolverClient,
    databaseUrl?: string,
  ): Promise<string | undefined> {
    const key = databaseUrl ?? "";
    let promise = this.workspaceSchemaCache.get(key);
    if (!promise) {
      promise = this.resolveSingleWorkspaceSchema(client).catch((error) => {
        // Don't cache failures so a transient error can recover.
        this.workspaceSchemaCache.delete(key);
        throw error;
      });
      this.workspaceSchemaCache.set(key, promise);
    }
    return promise;
  }

  private async workspaceSchemaHasTable(
    client: DbTableResolverClient,
    databaseUrl: string | undefined,
    schemaName: string,
    tableName: string,
  ): Promise<boolean> {
    const tables = await this.getWorkspaceTableSet(client, databaseUrl, schemaName);
    return tables.has(tableName);
  }

  private getWorkspaceTableSet(
    client: DbTableResolverClient,
    databaseUrl: string | undefined,
    schemaName: string,
  ): Promise<Set<string>> {
    const key = `${databaseUrl ?? ""}:${schemaName}`;
    let promise = this.workspaceTableSetCache.get(key);
    if (!promise) {
      promise = this.loadWorkspaceTableSet(client, schemaName).catch((error) => {
        this.workspaceTableSetCache.delete(key);
        throw error;
      });
      this.workspaceTableSetCache.set(key, promise);
    }
    return promise;
  }

  private async loadWorkspaceTableSet(
    client: DbTableResolverClient,
    schemaName: string,
  ): Promise<Set<string>> {
    try {
      const result = await client.query<{ tableName: string }>(
        `
          select table_name as "tableName"
          from information_schema.tables
          where table_schema = $1
            and table_type = 'BASE TABLE'
        `,
        [schemaName],
      );
      const set = new Set<string>();
      for (const row of result.rows) {
        if (typeof row.tableName === "string" && row.tableName.length > 0) {
          set.add(row.tableName);
        }
      }
      return set;
    } catch {
      return new Set();
    }
  }

  private async resolveSingleWorkspaceSchema(
    client: DbTableResolverClient,
  ): Promise<string | undefined> {
    try {
      const result = await client.query<WorkspaceSchemaRow>(`
        select "databaseSchema" as "schemaName"
        from "core"."workspace"
        where "deletedAt" is null
          and "databaseSchema" is not null
          and "databaseSchema" <> ''
        order by "createdAt" desc
      `);
      const schemaNames = uniqueSchemaNames(result.rows);

      return schemaNames.length === 1 ? schemaNames[0] : undefined;
    } catch {
      return undefined;
    }
  }

  private async resolveSingleTableSchema(
    client: DbTableResolverClient,
    tableName: string,
  ): Promise<string | undefined> {
    const result = await client.query<TableSchemaRow>(
      `
        select table_schema as "schemaName"
        from information_schema.tables
        where table_name = $1
          and table_type = 'BASE TABLE'
          and table_schema <> all($2::text[])
        order by
          case
            when table_schema like 'workspace_%' then 0
            when table_schema = 'public' then 1
            else 2
          end,
          table_schema
      `,
      [tableName, SYSTEM_SCHEMAS],
    );
    const schemaNames = uniqueSchemaNames(result.rows);

    if (schemaNames.length <= 1) {
      return schemaNames[0];
    }

    throw new UnsupportedDbReadError(
      `DB reads found multiple schemas containing ${JSON.stringify(tableName)}. Set TWENTY_DATABASE_SCHEMA to the workspace schema to disambiguate.`,
    );
  }
}

function uniqueSchemaNames(rows: Array<{ schemaName?: string | null }>): string[] {
  const seen = new Set<string>();

  for (const row of rows) {
    const schemaName = normalizeSchemaName(row.schemaName);

    if (schemaName) {
      seen.add(schemaName);
    }
  }

  return Array.from(seen);
}

function normalizeSchemaName(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();

  return trimmed ? trimmed : undefined;
}
