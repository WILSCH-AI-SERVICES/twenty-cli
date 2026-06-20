import type { Client } from "pg";

import type { DbTableReference } from "./db-sql-identifiers";

type DbCapabilitiesClient = Pick<Client, "query">;

export interface DbSchemaSnapshot {
  tables: Set<string>;
  columns: Map<string, Set<string>>;
}

export interface DbCapabilityRequirement {
  table: DbTableReference | string;
  columns?: string[];
}

interface DbColumnRow {
  schemaName?: string | null;
  tableName?: string | null;
  columnName?: string | null;
}

const SYSTEM_SCHEMAS = ["pg_catalog", "information_schema", "core"];

export class DbCapabilitiesService {
  private readonly snapshotCache = new WeakMap<object, Map<string, Promise<DbSchemaSnapshot>>>();

  snapshot(client: DbCapabilitiesClient, schemaName?: string): Promise<DbSchemaSnapshot> {
    const cacheKey = schemaName ?? "";
    const clientObject = client as object;
    let perClientCache = this.snapshotCache.get(clientObject);

    if (!perClientCache) {
      perClientCache = new Map();
      this.snapshotCache.set(clientObject, perClientCache);
    }

    let promise = perClientCache.get(cacheKey);
    if (!promise) {
      promise = this.loadSnapshot(client, schemaName).catch((error) => {
        perClientCache.delete(cacheKey);
        throw error;
      });
      perClientCache.set(cacheKey, promise);
    }

    return promise;
  }

  snapshotHas(snapshot: DbSchemaSnapshot, requirement: DbCapabilityRequirement): boolean {
    const tableKeys = getRequirementTableKeys(snapshot, requirement.table);
    const matchingTableKey = tableKeys.find((tableKey) => snapshot.tables.has(tableKey));

    if (!matchingTableKey) {
      return false;
    }

    const requiredColumns = requirement.columns ?? [];
    if (requiredColumns.length === 0) {
      return true;
    }

    const availableColumns = snapshot.columns.get(matchingTableKey);
    if (!availableColumns) {
      return false;
    }

    return requiredColumns.every((column) => availableColumns.has(column));
  }

  private async loadSnapshot(
    client: DbCapabilitiesClient,
    schemaName?: string,
  ): Promise<DbSchemaSnapshot> {
    const result = await client.query<DbColumnRow>(
      `
        select
          table_schema as "schemaName",
          table_name as "tableName",
          column_name as "columnName"
        from information_schema.columns
        where ($1::text is null or table_schema = $1)
          and table_schema <> all($2::text[])
        order by table_schema, table_name, ordinal_position
      `,
      [schemaName ?? null, SYSTEM_SCHEMAS],
    );

    const tables = new Set<string>();
    const columns = new Map<string, Set<string>>();

    for (const row of result.rows) {
      if (!row.schemaName || !row.tableName || !row.columnName) {
        continue;
      }

      const tableKey = qualifyTableKey(row.schemaName, row.tableName);
      tables.add(tableKey);

      let tableColumns = columns.get(tableKey);
      if (!tableColumns) {
        tableColumns = new Set();
        columns.set(tableKey, tableColumns);
      }
      tableColumns.add(row.columnName);
    }

    return { tables, columns };
  }
}

function getRequirementTableKeys(
  snapshot: DbSchemaSnapshot,
  table: DbCapabilityRequirement["table"],
): string[] {
  if (typeof table === "string") {
    return [table];
  }

  if (table.schemaName) {
    return [qualifyTableKey(table.schemaName, table.tableName)];
  }

  const matchingKeys = [...snapshot.tables].filter((tableKey) =>
    tableKey.endsWith(`.${table.tableName}`),
  );
  return [table.tableName, ...matchingKeys];
}

function qualifyTableKey(schemaName: string, tableName: string): string {
  return `${schemaName}.${tableName}`;
}
