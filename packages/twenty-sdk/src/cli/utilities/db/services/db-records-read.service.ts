import type { Client, PoolClient } from "pg";

import type {
  FieldMetadata,
  MetadataService,
  ObjectMetadata,
} from "../../metadata/services/metadata.service";
import { DbConnectionError, UnsupportedDbReadError } from "../../readbackend/types";
import type {
  GetOptions,
  GroupByParams,
  ListOptions,
  ListResponse,
} from "../../records/services/api-records-read.service";
import { DbCapabilitiesService, type DbCapabilityRequirement } from "./db-capabilities.service";
import type { ResolvedDbConfig } from "./db-config-resolver.service";
import { DbConnectionService } from "./db-connection.service";
import { DbFilterCompilerService, type DbFilterClause } from "./db-filter-compiler.service";
import { DbMetadataPlannerService, type DbRelationPlan } from "./db-metadata-planner.service";
import { decodeRecordCursor, type RecordListCursor } from "./db-records-cursor";
import {
  parseSupportedGroupByRequest,
  type SupportedDbGroupByRequest,
} from "./db-records-groupby-parse";
import {
  buildEndCursor,
  buildListWhereClause,
  buildOrderByForKeyset,
  quoteColumn,
} from "./db-records-sql";
import { quoteIdentifier, quoteTableReference, type DbTableReference } from "./db-sql-identifiers";
import {
  probeWorkspaceSchemaVersion,
  withStaleSchemaRetry,
  type StaleSchemaCaches,
} from "./db-stale-schema-retry";
import { DbTableResolverService } from "./db-table-resolver.service";

type MetadataClient = Pick<MetadataService, "listObjects" | "getObject" | "resetListObjectsCache">;
type MetadataPlanner = Pick<DbMetadataPlannerService, "planObject">;
type FilterCompiler = Pick<DbFilterCompilerService, "compile">;
type DbConnector = Pick<DbConnectionService, "withClient">;
type TableResolver = Pick<DbTableResolverService, "resolve">;
type Capabilities = Pick<DbCapabilitiesService, "snapshot" | "snapshotHas">;
type StaleSchemaDiskCache = {
  clear(filter: { kind: "metadata-objects" }): Promise<unknown>;
  readSchemaSourceVersion?(kind: "metadata-objects"): Promise<string | undefined>;
  writeSchemaSourceVersion?(
    kind: "metadata-objects",
    sourceSchemaVersion: string,
  ): Promise<unknown>;
};

interface DbCountRow {
  totalCount: number | string;
}

interface DbRecordRow {
  rowData: unknown;
}

interface DbGroupByRow extends Record<string, unknown> {
  countNotEmptyId?: number | string;
}

const DEFAULT_LIST_LIMIT = 20;
const SIMPLE_IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const COMPOSITE_FIELD_SUFFIXES: Record<string, string[]> = {
  ADDRESS: [
    "AddressStreet1",
    "AddressStreet2",
    "AddressCity",
    "AddressState",
    "AddressCountry",
    "AddressPostcode",
    "AddressLat",
    "AddressLng",
  ],
  ACTOR: ["Source", "WorkspaceMemberId", "Name", "Context"],
  CURRENCY: ["AmountMicros", "CurrencyCode"],
  EMAILS: ["PrimaryEmail", "AdditionalEmails"],
  FULL_NAME: ["FirstName", "LastName"],
  LINKS: ["PrimaryLinkLabel", "PrimaryLinkUrl", "SecondaryLinks"],
  PHONES: [
    "PrimaryPhoneNumber",
    "PrimaryPhoneCountryCode",
    "PrimaryPhoneCallingCode",
    "AdditionalPhones",
  ],
};
const ADDRESS_EMPTY_STRING_SUFFIXES = new Set([
  "AddressStreet1",
  "AddressStreet2",
  "AddressCity",
  "AddressState",
  "AddressCountry",
  "AddressPostcode",
]);
const LINKS_EMPTY_STRING_SUFFIXES = new Set(["PrimaryLinkLabel", "PrimaryLinkUrl"]);
const COMPOSITE_EMPTY_STRING_SUFFIXES: Record<string, Set<string>> = {
  ADDRESS: ADDRESS_EMPTY_STRING_SUFFIXES,
  EMAILS: new Set(["PrimaryEmail"]),
  FULL_NAME: new Set(["FirstName", "LastName"]),
  LINKS: LINKS_EMPTY_STRING_SUFFIXES,
  PHONES: new Set(["PrimaryPhoneNumber", "PrimaryPhoneCountryCode", "PrimaryPhoneCallingCode"]),
};
const COMPOSITE_EMPTY_ARRAY_SUFFIXES: Record<string, Set<string>> = {
  EMAILS: new Set(["AdditionalEmails"]),
  LINKS: new Set(["SecondaryLinks"]),
  PHONES: new Set(["AdditionalPhones"]),
};
/**
 * Default sort field when the caller doesn't pass `--sort`. We keep parity with
 * the existing ORDER BY: when no sort is provided, list rows are ordered by
 * `id ASC`. Keyset pagination uses the same field so the cursor is stable.
 */
