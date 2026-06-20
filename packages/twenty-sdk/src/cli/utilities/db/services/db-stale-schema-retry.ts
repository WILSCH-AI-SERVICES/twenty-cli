/**
 * Helpers and types for retrying a DB query path once after flushing stale
 * metadata caches. Triggered when PostgreSQL signals that a column or relation
 * referenced in our SQL no longer exists, which strongly suggests our cached
 * metadata snapshot is out of date.
 */

import type { Client } from "pg";

type SchemaVersionFilter = { kind: "metadata-objects" };

export interface StaleSchemaCaches {
  /** Drop the in-process MetadataService.listObjects memoizer. */
  resetMemo(): void;
  /** Drop the on-disk metadata-objects cache entry. */
  clearDisk(filter: SchemaVersionFilter): Promise<unknown>;
  /** Read the schema-version probe stored alongside the metadata cache. */
  readDiskSchemaVersion?(filter: SchemaVersionFilter): Promise<string | undefined>;
  /** Store the first observed schema-version probe alongside the metadata cache. */
  writeDiskSchemaVersion?(filter: SchemaVersionFilter, version: string): Promise<unknown>;
  /** Cheap live probe for the workspace DB schema. */
  probeLiveSchemaVersion?(): Promise<string | undefined>;
}

const STALE_CODES = new Set(["42703", "42P01"]);
const SYSTEM_SCHEMAS = ["pg_catalog", "information_schema", "core"];

function extractStaleCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") {
    return undefined;
  }

  const direct = (error as { code?: unknown }).code;
  if (typeof direct === "string" && STALE_CODES.has(direct)) {
    return direct;
  }

  const cause = (error as { cause?: unknown }).cause;
  if (cause && typeof cause === "object") {
    const causeCode = (cause as { code?: unknown }).code;
    if (typeof causeCode === "string" && STALE_CODES.has(causeCode)) {
      return causeCode;
    }
  }

  return undefined;
}

/**
 * Run `fn` and, on a single occurrence of a stale-schema PostgreSQL error
 * (42703 missing column, 42P01 missing relation), flush the metadata caches
 * and retry exactly once. Any other error, or a second stale failure, is
 * rethrown unchanged.
 */
export async function withStaleSchemaRetry<T>(
  caches: StaleSchemaCaches,
  fn: () => Promise<T>,
): Promise<T> {
  await invalidateIfSchemaVersionChanged(caches);

  try {
    return await fn();
  } catch (error) {
    if (!extractStaleCode(error)) {
      throw error;
    }
    caches.resetMemo();
    await caches.clearDisk({ kind: "metadata-objects" });
    return await fn();
  }
}

export async function probeWorkspaceSchemaVersion(
  client: Pick<Client, "query">,
  schemaName?: string,
): Promise<string | undefined> {
  const result = await client.query<{ version?: string | null }>(
    `
      select md5(
        coalesce(
          string_agg(
            concat_ws(
              ':',
              table_schema,
              table_name,
              column_name,
              data_type,
              udt_name,
              is_nullable,
              ordinal_position::text
            ),
            ',' order by table_schema, table_name, ordinal_position, column_name
          ),
          ''
        )
      ) as "version"
      from information_schema.columns
      where ($1::text is null or table_schema = $1)
        and table_schema <> all($2::text[])
    `,
    [schemaName ?? null, SYSTEM_SCHEMAS],
  );

  const version = result.rows[0]?.version;
  return typeof version === "string" && version.length > 0 ? version : undefined;
}

async function invalidateIfSchemaVersionChanged(caches: StaleSchemaCaches): Promise<void> {
  if (!caches.probeLiveSchemaVersion || !caches.readDiskSchemaVersion) {
    return;
  }

  const filter: SchemaVersionFilter = { kind: "metadata-objects" };
  let liveVersion: string | undefined;

  try {
    liveVersion = await caches.probeLiveSchemaVersion();
  } catch {
    return;
  }

  if (!liveVersion) {
    return;
  }

  let cachedVersion: string | undefined;
  try {
    cachedVersion = await caches.readDiskSchemaVersion(filter);
  } catch {
    cachedVersion = undefined;
  }

  if (cachedVersion === undefined) {
    await caches.writeDiskSchemaVersion?.(filter, liveVersion).catch(() => undefined);
    return;
  }

  if (cachedVersion !== liveVersion) {
    caches.resetMemo();
    await caches.clearDisk(filter);
  }
}
