import type { Client, PoolClient } from "pg";

import type { ObjectMetadata, MetadataService } from "../../metadata/services/metadata.service";
import { DbConnectionError, UnsupportedDbReadError } from "../../readbackend/types";
import type {
  SearchOptions,
  SearchResponse,
  SearchResult,
} from "../../search/services/api-search.service";
import type { ResolvedDbConfig } from "./db-config-resolver.service";
import { DbConnectionService } from "./db-connection.service";
import { DbMetadataPlannerService } from "./db-metadata-planner.service";
import { decodeSearchCursor, encodeSearchCursor, type SearchCursor } from "./db-search-cursor";
import {
  joinLabelParts,
  resolveSearchProjection,
  type SearchProjection,
} from "./db-search-projection";
import { formatSearchTerms } from "./db-search-terms";
import { quoteIdentifier, quoteTableReference, type DbTableReference } from "./db-sql-identifiers";
import {
  probeWorkspaceSchemaVersion,
  withStaleSchemaRetry,
  type StaleSchemaCaches,
} from "./db-stale-schema-retry";
import { DbTableResolverService } from "./db-table-resolver.service";

type MetadataClient = Pick<MetadataService, "listObjects" | "resetListObjectsCache">;
type MetadataPlanner = Pick<DbMetadataPlannerService, "planObject">;
type DbConnector = Pick<DbConnectionService, "withClient">;
type TableResolver = Pick<DbTableResolverService, "resolve">;
type StaleSchemaDiskCache = {
  clear(filter: { kind: "metadata-objects" }): Promise<unknown>;
  readSchemaSourceVersion?(kind: "metadata-objects"): Promise<string | undefined>;
  writeSchemaSourceVersion?(
    kind: "metadata-objects",
    sourceSchemaVersion: string,
  ): Promise<unknown>;
};

/**
 * The maximum label-part count across all known field types. FULL_NAME yields
 * two parts (firstName + lastName); every other type yields one. Each UNION
 * ALL leg pads its labelPart columns to this count with NULL::text so all
 * legs project the same shape.
 */
const MAX_LABEL_PARTS = 2;

interface DbSearchRow {
  objectName: string;
  recordId: string;
  imageRaw: string | null;
  tsRankCD: number | string;
  tsRank: number | string;
  // labelPart0, labelPart1, ... — every leg projects MAX_LABEL_PARTS columns.
  [key: `labelPart${number}`]: string | null | undefined;
}

interface ResolvedSearchObject {
  objectName: string;
  table: DbTableReference;
  objectMetadata: ObjectMetadata;
  projection: SearchProjection;
}

export class DbSearchService {
  private readonly metadataPlanner: MetadataPlanner;
  private readonly dbConnectionService: DbConnector;
  private readonly tableResolver: TableResolver;
  private readonly schemaCache?: StaleSchemaDiskCache;
  private unaccentProbePromise?: Promise<void>;

  constructor(
    private readonly metadataService: MetadataClient,
    metadataPlanner?: MetadataPlanner,
    dbConnectionService?: DbConnector,
    tableResolver?: TableResolver,
    schemaCache?: StaleSchemaDiskCache,
  ) {
    this.metadataPlanner =
      metadataPlanner ?? new DbMetadataPlannerService(metadataService as MetadataService);
    this.dbConnectionService = dbConnectionService ?? new DbConnectionService();
    this.tableResolver = tableResolver ?? new DbTableResolverService();
    this.schemaCache = schemaCache;
  }

  private staleSchemaCachesFor(target: ResolvedDbConfig): StaleSchemaCaches {
    return {
      resetMemo: () => this.metadataService.resetListObjectsCache(),
      clearDisk: (filter) => this.schemaCache?.clear(filter) ?? Promise.resolve(),
      readDiskSchemaVersion: this.schemaCache?.readSchemaSourceVersion
        ? (filter) => this.schemaCache!.readSchemaSourceVersion!(filter.kind)
        : undefined,
      writeDiskSchemaVersion: this.schemaCache?.writeSchemaSourceVersion
        ? (filter, version) => this.schemaCache!.writeSchemaSourceVersion!(filter.kind, version)
        : undefined,
      probeLiveSchemaVersion:
        this.schemaCache?.readSchemaSourceVersion && this.schemaCache.writeSchemaSourceVersion
          ? () => this.probeLiveSchemaVersion(target)
          : undefined,
    };
  }