const DEFAULT_SORT_FIELD = "id";
const DEFAULT_SORT_DIRECTION: "asc" | "desc" = "asc";

export class DbRecordsReadService {
  private readonly metadataService: MetadataClient;
  private readonly metadataPlanner: MetadataPlanner;
  private readonly filterCompiler: FilterCompiler;
  private readonly dbConnectionService: DbConnector;
  private readonly tableResolver: TableResolver;
  private readonly schemaCache?: StaleSchemaDiskCache;
  private readonly capabilities?: Capabilities;

  constructor(
    metadataService: MetadataClient,
    metadataPlanner?: MetadataPlanner,
    filterCompiler?: FilterCompiler,
    dbConnectionService?: DbConnector,
    tableResolver?: TableResolver,
    schemaCache?: StaleSchemaDiskCache,
    capabilities?: Capabilities,
  ) {
    this.metadataService = metadataService;
    this.metadataPlanner =
      metadataPlanner ?? new DbMetadataPlannerService(metadataService as MetadataService);
    this.filterCompiler = filterCompiler ?? new DbFilterCompilerService();
    this.dbConnectionService = dbConnectionService ?? new DbConnectionService();
    this.tableResolver = tableResolver ?? new DbTableResolverService();
    this.schemaCache = schemaCache;
    this.capabilities = capabilities;
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

  async list(
    target: ResolvedDbConfig,
    object: string,
    options: ListOptions = {},
  ): Promise<ListResponse> {
    assertSupportedListOptions(options);

    const connectionOptions = resolveConnectionOptions(target);

    return await withStaleSchemaRetry(this.staleSchemaCachesFor(target), async () => {
      const plan = await this.metadataPlanner.planObject(object, { include: options.include });
      const clauses = this.filterCompiler.compile(options.filter);
      const limit = resolveLimit(options.limit);
      const cursor = parseRecordCursor(options.cursor);
      const { sortField, sortDirection } = resolveSortContext(options.sort, options.order, cursor);

      return await this.withConnection(connectionOptions, "list", async (client) => {
        const table = await this.tableResolver.resolve(client, target, plan.tableName);
        await this.assertCapabilities(
          client,
          table,
          buildObjectCapabilityRequirement(table, plan.objectMetadata, [
            ...clauses.map((clause) => clause.field),
            sortField,
          ]),
        );
        return await this.listOnConnection(client, table, clauses, plan.objectMetadata, {
          limit,
          cursor,
          sortField,
          sortDirection,
          totalCount: options.totalCount === true,
        });
      });
    });
  }

  async listAll(
    target: ResolvedDbConfig,
    object: string,
    options: ListOptions = {},
  ): Promise<ListResponse> {
    assertSupportedListOptions(options);

    const connectionOptions = resolveConnectionOptions(target);

    return await withStaleSchemaRetry(this.staleSchemaCachesFor(target), async () => {
      const plan = await this.metadataPlanner.planObject(object, { include: options.include });
      const clauses = this.filterCompiler.compile(options.filter);
      const limit = resolveLimit(options.limit);
      const totalCountRequested = options.totalCount === true;
      const initialCursor = parseRecordCursor(options.cursor);
      const { sortField, sortDirection } = resolveSortContext(
        options.sort,
        options.order,
        initialCursor,
      );

      return await this.withConnection(connectionOptions, "list", async (client) => {
        const table = await this.tableResolver.resolve(client, target, plan.tableName);
        await this.assertCapabilities(
          client,
          table,
          buildObjectCapabilityRequirement(table, plan.objectMetadata, [
            ...clauses.map((clause) => clause.field),
            sortField,
          ]),
        );
        const all: unknown[] = [];
        let cursor = initialCursor;
        let totalCount: number | undefined;
        let pageInfo: ListResponse["pageInfo"];

        while (true) {
          const response = await this.listOnConnection(
            client,
            table,
            clauses,
            plan.objectMetadata,
            {
              limit,
              cursor,
              sortField,
              sortDirection,
              totalCount: totalCountRequested,
            },
          );
          all.push(...response.data);
          totalCount = response.totalCount ?? totalCount;
          pageInfo = response.pageInfo;

          if (!pageInfo?.hasNextPage || !pageInfo.endCursor) {
            break;
          }

          // Decode the cursor we just emitted so the next iteration's keyset
          // WHERE clause uses the freshly captured (sortValue, id) tuple.
          cursor = decodeRecordCursor(pageInfo.endCursor);

          if (cursor === null) {
            // Defensive: an end-cursor we just produced should always decode.
            break;
          }
        }

        return {
          data: all,
          totalCount,
          pageInfo,
        };
      });
    });
  }

  async get(
    target: ResolvedDbConfig,
    object: string,
    id: string,
    options?: GetOptions,
  ): Promise<unknown> {
    const connectionOptions = resolveConnectionOptions(target);

    return await withStaleSchemaRetry(this.staleSchemaCachesFor(target), async () => {
      const plan = await this.metadataPlanner.planObject(object, { include: options?.include });

      return await this.withConnection(connectionOptions, "get", async (client) => {
        const table = await this.tableResolver.resolve(client, target, plan.tableName);
        await this.assertCapabilities(
          client,
          table,
          buildObjectCapabilityRequirement(
            table,
            plan.objectMetadata,
            plan.includes.map((include) => include.joinColumnName),
          ),
        );

        if (plan.includes.length === 0) {
          return await this.queryRecordById(client, table, id, plan.objectMetadata);
        }

        const includeTables: Array<{ plan: DbRelationPlan; table: DbTableReference }> = [];
        for (const relationPlan of plan.includes) {
          const includeTable = await this.tableResolver.resolve(
            client,
            target,
            relationPlan.tableName,
          );
          await this.assertCapabilities(
            client,
            includeTable,
            buildObjectCapabilityRequirement(includeTable, relationPlan.objectMetadata),
          );
          includeTables.push({
            plan: relationPlan,
            table: includeTable,
          });
        }

        return await this.queryRecordWithIncludes(
          client,
          table,
          plan.objectMetadata,
          includeTables,
          id,
        );
      });
    });
  }

  async groupBy(
    target: ResolvedDbConfig,
    object: string,
    payload?: unknown,
    params?: GroupByParams,
  ): Promise<unknown> {
    const request = parseSupportedGroupByRequest(payload, params);
    const connectionOptions = resolveConnectionOptions(target);

    return await withStaleSchemaRetry(this.staleSchemaCachesFor(target), async () => {
      const plan = await this.metadataPlanner.planObject(object);
      const clauses = this.filterCompiler.compile(request.filter);

      return await this.withConnection(connectionOptions, "groupBy", async (client) => {
        const table = await this.tableResolver.resolve(client, target, plan.tableName);
        await this.assertCapabilities(client, table, {
          table,
          columns: uniqueStrings([...request.fields, ...clauses.map((clause) => clause.field)]),
        });
        return await this.queryGroupByRows(client, table, request, clauses);
      });
    });
  }

  private async listOnConnection(
    client: Pick<Client, "query">,
    table: DbTableReference,
    clauses: DbFilterClause[],
    objectMetadata: ObjectMetadata,
    options: {
      limit: number;
      cursor: RecordListCursor | null;
      sortField: string;
      sortDirection: "asc" | "desc";
      totalCount: boolean;
    },
  ): Promise<ListResponse> {
    if (options.totalCount) {
      const page = await this.queryListPageWithCount(client, table, clauses, options);
      const totalCount =
        page.rows.length > 0 ? page.totalCount : await this.queryTotalCount(client, table, clauses);
      const rawData = page.rows.slice(0, options.limit);
      const data = rawData.map((row) => mapUnknownRecordToApiShape(row, objectMetadata));
      const hasNextPage = page.rows.length > options.limit;
      const lastRow = rawData[rawData.length - 1];
      const endCursor = buildEndCursor(lastRow, options.sortField, options.sortDirection);

      return {
        data,
        totalCount,
        pageInfo: {
          hasNextPage,
          endCursor,
        },
      };
    }

    const page = await this.queryListPage(client, table, clauses, options);
    const rawData = page.rows.slice(0, options.limit);
    const data = rawData.map((row) => mapUnknownRecordToApiShape(row, objectMetadata));
    const hasNextPage = page.rows.length > options.limit;
    const lastRow = rawData[rawData.length - 1];
    const endCursor = buildEndCursor(lastRow, options.sortField, options.sortDirection);

    return {
      data,
      pageInfo: {
        hasNextPage,
        endCursor,
      },
    };
  }

  private async queryTotalCount(
    client: Pick<Client, "query">,
    table: DbTableReference,
    clauses: DbFilterClause[],
  ): Promise<number> {
    const { whereSql, params } = buildListWhereClause(clauses, null);
    const result = await client.query<DbCountRow>(
      `
        select count(*)::text as "totalCount"
        from ${quoteTableReference(table)} as t
        ${whereSql}
      `,
      params,
    );

    return toNumber(result.rows[0]?.totalCount);
  }

  private async queryListPage(
    client: Pick<Client, "query">,
    table: DbTableReference,
    clauses: DbFilterClause[],
    options: {
      limit: number;
      cursor: RecordListCursor | null;
      sortField: string;
      sortDirection: "asc" | "desc";
    },
  ): Promise<{ rows: unknown[] }> {
    const { whereSql, params } = buildListWhereClause(clauses, options.cursor);
    const orderBy = buildOrderByForKeyset(options.sortField, options.sortDirection);
    const fetchLimit = options.limit + 1;
    const result = await client.query<DbRecordRow>(
      `
        select to_jsonb(t) as "rowData"
        from ${quoteTableReference(table)} as t
        ${whereSql}
        ${orderBy}
        limit $${params.length + 1}
      `,
      [...params, fetchLimit],
    );

    return {
      rows: result.rows.map((row) => row.rowData),
    };
  }

  private async queryListPageWithCount(
    client: Pick<Client, "query">,
    table: DbTableReference,
    clauses: DbFilterClause[],
    options: {
      limit: number;
      cursor: RecordListCursor | null;
      sortField: string;
      sortDirection: "asc" | "desc";
    },
  ): Promise<{ rows: unknown[]; totalCount: number }> {
    const { whereSql, params } = buildListWhereClause(clauses, options.cursor);
    const orderBy = buildOrderByForKeyset(options.sortField, options.sortDirection);
    const fetchLimit = options.limit + 1;
    const result = await client.query<DbRecordRow & { totalCount: string }>(
      `
        select to_jsonb(t) as "rowData", (count(*) over ())::text as "totalCount"
        from ${quoteTableReference(table)} as t
        ${whereSql}
        ${orderBy}
        limit $${params.length + 1}
      `,
      [...params, fetchLimit],
    );

    return {
      rows: result.rows.map((row) => row.rowData),
      totalCount: toNumber(result.rows[0]?.totalCount),
    };
  }

  private async queryRecordById(
    client: Pick<Client, "query">,
    table: DbTableReference,
    id: string,
    objectMetadata: ObjectMetadata,
  ): Promise<Record<string, unknown> | undefined> {
    const result = await client.query<DbRecordRow>(
      `
        select to_jsonb(t) as "rowData"
        from ${quoteTableReference(table)} as t
        where t."id" = $1
        limit 1
      `,
      [id],
    );

    const record = asRecord(result.rows[0]?.rowData);
    return record ? mapRecordToApiShape(record, objectMetadata) : undefined;
  }

  private async queryGroupByRows(
    client: Pick<Client, "query">,
    table: DbTableReference,
    request: SupportedDbGroupByRequest,
    clauses: DbFilterClause[],
  ): Promise<Array<Record<string, unknown>>> {
    const { whereSql, params } = buildListWhereClause(clauses, null);
    const fields = request.fields.map((field) => quoteColumn(field));
    const selectSql = fields
      .map((field, index) => `${field} as ${quoteIdentifier(getGroupByAlias(index))}`)
      .join(", ");
    const aggregateSql = request.aggregateField
      ? `, count(*)::text as "${request.aggregateField}"`
      : "";
    const groupBySql = fields.join(", ");
    const orderBySql = fields.map((field) => `${field} asc nulls first`).join(", ");
    const result = await client.query<DbGroupByRow>(
      `
        select ${selectSql}${aggregateSql}
        from ${quoteTableReference(table)} as t
        ${whereSql}
        group by ${groupBySql}
        order by ${orderBySql}
        limit $${params.length + 1}
      `,
      [...params, request.limit],
    );

    return result.rows.map((row) => {
      const group: Record<string, unknown> = {
        groupByDimensionValues: request.fields.map((_, index) => row[getGroupByAlias(index)]),
      };

      if (request.aggregateField) {
        group[request.aggregateField] = row[request.aggregateField] ?? null;
      }

      return group;
    });
  }

  private async queryRecordWithIncludes(
    client: Pick<Client, "query">,
    baseTable: DbTableReference,
    baseObjectMetadata: ObjectMetadata,
    includes: Array<{ plan: DbRelationPlan; table: DbTableReference }>,
    id: string,
  ): Promise<Record<string, unknown> | undefined> {
    const includeSelectFragments = includes
      .map(
        (_, index) =>
          `, to_jsonb(${quoteIdentifier(`rel_${index}`)}) as ${quoteIdentifier(`rel_${index}`)}`,
      )
      .join("");
    const includeJoinFragments = includes
      .map(
        (include, index) => `
          left join lateral (
            select * from ${quoteTableReference(include.table)} as r
            where r."id" = t.${quoteIdentifier(include.plan.joinColumnName)}
            limit 1
          ) as ${quoteIdentifier(`rel_${index}`)} on true`,
      )
      .join("");

    const result = await client.query<Record<string, unknown> & { rowData: unknown }>(
      `
        select to_jsonb(t) as "rowData"${includeSelectFragments}
        from ${quoteTableReference(baseTable)} as t
        ${includeJoinFragments}
        where t."id" = $1
        limit 1
      `,
      [id],
    );

    const row = result.rows[0];
    const baseRecord = asRecord(row?.rowData);

    if (!baseRecord) {
      return undefined;
    }

    const merged: Record<string, unknown> = mapRecordToApiShape(baseRecord, baseObjectMetadata);
    includes.forEach((include, index) => {
      if (!hasOwn(baseRecord, include.plan.joinColumnName)) {
        throw new UnsupportedDbReadError(
          `DB get does not support include hydration for relation ${JSON.stringify(include.plan.relationName)} because ${JSON.stringify(include.plan.joinColumnName)} is not present on the base row.`,
        );
      }

      const relationRow = (row as Record<string, unknown> | undefined)?.[`rel_${index}`];
      const relationRecord = asRecord(relationRow);
      merged[include.plan.relationName] = relationRecord
        ? mapRecordToApiShape(relationRecord, include.plan.objectMetadata)
        : null;
    });

    return merged;
  }

  private async withConnection<T>(
    connectionOptions: ReturnType<typeof resolveConnectionOptions>,
    operation: "list" | "get" | "groupBy",
    fn: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    try {
      return await this.dbConnectionService.withClient(connectionOptions, fn);
    } catch (error) {
      if (error instanceof UnsupportedDbReadError) {
        throw error;
      }
      throw new DbConnectionError(resolveRecordsOperationUnavailableMessage(operation), {
        cause: error,
      });
    }
  }

  private async assertCapabilities(
    client: Pick<Client, "query">,
    table: DbTableReference,
    requirement: DbCapabilityRequirement,
  ): Promise<void> {
    if (!this.capabilities) {
      return;
    }

    const snapshot = await this.capabilities.snapshot(client, table.schemaName);
    if (!this.capabilities.snapshotHas(snapshot, requirement)) {
      throw new UnsupportedDbReadError(
        `DB capability gap for table ${JSON.stringify(table.tableName)}.`,
      );
    }
  }

  private async probeLiveSchemaVersion(target: ResolvedDbConfig): Promise<string | undefined> {
    const connectionOptions = resolveConnectionOptions(target);
    return await this.dbConnectionService.withClient(connectionOptions, (client) =>
      probeWorkspaceSchemaVersion(client, target.databaseSchema),
    );
  }
}

function buildObjectCapabilityRequirement(
  table: DbTableReference,
  _objectMetadata: ObjectMetadata,
  extraColumns: string[] = [],
): DbCapabilityRequirement {
  return {
    table,
    columns: uniqueStrings(["id", ...extraColumns]),
  };
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))];
}

