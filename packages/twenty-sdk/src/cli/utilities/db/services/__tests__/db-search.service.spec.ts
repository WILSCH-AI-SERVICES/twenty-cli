import { describe, expect, it, vi } from "vitest";

import { DbConnectionError, UnsupportedDbReadError } from "../../../readbackend/types";
import { decodeSearchCursor, encodeSearchCursor } from "../db-search-cursor";
import { DbSearchService } from "../db-search.service";

const PERSON_OBJECT = {
  id: "person-id",
  nameSingular: "person",
  namePlural: "people",
  labelSingular: "Person",
  labelIdentifierFieldMetadataId: "field-name",
  imageIdentifierFieldMetadataId: "field-avatar",
  fields: [
    { id: "field-id", name: "id", type: "UUID" },
    { id: "field-name", name: "name", type: "FULL_NAME" },
    { id: "field-avatar", name: "avatarUrl", type: "TEXT" },
  ],
};

const TASK_OBJECT = {
  id: "task-id",
  nameSingular: "task",
  namePlural: "tasks",
  labelSingular: "Task",
  labelIdentifierFieldMetadataId: "field-title",
  imageIdentifierFieldMetadataId: null,
  fields: [
    { id: "field-id", name: "id", type: "UUID" },
    { id: "field-title", name: "title", type: "TEXT" },
  ],
};

function buildSearchTarget() {
  return {
    mode: "db" as const,
    source: "env" as const,
    workspace: "default",
    databaseUrl: "postgresql://reader:secret@db.example.com:5432/twenty?sslmode=require",
    databaseSchema: "workspace_test",
  };
}

function buildClientWithUnaccentProbe(searchRows: Array<Record<string, unknown>>): {
  client: { query: ReturnType<typeof vi.fn> };
  searchCalls: Array<{ sql: string; params: unknown[] }>;
} {
  const searchCalls: Array<{ sql: string; params: unknown[] }> = [];
  const client = {
    query: vi.fn().mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql.includes("unaccent_immutable") && sql.includes("pg_proc")) {
        return { rows: [{ ok: 1 }] };
      }
      searchCalls.push({ sql, params: params ?? [] });
      return { rows: searchRows };
    }),
  };
  return { client, searchCalls };
}

function buildDbConnection(client: { query: ReturnType<typeof vi.fn> }) {
  return {
    withClient: vi
      .fn()
      .mockImplementation(async (_options: unknown, fn: (c: typeof client) => Promise<unknown>) =>
        fn(client),
      ),
  };
}