  private async ensureUnaccentImmutable(client: PoolClient): Promise<void> {
    if (!this.unaccentProbePromise) {
      this.unaccentProbePromise = (async () => {
        const result = await client.query(
          `SELECT 1 AS ok FROM pg_proc WHERE proname = 'unaccent_immutable' AND pronamespace::regnamespace::text = 'public' LIMIT 1`,
        );
        if (result.rows.length === 0) {
          throw new UnsupportedDbReadError(
            "DB search requires public.unaccent_immutable; falling back to API",
          );
        }
      })().catch((error) => {
        this.unaccentProbePromise = undefined;
        throw error;
      });
    }
    return this.unaccentProbePromise;
  }

  async search(target: ResolvedDbConfig, options: SearchOptions): Promise<SearchResponse> {
    if (options.filter) {
      throw new UnsupportedDbReadError("DB search does not support filters.");
    }

    const query = options.query.trim();

    if (!query) {
      return emptySearchResponse();
    }

    const connectionOptions = resolveConnectionOptions(target);
    const cursor = parseIncomingCursor(options.after);
    const limit = options.limit ?? 20;
    const fetchLimit = limit + 1;

    return await withStaleSchemaRetry(this.staleSchemaCachesFor(target), async () => {
      const objectNames = await this.resolveSearchObjects(options);

      if (objectNames.length === 0) {
        return emptySearchResponse();
      }

      return await this.withConnection(connectionOptions, async (client) => {
        await this.ensureUnaccentImmutable(client);

        const resolved = await this.resolveSearchableObjects(client, target, objectNames);

        if (resolved.length === 0) {
          return emptySearchResponse();
        }

        const rows = await this.executeUnionSearch(client, resolved, query, fetchLimit, cursor);

        const objectByName = new Map<string, ResolvedSearchObject>();
        for (const entry of resolved) {
          objectByName.set(entry.objectName, entry);
        }

        const allResults: SearchResult[] = rows.map((row) => {
          const entry = objectByName.get(row.objectName);
          const objectMetadata = entry?.objectMetadata;
          const objectNameSingular = objectMetadata?.nameSingular ?? row.objectName;
          const objectLabelSingular = objectMetadata
            ? getObjectLabel(objectMetadata, objectNameSingular)
            : objectNameSingular.charAt(0).toUpperCase() + objectNameSingular.slice(1);
          const labelColumnCount = entry?.projection.labelColumns.length ?? MAX_LABEL_PARTS;
          const labelParts: Array<string | null | undefined> = [];
          for (let i = 0; i < labelColumnCount; i += 1) {
            labelParts.push(row[`labelPart${i}`] ?? null);
          }
          const label = joinLabelParts(labelParts) || row.recordId;

          return {
            recordId: row.recordId,
            objectNameSingular,
            objectLabelSingular,
            label,
            imageUrl: normalizeImageUrl(row.imageRaw),
            tsRankCD: toNumber(row.tsRankCD),
            tsRank: toNumber(row.tsRank),
          };
        });

        const hasNextPage = allResults.length > limit;
        const emittedResults = hasNextPage ? allResults.slice(0, limit) : allResults;
        const data = attachCursors(emittedResults, cursor);
        const endCursor = data[data.length - 1]?.cursor;

        return {
          data,
          pageInfo: {
            hasNextPage,
            endCursor,
          },
        };
      });
    });
  }

  private async probeLiveSchemaVersion(target: ResolvedDbConfig): Promise<string | undefined> {
    const connectionOptions = resolveConnectionOptions(target);
    return await this.dbConnectionService.withClient(connectionOptions, (client) =>
      probeWorkspaceSchemaVersion(client, target.databaseSchema),
    );
  }

  private async resolveSearchableObjects(
    client: PoolClient,
    target: ResolvedDbConfig,
    objectNames: string[],
  ): Promise<ResolvedSearchObject[]> {
    const resolved: ResolvedSearchObject[] = [];

    for (const objectName of objectNames) {
      try {
        const plan = await this.metadataPlanner.planObject(objectName);
        const table = await this.tableResolver.resolve(client, target, plan.tableName);
        const projection = resolveSearchProjection(plan.objectMetadata);

        resolved.push({
          objectName: plan.objectMetadata.nameSingular ?? objectName,
          table,
          objectMetadata: plan.objectMetadata,
          projection,
        });
      } catch (error) {
        if (error instanceof UnsupportedDbReadError) {
          continue;
        }

        throw error;
      }
    }

    return resolved;
  }

  private async executeUnionSearch(
    client: Pick<Client, "query">,
    resolved: ResolvedSearchObject[],
    query: string,
    fetchLimit: number,
    cursor: SearchCursor | null,
  ): Promise<DbSearchRow[]> {
    const { sql, params } = buildUnionAllSearchSql({
      objects: resolved,
      query,
      perObjectLimit: fetchLimit,
      totalLimit: fetchLimit,
      cursor,
    });
    const result = await client.query(sql, params);

    return result.rows as DbSearchRow[];
  }