function assertSupportedListOptions(options: ListOptions): void {
  if (options.include) {
    throw new UnsupportedDbReadError("DB list does not support include hydration yet.");
  }

  if (options.params && Object.keys(options.params).length > 0) {
    throw new UnsupportedDbReadError("DB list does not support custom query params.");
  }
}

function resolveConnectionOptions(target: ResolvedDbConfig) {
  if (!target.databaseUrl) {
    throw new UnsupportedDbReadError("DB records read requires a resolved database URL.");
  }

  return {
    databaseUrl: target.databaseUrl,
  };
}

function resolveLimit(limit?: number): number {
  if (!Number.isFinite(limit) || !limit || limit < 1) {
    return DEFAULT_LIST_LIMIT;
  }

  return Math.floor(limit);
}

/**
 * Parse the inbound cursor. Empty / undefined → first page. Otherwise the
 * caller MUST send a Twenty-compatible base64-JSON keyset cursor (the same
 * shape this service emits as `endCursor`). Anything else — most notably the
 * legacy `db:<offset>` format — throws `UnsupportedDbReadError` so the
 * auto-mode router falls back to the API. Same pattern as Phase 2 search.
 */
function parseRecordCursor(cursor?: string): RecordListCursor | null {
  if (cursor === undefined || cursor === null || cursor === "") {
    return null;
  }

  const decoded = decodeRecordCursor(cursor);

  if (decoded === null) {
    throw new UnsupportedDbReadError(`DB list does not support cursor ${JSON.stringify(cursor)}.`);
  }

  return decoded;
}