describe("DbSearchService", () => {
  it("queries searchVector with prefix-tsquery, lean projection, and deletedAt filter", async () => {
    const metadata = {
      listObjects: vi.fn().mockResolvedValue([PERSON_OBJECT]),
    };
    const { client, searchCalls } = buildClientWithUnaccentProbe([
      {
        objectName: "person",
        recordId: "person-1",
        labelPart0: "Ada",
        labelPart1: "Lovelace",
        imageRaw: "https://example.com/ada.png",
        tsRankCD: 0.9,
        tsRank: 0.8,
      },
    ]);
    const dbConnection = buildDbConnection(client);
    const service = new DbSearchService(metadata as never, undefined, dbConnection as never);

    const result = await service.search(buildSearchTarget(), { query: "ada" });

    expect(dbConnection.withClient).toHaveBeenCalledWith(
      {
        databaseUrl: "postgresql://reader:secret@db.example.com:5432/twenty?sslmode=require",
      },
      expect.any(Function),
    );

    expect(searchCalls).toHaveLength(1);
    const call = searchCalls[0];
    expect(call.sql).toMatch(/from\s+"workspace_test"\."person"/i);
    expect(call.sql).toContain('"searchVector"');
    expect(call.sql).toContain("to_tsquery('simple', public.unaccent_immutable($1))");
    expect(call.sql).toContain("to_tsquery('simple', public.unaccent_immutable($2))");
    expect(call.sql).toMatch(/ts_rank_cd\s*\(/);
    expect(call.sql).toMatch(/ts_rank\s*\(/);
    expect(call.sql).toMatch(/where\s+t\."deletedAt"\s+is\s+null/i);
    expect(call.sql).toMatch(/t\."searchVector"\s+@@/);
    // Should NOT use the legacy synthetic tsvector approach.
    expect(call.sql).not.toMatch(/to_jsonb/i);
    expect(call.sql).not.toMatch(/jsonb_strip_nulls/i);
    expect(call.sql).not.toMatch(/plainto_tsquery/i);
    // Lean projection: id, label parts (FULL_NAME → 2 columns), image, ranks.
    expect(call.sql).toMatch(/t\."id"::text\s+as\s+"recordId"/i);
    expect(call.sql).toMatch(/t\."nameFirstName"::text\s+as\s+"labelPart0"/i);
    expect(call.sql).toMatch(/t\."nameLastName"::text\s+as\s+"labelPart1"/i);
    expect(call.sql).toMatch(/t\."avatarUrl"::text\s+as\s+"imageRaw"/i);

    // First page (no cursor input): the cursor SQL must NOT inject the cursor
    // WHERE bracket; only the unaccent terms + per-object limit + total limit.
    expect(call.params).toEqual(["ada:*", "ada:*", 21, 21]);
    expect(call.sql).not.toMatch(/cursorLastRankCD|tsRankCDLt|tsRankCDEq/i);

    expect(result.data).toHaveLength(1);
    expect(result.data[0]).toMatchObject({
      recordId: "person-1",
      objectNameSingular: "person",
      objectLabelSingular: "Person",
      label: "Ada Lovelace",
      imageUrl: "https://example.com/ada.png",
      tsRankCD: 0.9,
      tsRank: 0.8,
    });
    expect(typeof result.data[0]?.cursor).toBe("string");
    expect(result.pageInfo).toEqual({
      hasNextPage: false,
      endCursor: result.data[0]?.cursor,
    });

    // The emitted cursor must round-trip through decodeSearchCursor and capture
    // the row's ranks + per-object recordId.
    const decoded = decodeSearchCursor(result.data[0]?.cursor ?? "");
    expect(decoded).toEqual({
      lastRanks: { tsRankCD: 0.9, tsRank: 0.8 },
      lastRecordIdsPerObject: { person: "person-1" },
    });
  });

  it("emits AND-joined and OR-joined search terms for multi-word queries", async () => {
    const metadata = {
      listObjects: vi.fn().mockResolvedValue([PERSON_OBJECT]),
    };
    const { client, searchCalls } = buildClientWithUnaccentProbe([]);
    const dbConnection = buildDbConnection(client);
    const service = new DbSearchService(metadata as never, undefined, dbConnection as never);

    await service.search(buildSearchTarget(), { query: "ada lovelace" });

    expect(searchCalls).toHaveLength(1);
    expect(searchCalls[0].params).toEqual(["ada:* & lovelace:*", "ada:* | lovelace:*", 21, 21]);
  });

  it("projects NULL::text for the image column when the object has no image identifier", async () => {
    const metadata = {
      listObjects: vi.fn().mockResolvedValue([TASK_OBJECT]),
    };
    const { client, searchCalls } = buildClientWithUnaccentProbe([
      {
        objectName: "task",
        recordId: "task-1",
        labelPart0: "Wash dishes",
        labelPart1: null,
        imageRaw: null,
        tsRankCD: 0.5,
        tsRank: 0.4,
      },
    ]);
    const dbConnection = buildDbConnection(client);
    const service = new DbSearchService(metadata as never, undefined, dbConnection as never);

    const result = await service.search(buildSearchTarget(), { query: "wash" });

    expect(searchCalls).toHaveLength(1);
    const sql = searchCalls[0].sql;
    expect(sql).toMatch(/t\."title"::text\s+as\s+"labelPart0"/i);
    expect(sql).toMatch(/null::text\s+as\s+"imageRaw"/i);
    // Task has only one real label column; the second slot is padded with
    // NULL::text so all UNION ALL legs project the same shape.
    expect(sql).toMatch(/null::text\s+as\s+"labelPart1"/i);

    expect(result.data[0]).toMatchObject({
      recordId: "task-1",
      label: "Wash dishes",
      imageUrl: null,
    });
  });

  it("joins label parts via joinLabelParts when the row has both first and last names", async () => {
    const metadata = {
      listObjects: vi.fn().mockResolvedValue([PERSON_OBJECT]),
    };
    const { client } = buildClientWithUnaccentProbe([
      {
        objectName: "person",
        recordId: "person-1",
        labelPart0: "Ada",
        labelPart1: "Lovelace",
        imageRaw: null,
        tsRankCD: 0.9,
        tsRank: 0.8,
      },
      {
        objectName: "person",
        recordId: "person-2",
        labelPart0: "Grace",
        labelPart1: null,
        imageRaw: null,
        tsRankCD: 0.7,
        tsRank: 0.6,
      },
      {
        objectName: "person",
        recordId: "person-3",
        labelPart0: null,
        labelPart1: "Hopper",
        imageRaw: null,
        tsRankCD: 0.5,
        tsRank: 0.4,
      },
    ]);
    const dbConnection = buildDbConnection(client);
    const service = new DbSearchService(metadata as never, undefined, dbConnection as never);

    const result = await service.search(buildSearchTarget(), { query: "ada" });

    expect(result.data.map((r) => r.label)).toEqual(["Ada Lovelace", "Grace", "Hopper"]);
  });

  it("rejects filters because DB search does not support them yet", async () => {
    const service = new DbSearchService({
      listObjects: vi.fn(),
    } as never);

    await expect(
      service.search(
        {
          mode: "db",
          source: "env",
          workspace: "default",
          databaseUrl: "postgresql://reader:secret@db.example.com:5432/twenty",
        },
        {
          query: "ada",
          filter: { city: { eq: "London" } },
        },
      ),
    ).rejects.toBeInstanceOf(UnsupportedDbReadError);
  });

  it("maps connection failures to DbConnectionError", async () => {
    const service = new DbSearchService(
      {
        listObjects: vi.fn().mockResolvedValue([PERSON_OBJECT]),
      } as never,
      undefined,
      {
        withClient: vi.fn().mockRejectedValue(new Error("connect failed")),
      } as never,
    );

    await expect(
      service.search(
        {
          mode: "db",
          source: "env",
          workspace: "default",
          databaseUrl: "postgresql://reader:secret@db.example.com:5432/twenty",
        },
        {
          query: "ada",
        },
      ),
    ).rejects.toBeInstanceOf(DbConnectionError);
  });

  it("retries once after flushing caches when the first attempt hits a stale-relation error", async () => {
    const metadata = {
      listObjects: vi.fn().mockResolvedValue([PERSON_OBJECT]),
      resetListObjectsCache: vi.fn(),
    };
    const planner = {
      planObject: vi.fn().mockResolvedValue({
        objectMetadata: PERSON_OBJECT,
        tableName: "person",
        includes: [],
      }),
    };
    let searchAttempt = 0;
    const client = {
      query: vi.fn().mockImplementation(async (sql: string) => {
        if (sql.includes("unaccent_immutable") && sql.includes("pg_proc")) {
          return { rows: [{ ok: 1 }] };
        }
        searchAttempt += 1;
        if (searchAttempt === 1) {
          throw Object.assign(new Error("relation missing"), { code: "42P01" });
        }
        return {
          rows: [
            {
              objectName: "person",
              recordId: "person-1",
              labelPart0: "Ada",
              labelPart1: "Lovelace",
              imageRaw: null,
              tsRankCD: 0.9,
              tsRank: 0.8,
            },
          ],
        };
      }),
    };
    const dbConnection = {
      withClient: vi
        .fn()
        .mockImplementation(async (_options: unknown, fn: (c: typeof client) => Promise<unknown>) =>
          fn(client),
        ),
    };
    const schemaCache = {
      clear: vi.fn().mockResolvedValue(undefined),
    };
    const service = new DbSearchService(
      metadata as never,
      planner as never,
      dbConnection as never,
      undefined,
      schemaCache as never,
    );

    const result = await service.search(
      {
        mode: "db",
        source: "env",
        workspace: "default",
        databaseUrl: "postgresql://reader:secret@db.example.com:5432/twenty",
        databaseSchema: "workspace_test",
      },
      { query: "ada" },
    );

    expect(metadata.resetListObjectsCache).toHaveBeenCalledTimes(1);
    expect(schemaCache.clear).toHaveBeenCalledWith({ kind: "metadata-objects" });
    expect(result.data).toHaveLength(1);
    expect(result.data[0]?.recordId).toBe("person-1");
    expect(result.data[0]?.label).toBe("Ada Lovelace");
  });

  describe("unaccent_immutable probe", () => {
    it("throws UnsupportedDbReadError when public.unaccent_immutable is absent", async () => {
      const metadata = {
        listObjects: vi.fn().mockResolvedValue([PERSON_OBJECT]),
      };
      const client = {
        query: vi.fn().mockImplementation(async (sql: string) => {
          if (sql.includes("unaccent_immutable") && sql.includes("pg_proc")) {
            return { rows: [] };
          }
          return { rows: [] };
        }),
      };
      const dbConnection = buildDbConnection(client);
      const service = new DbSearchService(metadata as never, undefined, dbConnection as never);

      await expect(service.search(buildSearchTarget(), { query: "ada" })).rejects.toMatchObject({
        name: "UnsupportedDbReadError",
      });
    });

    it("does NOT re-probe on subsequent search calls within same instance", async () => {
      const metadata = {
        listObjects: vi.fn().mockResolvedValue([PERSON_OBJECT]),
      };
      const probeQueries: string[] = [];
      const client = {
        query: vi.fn().mockImplementation(async (sql: string) => {
          if (sql.includes("unaccent_immutable") && sql.includes("pg_proc")) {
            probeQueries.push(sql);
            return { rows: [{ ok: 1 }] };
          }
          return { rows: [] };
        }),
      };
      const dbConnection = buildDbConnection(client);
      const service = new DbSearchService(metadata as never, undefined, dbConnection as never);

      await service.search(buildSearchTarget(), { query: "ada" });
      await service.search(buildSearchTarget(), { query: "ada" });

      expect(probeQueries.length).toBe(1);
    });

    it("re-probes after a failed probe (so a transient failure can recover)", async () => {
      const metadata = {
        listObjects: vi.fn().mockResolvedValue([PERSON_OBJECT]),
      };
      let probeCount = 0;
      const client = {
        query: vi.fn().mockImplementation(async (sql: string) => {
          if (sql.includes("unaccent_immutable") && sql.includes("pg_proc")) {
            probeCount += 1;
            if (probeCount === 1) {
              throw new Error("network blip");
            }
            return { rows: [{ ok: 1 }] };
          }
          return { rows: [] };
        }),
      };
      const dbConnection = buildDbConnection(client);
      const service = new DbSearchService(metadata as never, undefined, dbConnection as never);

      await expect(service.search(buildSearchTarget(), { query: "ada" })).rejects.toThrow(
        /network blip|DB search/i,
      );
      await service.search(buildSearchTarget(), { query: "ada" });

      expect(probeCount).toBe(2);
    });
  });

  describe("UNION ALL multi-object search", () => {
    it("issues exactly ONE search SQL call across multiple objects", async () => {
      const metadata = {
        listObjects: vi.fn().mockResolvedValue([PERSON_OBJECT, TASK_OBJECT]),
      };
      const probeSql: string[] = [];
      const searchSql: string[] = [];
      const client = {
        query: vi.fn().mockImplementation(async (sql: string) => {
          if (sql.includes("unaccent_immutable") && sql.includes("pg_proc")) {
            probeSql.push(sql);
            return { rows: [{ ok: 1 }] };
          }
          searchSql.push(sql);
          return {
            rows: [
              {
                objectName: "person",
                recordId: "u1",
                labelPart0: "Ada",
                labelPart1: "Lovelace",
                imageRaw: null,
                tsRankCD: 0.5,
                tsRank: 0.4,
              },
              {
                objectName: "task",
                recordId: "t1",
                labelPart0: "Refactor",
                labelPart1: null,
                imageRaw: null,
                tsRankCD: 0.3,
                tsRank: 0.2,
              },
            ],
          };
        }),
      };
      const dbConnection = buildDbConnection(client);
      const service = new DbSearchService(metadata as never, undefined, dbConnection as never);

      const result = await service.search(buildSearchTarget(), { query: "ada", limit: 25 });

      expect(probeSql).toHaveLength(1);
      expect(searchSql).toHaveLength(1);

      const sql = searchSql[0];
      expect(sql).toContain("UNION ALL");
      expect(sql).toContain("'person'::text AS \"objectName\"");
      expect(sql).toContain("'task'::text AS \"objectName\"");

      expect(result.data).toHaveLength(2);
      expect(result.data[0]?.label).toBe("Ada Lovelace");
      expect(result.data[0]?.objectNameSingular).toBe("person");
      expect(result.data[0]?.objectLabelSingular).toBe("Person");
      expect(result.data[1]?.label).toBe("Refactor");
      expect(result.data[1]?.objectNameSingular).toBe("task");
      expect(result.data[1]?.objectLabelSingular).toBe("Task");
    });

    it("pads shorter label-part lists with NULL::text to keep UNION uniform", async () => {
      const metadata = {
        listObjects: vi.fn().mockResolvedValue([PERSON_OBJECT, TASK_OBJECT]),
      };
      const { client, searchCalls } = buildClientWithUnaccentProbe([]);
      const dbConnection = buildDbConnection(client);
      const service = new DbSearchService(metadata as never, undefined, dbConnection as never);

      await service.search(buildSearchTarget(), { query: "ada" });

      expect(searchCalls).toHaveLength(1);
      const sql = searchCalls[0].sql;
      // Person leg (FULL_NAME) emits two label-part columns from real columns.
      expect(sql).toMatch(/t\."nameFirstName"::text\s+as\s+"labelPart0"/i);
      expect(sql).toMatch(/t\."nameLastName"::text\s+as\s+"labelPart1"/i);
      // Task leg (single TEXT) emits one real column then a NULL::text pad for labelPart1.
      expect(sql).toMatch(/t\."title"::text\s+as\s+"labelPart0"/i);
      expect(sql).toMatch(/null::text\s+as\s+"labelPart1"/i);
    });

    it("pads missing image with NULL::text on objects without an image identifier", async () => {
      const metadata = {
        listObjects: vi.fn().mockResolvedValue([PERSON_OBJECT, TASK_OBJECT]),
      };
      const { client, searchCalls } = buildClientWithUnaccentProbe([]);
      const dbConnection = buildDbConnection(client);
      const service = new DbSearchService(metadata as never, undefined, dbConnection as never);

      await service.search(buildSearchTarget(), { query: "ada" });

      const sql = searchCalls[0].sql;
      // Person has avatarUrl image, task has no image — should appear as NULL::text imageRaw
      // for the task leg only.
      expect(sql).toMatch(/t\."avatarUrl"::text\s+as\s+"imageRaw"/i);
      expect(sql).toMatch(/null::text\s+as\s+"imageRaw"/i);
    });

    it("uses an outer LIMIT bound on total emitted rows across all objects", async () => {
      const metadata = {
        listObjects: vi.fn().mockResolvedValue([PERSON_OBJECT, TASK_OBJECT]),
      };
      const { client, searchCalls } = buildClientWithUnaccentProbe([]);
      const dbConnection = buildDbConnection(client);
      const service = new DbSearchService(metadata as never, undefined, dbConnection as never);

      await service.search(buildSearchTarget(), { query: "ada", limit: 7 });

      const call = searchCalls[0];
      // Outer ORDER BY + LIMIT $4 around the WITH ranked CTE.
      expect(call.sql).toMatch(/with\s+ranked\s+as/i);
      expect(call.sql).toMatch(/select\s+\*\s+from\s+ranked/i);
      expect(call.sql).toMatch(/limit\s+\$4/i);
      // Per-object inner limit is $3.
      expect(call.sql).toMatch(/limit\s+\$3/i);
      // Params: andTerms, orTerms, perObjectLimit (limit + 1), totalLimit (limit + 1).
      expect(call.params).toEqual(["ada:*", "ada:*", 8, 8]);
    });

    it("works when only ONE object is included (single-leg UNION ALL)", async () => {
      const metadata = {
        listObjects: vi.fn().mockResolvedValue([PERSON_OBJECT]),
      };
      const { client, searchCalls } = buildClientWithUnaccentProbe([
        {
          objectName: "person",
          recordId: "p1",
          labelPart0: "Ada",
          labelPart1: "Lovelace",
          imageRaw: null,
          tsRankCD: 0.9,
          tsRank: 0.8,
        },
      ]);
      const dbConnection = buildDbConnection(client);
      const service = new DbSearchService(metadata as never, undefined, dbConnection as never);

      const result = await service.search(buildSearchTarget(), { query: "ada" });

      // Only one object → no UNION ALL keyword needed (single CTE leg).
      expect(searchCalls).toHaveLength(1);
      const sql = searchCalls[0].sql;
      expect(sql).not.toContain("UNION ALL");
      // Still wrapped in WITH ranked AS for outer ordering/limit.
      expect(sql).toMatch(/with\s+ranked\s+as/i);
      expect(sql).toContain("'person'::text AS \"objectName\"");

      expect(result.data).toHaveLength(1);
      expect(result.data[0]?.label).toBe("Ada Lovelace");
    });

    it("skips objects that fail to resolve with UnsupportedDbReadError; the rest still query", async () => {
      const metadata = {
        listObjects: vi.fn().mockResolvedValue([PERSON_OBJECT, TASK_OBJECT]),
      };
      // Resolver throws for "task" (e.g. unknown table) but succeeds for "person".
      const tableResolver = {
        resolve: vi
          .fn()
          .mockImplementation(async (_client: unknown, target: unknown, tableName: string) => {
            if (tableName === "task") {
              throw new UnsupportedDbReadError(`no table for ${tableName}`);
            }
            const t = target as { databaseSchema?: string };
            return { schemaName: t.databaseSchema, tableName };
          }),
      };
      const { client, searchCalls } = buildClientWithUnaccentProbe([
        {
          objectName: "person",
          recordId: "p1",
          labelPart0: "Ada",
          labelPart1: "Lovelace",
          imageRaw: null,
          tsRankCD: 0.9,
          tsRank: 0.8,
        },
      ]);
      const dbConnection = buildDbConnection(client);
      const service = new DbSearchService(
        metadata as never,
        undefined,
        dbConnection as never,
        tableResolver as never,
      );

      const result = await service.search(buildSearchTarget(), { query: "ada" });

      expect(searchCalls).toHaveLength(1);
      const sql = searchCalls[0].sql;
      // Only the person leg should be in the SQL.
      expect(sql).toContain("'person'::text AS \"objectName\"");
      expect(sql).not.toContain("'task'::text AS \"objectName\"");
      expect(sql).not.toContain("UNION ALL");

      expect(result.data).toHaveLength(1);
      expect(result.data[0]?.objectNameSingular).toBe("person");
    });

    it("orders merged rows globally by tsRankCD, tsRank, objectName, recordId", async () => {
      const metadata = {
        listObjects: vi.fn().mockResolvedValue([PERSON_OBJECT, TASK_OBJECT]),
      };
      const { client, searchCalls } = buildClientWithUnaccentProbe([]);
      const dbConnection = buildDbConnection(client);
      const service = new DbSearchService(metadata as never, undefined, dbConnection as never);

      await service.search(buildSearchTarget(), { query: "ada" });

      const sql = searchCalls[0].sql;
      // The CTE's outer SELECT should sort by tsRankCD DESC, tsRank DESC, then
      // discriminator + recordId ASC for stable cross-object ordering.
      expect(sql).toMatch(
        /order\s+by\s+"tsRankCD"\s+desc\s*,\s*"tsRank"\s+desc\s*,\s*"objectName"\s+asc\s*,\s*"recordId"\s+asc/i,
      );
    });
  });

  describe("base64-JSON cursor compatibility", () => {
    it("emits a base64-JSON cursor that round-trips through decodeSearchCursor", async () => {
      const metadata = {
        listObjects: vi.fn().mockResolvedValue([PERSON_OBJECT, TASK_OBJECT]),
      };
      const { client } = buildClientWithUnaccentProbe([
        {
          objectName: "person",
          recordId: "p1",
          labelPart0: "Ada",
          labelPart1: "Lovelace",
          imageRaw: null,
          tsRankCD: 0.9,
          tsRank: 0.8,
        },
        {
          objectName: "task",
          recordId: "t1",
          labelPart0: "Refactor",
          labelPart1: null,
          imageRaw: null,
          tsRankCD: 0.5,
          tsRank: 0.4,
        },
        {
          objectName: "person",
          recordId: "p2",
          labelPart0: "Grace",
          labelPart1: "Hopper",
          imageRaw: null,
          tsRankCD: 0.3,
          tsRank: 0.2,
        },
      ]);
      const dbConnection = buildDbConnection(client);
      const service = new DbSearchService(metadata as never, undefined, dbConnection as never);

      const result = await service.search(buildSearchTarget(), { query: "ada" });

      expect(result.data).toHaveLength(3);
      // Each row carries a cursor that captures the snapshot of
      // `lastRecordIdsPerObject` AT THAT POINT in the result stream.
      const cursorAfterFirst = decodeSearchCursor(result.data[0]?.cursor ?? "");
      expect(cursorAfterFirst).toEqual({
        lastRanks: { tsRankCD: 0.9, tsRank: 0.8 },
        lastRecordIdsPerObject: { person: "p1" },
      });

      const cursorAfterSecond = decodeSearchCursor(result.data[1]?.cursor ?? "");
      expect(cursorAfterSecond).toEqual({
        lastRanks: { tsRankCD: 0.5, tsRank: 0.4 },
        lastRecordIdsPerObject: { person: "p1", task: "t1" },
      });

      const cursorAfterThird = decodeSearchCursor(result.data[2]?.cursor ?? "");
      expect(cursorAfterThird).toEqual({
        lastRanks: { tsRankCD: 0.3, tsRank: 0.2 },
        lastRecordIdsPerObject: { person: "p2", task: "t1" },
      });

      // The page-level endCursor matches the last row's cursor.
      expect(result.pageInfo?.endCursor).toBe(result.data[2]?.cursor);
    });

    it("returns no endCursor for an empty result set", async () => {
      const metadata = {
        listObjects: vi.fn().mockResolvedValue([PERSON_OBJECT]),
      };
      const { client } = buildClientWithUnaccentProbe([]);
      const dbConnection = buildDbConnection(client);
      const service = new DbSearchService(metadata as never, undefined, dbConnection as never);

      const result = await service.search(buildSearchTarget(), { query: "nothing" });

      expect(result.data).toHaveLength(0);
      expect(result.pageInfo?.hasNextPage).toBe(false);
      expect(result.pageInfo?.endCursor).toBeUndefined();
    });

    it("trims to limit and sets hasNextPage when the SQL returns limit + 1 rows", async () => {
      const metadata = {
        listObjects: vi.fn().mockResolvedValue([PERSON_OBJECT]),
      };
      // Asked for limit=2; SQL fetches limit+1=3 to detect hasNextPage.
      const rows = [
        {
          objectName: "person",
          recordId: "p1",
          labelPart0: "Ada",
          labelPart1: "Lovelace",
          imageRaw: null,
          tsRankCD: 0.9,
          tsRank: 0.8,
        },
        {
          objectName: "person",
          recordId: "p2",
          labelPart0: "Grace",
          labelPart1: "Hopper",
          imageRaw: null,
          tsRankCD: 0.7,
          tsRank: 0.6,
        },
        {
          objectName: "person",
          recordId: "p3",
          labelPart0: "Margaret",
          labelPart1: "Hamilton",
          imageRaw: null,
          tsRankCD: 0.5,
          tsRank: 0.4,
        },
      ];
      const { client } = buildClientWithUnaccentProbe(rows);
      const dbConnection = buildDbConnection(client);
      const service = new DbSearchService(metadata as never, undefined, dbConnection as never);

      const result = await service.search(buildSearchTarget(), { query: "ada", limit: 2 });

      expect(result.data).toHaveLength(2);
      expect(result.data.map((r) => r.recordId)).toEqual(["p1", "p2"]);
      expect(result.pageInfo?.hasNextPage).toBe(true);
      // endCursor is the cursor of the LAST emitted row (p2), not of the trimmed sentinel (p3).
      expect(result.pageInfo?.endCursor).toBe(result.data[1]?.cursor);
      const decoded = decodeSearchCursor(result.data[1]?.cursor ?? "");
      expect(decoded).toEqual({
        lastRanks: { tsRankCD: 0.7, tsRank: 0.6 },
        lastRecordIdsPerObject: { person: "p2" },
      });
    });

    it("does NOT emit cursor WHERE clauses when no cursor is provided (first page)", async () => {
      const metadata = {
        listObjects: vi.fn().mockResolvedValue([PERSON_OBJECT, TASK_OBJECT]),
      };
      const { client, searchCalls } = buildClientWithUnaccentProbe([]);
      const dbConnection = buildDbConnection(client);
      const service = new DbSearchService(metadata as never, undefined, dbConnection as never);

      await service.search(buildSearchTarget(), { query: "ada" });

      const sql = searchCalls[0].sql;
      // No cursor → no $5/$6/$7 cursor params, no cursor predicate.
      expect(sql).not.toMatch(/<\s*\$5|<\s*\$6|>\s*\$7|>\s*\(\$7/);
      // Params should be exactly the 4 default search params.
      expect(searchCalls[0].params).toHaveLength(4);
    });

    it("injects cursor WHERE clause per UNION leg when given a valid cursor", async () => {
      const metadata = {
        listObjects: vi.fn().mockResolvedValue([PERSON_OBJECT, TASK_OBJECT]),
      };
      const { client, searchCalls } = buildClientWithUnaccentProbe([]);
      const dbConnection = buildDbConnection(client);
      const service = new DbSearchService(metadata as never, undefined, dbConnection as never);

      const cursor = encodeSearchCursor({
        lastRanks: { tsRankCD: 0.5, tsRank: 0.3 },
        lastRecordIdsPerObject: { person: "person-uuid", task: "task-uuid" },
      });

      await service.search(buildSearchTarget(), { query: "ada", after: cursor });

      const call = searchCalls[0];
      // The SQL must reference $5 (lastRankCD), $6 (lastRank), and a per-object id source.
      expect(call.sql).toContain("$5");
      expect(call.sql).toContain("$6");
      // Per Twenty's three-bracket comparator: rankCD < $5 OR (rankCD = $5 AND rank < $6) OR (rankCD = $5 AND rank = $6 AND id > <perObjectId>)
      expect(call.sql).toMatch(/<\s*\$5/);
      expect(call.sql).toMatch(/=\s*\$5/);
      expect(call.sql).toMatch(/<\s*\$6/);
      expect(call.sql).toMatch(/=\s*\$6/);
      // Cursor params should follow the four base params.
      expect(call.params.length).toBeGreaterThanOrEqual(6);
      expect(call.params[4]).toBe(0.5); // lastRankCD
      expect(call.params[5]).toBe(0.3); // lastRank
    });

    it("throws UnsupportedDbReadError for legacy db:<offset> cursor", async () => {
      const metadata = {
        listObjects: vi.fn().mockResolvedValue([PERSON_OBJECT]),
      };
      const { client } = buildClientWithUnaccentProbe([]);
      const dbConnection = buildDbConnection(client);
      const service = new DbSearchService(metadata as never, undefined, dbConnection as never);

      await expect(
        service.search(buildSearchTarget(), { query: "ada", after: "db:5" }),
      ).rejects.toBeInstanceOf(UnsupportedDbReadError);
    });

    it("throws UnsupportedDbReadError for cursor that is not valid base64-JSON", async () => {
      const metadata = {
        listObjects: vi.fn().mockResolvedValue([PERSON_OBJECT]),
      };
      const { client } = buildClientWithUnaccentProbe([]);
      const dbConnection = buildDbConnection(client);
      const service = new DbSearchService(metadata as never, undefined, dbConnection as never);

      await expect(
        service.search(buildSearchTarget(), { query: "ada", after: "totally-bogus" }),
      ).rejects.toBeInstanceOf(UnsupportedDbReadError);
    });

    it("does NOT throw for an empty cursor (treated as no cursor — first page)", async () => {
      // An empty string in `after` should behave like no cursor at all.
      const metadata = {
        listObjects: vi.fn().mockResolvedValue([PERSON_OBJECT]),
      };
      const { client, searchCalls } = buildClientWithUnaccentProbe([]);
      const dbConnection = buildDbConnection(client);
      const service = new DbSearchService(metadata as never, undefined, dbConnection as never);

      await service.search(buildSearchTarget(), { query: "ada", after: "" });

      expect(searchCalls).toHaveLength(1);
      // No cursor injection.
      expect(searchCalls[0].params).toHaveLength(4);
    });
  });
});