  private async resolveSearchObjects(options: SearchOptions): Promise<string[]> {
    if (options.objects?.length) {
      return applyExcludedObjects(options.objects, options.excludeObjects);
    }

    const objects = await this.metadataService.listObjects();
    const names = objects
      .map((objectMetadata) => objectMetadata.nameSingular)
      .filter((value): value is string => typeof value === "string" && value.length > 0);

    return applyExcludedObjects(names, options.excludeObjects);
  }

  private async withConnection<T>(
    connectionOptions: ReturnType<typeof resolveConnectionOptions>,
    fn: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    try {
      return await this.dbConnectionService.withClient(connectionOptions, fn);
    } catch (error) {
      if (error instanceof UnsupportedDbReadError) {
        throw error;
      }
      throw new DbConnectionError("DB search is unavailable.", { cause: error });
    }
  }
}

function resolveConnectionOptions(target: ResolvedDbConfig) {
  const databaseUrl = target.databaseUrl;

  if (!databaseUrl) {
    throw new UnsupportedDbReadError("DB search requires a resolved database URL.");
  }

  return {
    databaseUrl,
  };
}

function applyExcludedObjects(objects: string[], excludeObjects?: string[]): string[] {
  const excluded = new Set((excludeObjects ?? []).map((value) => value.toLowerCase()));
  const seen = new Set<string>();
  const results: string[] = [];

  for (const objectName of objects) {
    const normalized = objectName.toLowerCase();

    if (excluded.has(normalized) || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    results.push(objectName);
  }

  return results;
}

function parseIncomingCursor(after?: string): SearchCursor | null {
  if (after === undefined || after === null || after === "") {
    return null;
  }

  const decoded = decodeSearchCursor(after);

  if (decoded === null) {
    throw new UnsupportedDbReadError(`DB search does not support cursor ${JSON.stringify(after)}.`);
  }

  return decoded;
}

/**
 * Walk the emitted results in order and attach a per-row cursor that mirrors
 * Twenty's API edge-cursor format. Each cursor captures the running snapshot
 * of `lastRecordIdsPerObject` AT THAT POINT in the result stream — i.e. the
 * cursor for row N includes the recordIds of every object that has appeared
 * in rows 0..N (one entry per object, the latest seen).
 *
 * Reference: Twenty's `computeEdges` (`search.service.ts:614-649`).
 */
function attachCursors(
  results: SearchResult[],
  incomingCursor: SearchCursor | null,
): SearchResult[] {
  const lastRecordIdsPerObject: Record<string, string | undefined> = {
    ...(incomingCursor?.lastRecordIdsPerObject ?? {}),
  };

  return results.map((result) => {
    lastRecordIdsPerObject[result.objectNameSingular] = result.recordId;

    const cursor: SearchCursor = {
      lastRanks: { tsRankCD: result.tsRankCD, tsRank: result.tsRank },
      lastRecordIdsPerObject: { ...lastRecordIdsPerObject },
    };

    return {
      ...result,
      cursor: encodeSearchCursor(cursor),
    };
  });
}

function emptySearchResponse(): SearchResponse {
  return {
    data: [],
    pageInfo: {
      hasNextPage: false,
      endCursor: undefined,
    },
  };
}

function getObjectLabel(objectMetadata: ObjectMetadata, fallback: string): string {
  const labelSingular = objectMetadata.labelSingular;

  if (typeof labelSingular === "string" && labelSingular.trim().length > 0) {
    return labelSingular;
  }

  return fallback.charAt(0).toUpperCase() + fallback.slice(1);
}

function buildUnionAllSearchSql(args: {
  objects: ResolvedSearchObject[];
  query: string;
  perObjectLimit: number;
  totalLimit: number;
  cursor: SearchCursor | null;
}): { sql: string; params: unknown[] } {
  const hasCursor = args.cursor !== null;
  const legs = args.objects.map((entry) => buildUnionLeg(entry, hasCursor));
  const ranked = legs.join("\n      UNION ALL\n");

  const sql = `
    WITH ranked AS (
${ranked}
    )
    SELECT * FROM ranked
    ORDER BY "tsRankCD" DESC, "tsRank" DESC, "objectName" ASC, "recordId" ASC
    LIMIT $4
  `;

  const params: unknown[] = [
    formatSearchTerms(args.query, "and"),
    formatSearchTerms(args.query, "or"),
    args.perObjectLimit,
    args.totalLimit,
  ];

  if (hasCursor && args.cursor !== null) {
    // $5 = lastRanks.tsRankCD
    // $6 = lastRanks.tsRank
    // $7 = lastRecordIdsPerObject as JSONB; per-leg id lookup uses
    // `coalesce(($7::jsonb)->>'<objectName>', '')` so an object missing from
    // the cursor matches all rows for the equal-ranks tie-break (UUIDs are
    // always non-empty strings, so `id::text > ''` is true).
    params.push(args.cursor.lastRanks.tsRankCD);
    params.push(args.cursor.lastRanks.tsRank);
    params.push(JSON.stringify(args.cursor.lastRecordIdsPerObject));
  }

  return { sql, params };
}

function buildUnionLeg(entry: ResolvedSearchObject, hasCursor: boolean): string {
  const tableSql = quoteTableReference(entry.table);
  const labelPartsSql = buildLabelPartsForUnion(entry.projection, MAX_LABEL_PARTS);
  const imageColumnSql = entry.projection.imageColumn
    ? `t.${quoteIdentifier(entry.projection.imageColumn)}::text`
    : "NULL::text";
  const objectNameSql = `'${escapeSqlLiteral(entry.objectName)}'::text AS "objectName"`;
  const cursorWhereSql = hasCursor ? buildCursorWhereSql(entry.objectName) : "";

  // Per-leg ORDER BY + LIMIT must be wrapped in parentheses to be valid as a
  // UNION ALL branch in PostgreSQL.
  return `      (SELECT
        ${objectNameSql},
        t."id"::text AS "recordId",
        ${labelPartsSql},
        ${imageColumnSql} AS "imageRaw",
        ts_rank_cd(t."searchVector", to_tsquery('simple', public.unaccent_immutable($1))) AS "tsRankCD",
        ts_rank   (t."searchVector", to_tsquery('simple', public.unaccent_immutable($2))) AS "tsRank"
      FROM ${tableSql} AS t
      WHERE t."deletedAt" IS NULL
        AND ( t."searchVector" @@ to_tsquery('simple', public.unaccent_immutable($1))
           OR t."searchVector" @@ to_tsquery('simple', public.unaccent_immutable($2)) )${cursorWhereSql}
      ORDER BY "tsRankCD" DESC, "tsRank" DESC, "recordId" ASC
      LIMIT $3)`;
}

/**
 * Mirrors Twenty's `computeCursorWhereCondition` (`search.service.ts:419-465`)
 * three-bracket comparator:
 *
 *   tsRankCD < $5
 *   OR (tsRankCD = $5 AND tsRank < $6)
 *   OR (tsRankCD = $5 AND tsRank = $6 AND id::text > <perObjectIdFromJson>)
 *
 * `<perObjectIdFromJson>` extracts the cursor's recordId for THIS leg's
 * `objectName` from the JSON cursor blob bound at $7. When the cursor doesn't
 * have an entry for this object, the JSON-extract returns NULL → coalesced to
 * '' → `id::text > ''` which matches every (non-empty) UUID, equivalent to
 * Twenty's behaviour of omitting the id-comparator when `lastRecordId` is
 * undefined.
 */
function buildCursorWhereSql(objectName: string): string {
  const idLookup = `coalesce(($7::jsonb)->>'${escapeSqlLiteral(objectName)}', '')`;
  const tsRankCDExpr = `ts_rank_cd(t."searchVector", to_tsquery('simple', public.unaccent_immutable($1)))`;
  const tsRankExpr = `ts_rank   (t."searchVector", to_tsquery('simple', public.unaccent_immutable($2)))`;

  return `
        AND (
              ${tsRankCDExpr} < $5
           OR ( ${tsRankCDExpr} = $5 AND ${tsRankExpr} < $6 )
           OR ( ${tsRankCDExpr} = $5 AND ${tsRankExpr} = $6 AND t."id"::text > ${idLookup} )
        )`;
}

function buildLabelPartsForUnion(projection: SearchProjection, maxParts: number): string {
  const parts: string[] = [];

  for (let i = 0; i < maxParts; i += 1) {
    const labelColumn = projection.labelColumns[i];
    if (labelColumn !== undefined) {
      parts.push(`t.${quoteIdentifier(labelColumn)}::text AS "labelPart${i}"`);
    } else {
      parts.push(`NULL::text AS "labelPart${i}"`);
    }
  }

  return parts.join(",\n        ");
}

function escapeSqlLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

function normalizeImageUrl(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();

  return trimmed.length > 0 ? trimmed : null;
}

function toNumber(value: number | string | undefined): number {
  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "string" && value.length > 0) {
    return Number(value);
  }

  return 0;
}