/**
 * Resolve `(sortField, sortDirection)` for the query. The cursor (when
 * present) is authoritative — its encoded sort wins over `--sort` / `--order`
 * so subsequent pages stay coherent with the first page's ordering. When no
 * cursor and no `--sort`, fall back to `id ASC` (parity with prior behaviour).
 */
function resolveSortContext(
  sort: string | undefined,
  order: string | undefined,
  cursor: RecordListCursor | null,
): { sortField: string; sortDirection: "asc" | "desc" } {
  if (cursor !== null) {
    return { sortField: cursor.sortField, sortDirection: cursor.sortDirection };
  }

  if (sort) {
    if (!SIMPLE_IDENTIFIER_PATTERN.test(sort)) {
      throw new UnsupportedDbReadError(
        `DB list does not support sort field ${JSON.stringify(sort)}.`,
      );
    }

    return {
      sortField: sort,
      sortDirection: order?.toLowerCase() === "desc" ? "desc" : "asc",
    };
  }

  return { sortField: DEFAULT_SORT_FIELD, sortDirection: DEFAULT_SORT_DIRECTION };
}

function getGroupByAlias(index: number): string {
  return `group_${index}`;
}

function resolveRecordsOperationUnavailableMessage(operation: "list" | "get" | "groupBy"): string {
  switch (operation) {
    case "get":
      return "DB records get is unavailable.";
    case "groupBy":
      return "DB records groupBy is unavailable.";
    case "list":
    default:
      return "DB records list is unavailable.";
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  return value as Record<string, unknown>;
}

function mapRecordToApiShape(
  record: Record<string, unknown>,
  objectMetadata: ObjectMetadata,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...record };

  for (const field of objectMetadata.fields ?? []) {
    const fieldName = getMetadataFieldName(field);
    const fieldType = getMetadataFieldType(field);
    if (!fieldName || !fieldType) {
      continue;
    }

    if (hasOwn(out, fieldName)) {
      out[fieldName] = normalizeScalarColumnValue(fieldType, out[fieldName]);
    }

    const suffixes = COMPOSITE_FIELD_SUFFIXES[fieldType];
    if (!suffixes) {
      continue;
    }

    const nested: Record<string, unknown> = {};
    let sawComponent = false;
    for (const suffix of suffixes) {
      const columnName = `${fieldName}${suffix}`;
      if (!hasOwn(out, columnName)) {
        continue;
      }

      nested[lowerFirst(suffix)] = normalizeCompositeColumnValue(
        fieldType,
        suffix,
        out[columnName],
      );
      delete out[columnName];
      sawComponent = true;
    }

    if (sawComponent) {
      out[fieldName] = nested;
    }
  }

  return out;
}

function mapUnknownRecordToApiShape(value: unknown, objectMetadata: ObjectMetadata): unknown {
  const record = asRecord(value);
  return record ? mapRecordToApiShape(record, objectMetadata) : value;
}

function normalizeScalarColumnValue(fieldType: string, value: unknown): unknown {
  if (fieldType === "TEXT" && value === null) {
    return "";
  }

  if ((fieldType === "ARRAY" || fieldType === "MULTI_SELECT") && value === null) {
    return [];
  }

  if ((fieldType === "DATE" || fieldType === "DATE_TIME") && typeof value === "string") {
    return normalizeDateString(value);
  }

  return value;
}

function normalizeDateString(value: string): string {
  const time = Date.parse(value);
  if (Number.isNaN(time)) {
    return value;
  }

  return new Date(time).toISOString();
}

function normalizeCompositeColumnValue(fieldType: string, suffix: string, value: unknown): unknown {
  if (value !== null) {
    return value;
  }

  if (COMPOSITE_EMPTY_STRING_SUFFIXES[fieldType]?.has(suffix)) {
    return "";
  }

  if (COMPOSITE_EMPTY_ARRAY_SUFFIXES[fieldType]?.has(suffix)) {
    return [];
  }

  return null;
}

function getMetadataFieldName(field: FieldMetadata): string | undefined {
  const name = (field as Record<string, unknown>).name;
  return typeof name === "string" && name.length > 0 ? name : undefined;
}

function getMetadataFieldType(field: FieldMetadata): string | undefined {
  const type = (field as Record<string, unknown>).type;
  return typeof type === "string" && type.length > 0 ? type : undefined;
}

function lowerFirst(value: string): string {
  return value.length === 0 ? value : `${value[0]!.toLowerCase()}${value.slice(1)}`;
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function toNumber(value: number | string | undefined): number {
  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    return Number(value);
  }

  return 0;
}
