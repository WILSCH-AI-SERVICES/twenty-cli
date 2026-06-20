import { describe, expect, it, vi } from "vitest";

import { UnsupportedDbReadError } from "../../../readbackend/types";
import {
  decodeRecordCursor,
  encodeRecordCursor,
  type RecordListCursor,
} from "../db-records-cursor";
import { DbRecordsReadService } from "../db-records-read.service";

const DB_TARGET = {
  mode: "db",
  source: "env",
  workspace: "default",
  databaseUrl: "postgresql://reader:secret@db.example.com:5432/twenty?sslmode=require",
  databaseSchema: "workspace_test",
} as const;

describe("DbRecordsReadService", () => {
  it("returns the existing ListResponse shape for db-backed list reads", async () => {
    const planner = {
      planObject: vi.fn().mockResolvedValue({
        objectMetadata: { id: "person-id", nameSingular: "person", namePlural: "people" },
        tableName: "person",
        includes: [],
      }),
    };
    const filterCompiler = {
      compile: vi.fn().mockReturnValue([
        { field: "status", operator: "eq", value: "ACTIVE" },
        { field: "score", operator: "gte", value: 10 },
      ]),
    };
    const client = {
      // Returns limit + 1 rows so hasNextPage is detected via the sentinel.
      query: vi.fn().mockResolvedValue({
        rows: [
          { rowData: { id: "person-1", name: "Ada", status: "ACTIVE" }, totalCount: "3" },
          { rowData: { id: "person-2", name: "Grace", status: "ACTIVE" }, totalCount: "3" },
          { rowData: { id: "person-3", name: "Linus", status: "ACTIVE" }, totalCount: "3" },
        ],
      }),
    };
    const dbConnection = {
      withClient: vi
        .fn()
        .mockImplementation(async (_options: unknown, fn: (c: typeof client) => Promise<unknown>) =>
          fn(client),
        ),
    };
    const service = new DbRecordsReadService(
      {} as never,
      planner as never,
      filterCompiler as never,
      dbConnection as never,
    );

    const result = await service.list(DB_TARGET, "people", {
      limit: 2,
      filter: "status[eq]:ACTIVE;score[gte]:10",
      sort: "createdAt",
      order: "desc",
      totalCount: true,
    });

    expect(client.query).toHaveBeenCalledTimes(1);
    const [sql, params] = client.query.mock.calls[0];
    expect(String(sql)).toContain("count(*) over ()");
    expect(String(sql)).toContain('from "workspace_test"."person" as t');
    expect(String(sql)).toContain('order by t."createdAt" desc nulls last, t."id" asc');
    // limit + 1 = 3; no OFFSET param (first page has no keyset cursor).
    expect(params).toEqual(["ACTIVE", 10, 3]);

    // Sentinel row (person-3) is dropped.
    expect(result.data).toEqual([
      { id: "person-1", name: "Ada", status: "ACTIVE" },
      { id: "person-2", name: "Grace", status: "ACTIVE" },
    ]);
    expect(result.totalCount).toBe(3);
    expect(result.pageInfo?.hasNextPage).toBe(true);
    expect(decodeRecordCursor(result.pageInfo?.endCursor as string)).toEqual({
      lastSortValue: null,
      lastId: "person-2",
      sortField: "createdAt",
      sortDirection: "desc",
    });
  });

  it("maps composite DB columns into API-shaped record fields", async () => {
    const planner = {
      planObject: vi.fn().mockResolvedValue({
        objectMetadata: {
          id: "person-id",
          nameSingular: "person",
          namePlural: "people",
          fields: [
            { id: "field-name", name: "name", type: "FULL_NAME" },
            { id: "field-preferred-name", name: "preferredName", type: "FULL_NAME" },
            { id: "field-emails", name: "emails", type: "EMAILS" },
            { id: "field-linkedin", name: "linkedinLink", type: "LINKS" },
            { id: "field-address", name: "addressCustom", type: "ADDRESS" },
            { id: "field-phones", name: "phones", type: "PHONES" },
            { id: "field-ask", name: "askMeAbout", type: "TEXT" },
            { id: "field-birthday", name: "birthday", type: "DATE" },
            { id: "field-tags", name: "tags", type: "ARRAY" },
            { id: "field-contact-type", name: "contactType", type: "MULTI_SELECT" },
          ],
        },
        tableName: "person",
        includes: [],
      }),
    };
    const filterCompiler = {
      compile: vi.fn().mockReturnValue([]),
    };
    const client = {
      query: vi.fn().mockResolvedValue({
        rows: [
          {
            rowData: {
              id: "person-1",
              askMeAbout: null,
              birthday: "2000-01-02T00:00:00+00:00",
              tags: null,
              contactType: null,
              nameFirstName: "Jane",
              nameLastName: "Doe",
              preferredNameFirstName: null,
              preferredNameLastName: null,
              emailsPrimaryEmail: null,
              emailsAdditionalEmails: null,
              linkedinLinkPrimaryLinkLabel: null,
              linkedinLinkPrimaryLinkUrl: null,
              linkedinLinkSecondaryLinks: null,
              phonesPrimaryPhoneNumber: null,
              phonesPrimaryPhoneCountryCode: null,
              phonesPrimaryPhoneCallingCode: null,
              phonesAdditionalPhones: null,
              addressCustomAddressCity: "Chicago",
              addressCustomAddressCountry: "Canada",
              addressCustomAddressPostcode: null,
              addressCustomAddressStreet1: "100 Example St",
            },
          },
        ],
      }),
    };
    const dbConnection = {
      withClient: vi
        .fn()
        .mockImplementation(async (_options: unknown, fn: (c: typeof client) => Promise<unknown>) =>
          fn(client),
        ),
    };
    const service = new DbRecordsReadService(
      {} as never,
      planner as never,
      filterCompiler as never,
      dbConnection as never,
    );

    const result = await service.list(DB_TARGET, "people", { limit: 1 });

    expect(result.data).toEqual([
      {
        id: "person-1",
        askMeAbout: "",
        birthday: "2000-01-02T00:00:00.000Z",
        tags: [],
        contactType: [],
        name: { firstName: "Jane", lastName: "Doe" },
        preferredName: { firstName: "", lastName: "" },
        emails: {
          primaryEmail: "",
          additionalEmails: [],
        },
        linkedinLink: {
          primaryLinkLabel: "",
          primaryLinkUrl: "",
          secondaryLinks: [],
        },
        phones: {
          primaryPhoneNumber: "",
          primaryPhoneCountryCode: "",
          primaryPhoneCallingCode: "",
          additionalPhones: [],
        },
        addressCustom: {
          addressCity: "Chicago",
          addressCountry: "Canada",
          addressPostcode: "",
          addressStreet1: "100 Example St",
        },
      },
    ]);
  });

  it("falls back to a count query when the list page returns zero rows", async () => {
    const planner = {
      planObject: vi.fn().mockResolvedValue({
        objectMetadata: { id: "person-id", nameSingular: "person", namePlural: "people" },
        tableName: "person",
        includes: [],
      }),
    };
    const filterCompiler = {
      compile: vi.fn().mockReturnValue([]),
    };
    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ totalCount: "7" }] }),
    };
    const dbConnection = {
      withClient: vi
        .fn()
        .mockImplementation(async (_options: unknown, fn: (c: typeof client) => Promise<unknown>) =>
          fn(client),
        ),
    };
    const service = new DbRecordsReadService(
      {} as never,
      planner as never,
      filterCompiler as never,
      dbConnection as never,
    );

    const cursor: RecordListCursor = {
      lastSortValue: null,
      lastId: "person-99",
      sortField: "id",
      sortDirection: "asc",
    };
    const result = await service.list(DB_TARGET, "people", {
      limit: 5,
      cursor: encodeRecordCursor(cursor),
      totalCount: true,
    });

    expect(client.query).toHaveBeenCalledTimes(2);
    expect(result.totalCount).toBe(7);
    expect(result.data).toEqual([]);
    expect(result.pageInfo?.hasNextPage).toBe(false);
    expect(result.pageInfo?.endCursor).toBeUndefined();
  });

  it("accumulates rows across db pages for listAll using a single connection", async () => {
    const planner = {
      planObject: vi.fn().mockResolvedValue({
        objectMetadata: { id: "person-id", nameSingular: "person", namePlural: "people" },
        tableName: "person",
        includes: [],
      }),
    };
    const filterCompiler = {
      compile: vi.fn().mockReturnValue([]),
    };
    const client = {
      // Page 1: limit + 1 = 2 rows → sentinel triggers hasNextPage = true.
      // Page 2: 1 row only → no sentinel, hasNextPage = false.
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [
            { rowData: { id: "person-1", name: "Ada" }, totalCount: "2" },
            { rowData: { id: "person-2", name: "Grace" }, totalCount: "2" },
          ],
        })
        .mockResolvedValueOnce({
          rows: [{ rowData: { id: "person-2", name: "Grace" }, totalCount: "2" }],
        }),
    };
    const dbConnection = {
      withClient: vi
        .fn()
        .mockImplementation(async (_options: unknown, fn: (c: typeof client) => Promise<unknown>) =>
          fn(client),
        ),
    };
    const service = new DbRecordsReadService(
      {} as never,
      planner as never,
      filterCompiler as never,
      dbConnection as never,
    );

    const result = await service.listAll(DB_TARGET, "people", { limit: 1, totalCount: true });

    // Single connection acquired up front, every page query goes through the
    // same client (preserves the listAll connection-reuse invariant).
    expect(dbConnection.withClient).toHaveBeenCalledTimes(1);
    expect(client.query).toHaveBeenCalledTimes(2);
    expect(result.data).toEqual([
      { id: "person-1", name: "Ada" },
      { id: "person-2", name: "Grace" },
    ]);
    expect(result.totalCount).toBe(2);
    expect(result.pageInfo?.hasNextPage).toBe(false);
    expect(decodeRecordCursor(result.pageInfo?.endCursor as string)).toEqual({
      lastSortValue: "person-2",
      lastId: "person-2",
      sortField: "id",
      sortDirection: "asc",
    });

    // Page 2 should have applied the keyset WHERE clause derived from page 1's
    // last emitted row (person-1).
    const [page2Sql, page2Params] = client.query.mock.calls[1];
    expect(String(page2Sql)).toMatch(/t\."id"\s*<|>\s*\$1/);
    // Params: [lastSortValue="person-1", lastId="person-1", limit + 1 = 2]
    expect(page2Params).toEqual(["person-1", "person-1", 2]);
  });

  it("hydrates MANY_TO_ONE includes for get in a single query", async () => {
    const planner = {
      planObject: vi.fn().mockResolvedValue({
        objectMetadata: { id: "person-id", nameSingular: "person", namePlural: "people" },
        tableName: "person",
        includes: [
          {
            relationName: "company",
            joinColumnName: "companyId",
            fieldMetadata: { id: "field-1" },
            objectMetadata: { id: "company-id", nameSingular: "company", namePlural: "companies" },
            tableName: "company",
          },
        ],
      }),
    };
    const client = {
      query: vi.fn().mockResolvedValue({
        rows: [
          {
            rowData: { id: "person-1", companyId: "company-1" },
            rel_0: { id: "company-1", name: "Acme" },
          },
        ],
      }),
    };
    const dbConnection = {
      withClient: vi
        .fn()
        .mockImplementation(async (_options: unknown, fn: (c: typeof client) => Promise<unknown>) =>
          fn(client),
        ),
    };
    const service = new DbRecordsReadService(
      {} as never,
      planner as never,
      undefined,
      dbConnection as never,
    );

    const result = await service.get(DB_TARGET, "people", "person-1", { include: "company" });

    expect(client.query).toHaveBeenCalledTimes(1);
    const [sql, params] = client.query.mock.calls[0];
    expect(String(sql)).toContain("left join lateral");
    expect(String(sql)).toContain('"workspace_test"."company"');
    expect(String(sql)).toContain('t."companyId"');
    expect(params).toEqual(["person-1"]);
    expect(result).toEqual({
      id: "person-1",
      companyId: "company-1",
      company: {
        id: "company-1",
        name: "Acme",
      },
    });
  });

  it("returns null for include relations whose join id is null", async () => {
    const planner = {
      planObject: vi.fn().mockResolvedValue({
        objectMetadata: { id: "person-id", nameSingular: "person", namePlural: "people" },
        tableName: "person",
        includes: [
          {
            relationName: "company",
            joinColumnName: "companyId",
            fieldMetadata: { id: "field-1" },
            objectMetadata: { id: "company-id", nameSingular: "company", namePlural: "companies" },
            tableName: "company",
          },
        ],
      }),
    };
    const client = {
      query: vi.fn().mockResolvedValue({
        rows: [
          {
            rowData: { id: "person-1", companyId: null },
            rel_0: null,
          },
        ],
      }),
    };
    const dbConnection = {
      withClient: vi
        .fn()
        .mockImplementation(async (_options: unknown, fn: (c: typeof client) => Promise<unknown>) =>
          fn(client),
        ),
    };
    const service = new DbRecordsReadService(
      {} as never,
      planner as never,
      undefined,
      dbConnection as never,
    );

    const result = await service.get(DB_TARGET, "people", "person-1", { include: "company" });

    expect(client.query).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      id: "person-1",
      companyId: null,
      company: null,
    });
  });

  it("maps DB groupBy rows into the existing response shape", async () => {
    const planner = {
      planObject: vi.fn().mockResolvedValue({
        objectMetadata: { id: "person-id", nameSingular: "person", namePlural: "people" },
        tableName: "person",
        includes: [],
      }),
    };
    const filterCompiler = {
      compile: vi.fn().mockReturnValue([{ field: "status", operator: "eq", value: "ACTIVE" }]),
    };
    const client = {
      query: vi.fn().mockResolvedValue({
        rows: [{ group_0: "London", countNotEmptyId: "2" }],
      }),
    };
    const dbConnection = {
      withClient: vi
        .fn()
        .mockImplementation(async (_options: unknown, fn: (c: typeof client) => Promise<unknown>) =>
          fn(client),
        ),
    };
    const service = new DbRecordsReadService(
      {} as never,
      planner as never,
      filterCompiler as never,
      dbConnection as never,
    );

    const result = await service.groupBy(
      DB_TARGET,
      "people",
      { groupBy: [{ city: true }], filter: "status[eq]:ACTIVE" },
      { aggregate: ["totalCount"], limit: ["5"] },
    );

    expect(result).toEqual([
      {
        groupByDimensionValues: ["London"],
        countNotEmptyId: "2",
      },
    ]);
  });

  it("rejects include hydration on list reads", async () => {
    const service = new DbRecordsReadService({} as never);

    await expect(service.list(DB_TARGET, "people", { include: "company" })).rejects.toBeInstanceOf(
      UnsupportedDbReadError,
    );
  });

  it("skips the list query when the capability gate reports a gap", async () => {
    const planner = {
      planObject: vi.fn().mockResolvedValue({
        objectMetadata: {
          id: "person-id",
          nameSingular: "person",
          namePlural: "people",
          fields: [{ id: "field-name", name: "name", type: "TEXT" }],
        },
        tableName: "person",
        includes: [],
      }),
    };
    const filterCompiler = {
      compile: vi.fn().mockReturnValue([]),
    };
    const client = {
      query: vi.fn().mockResolvedValue({ rows: [{ rowData: { id: "person-1" } }] }),
    };
    const dbConnection = {
      withClient: vi
        .fn()
        .mockImplementation(async (_options: unknown, fn: (c: typeof client) => Promise<unknown>) =>
          fn(client),
        ),
    };
    const tableResolver = {
      resolve: vi.fn().mockResolvedValue({ schemaName: "workspace_test", tableName: "person" }),
    };
    const capabilities = {
      snapshot: vi.fn().mockResolvedValue({ tables: new Set(), columns: new Map() }),
      snapshotHas: vi.fn().mockReturnValue(false),
    };
    const service = new DbRecordsReadService(
      {} as never,
      planner as never,
      filterCompiler as never,
      dbConnection as never,
      tableResolver as never,
      undefined,
      capabilities,
    );

    await expect(service.list(DB_TARGET, "people", { sort: "name" })).rejects.toBeInstanceOf(
      UnsupportedDbReadError,
    );

    expect(capabilities.snapshot).toHaveBeenCalledWith(client, "workspace_test");
    expect(capabilities.snapshotHas).toHaveBeenCalledWith(expect.any(Object), {
      table: { schemaName: "workspace_test", tableName: "person" },
      columns: ["id", "name"],
    });
    expect(client.query).not.toHaveBeenCalled();
  });

  it("does not require metadata-only fields in the capability gate for to_jsonb list reads", async () => {
    const planner = {
      planObject: vi.fn().mockResolvedValue({
        objectMetadata: {
          id: "person-id",
          nameSingular: "person",
          namePlural: "people",
          fields: [{ id: "field-name", name: "name", type: "TEXT" }],
        },
        tableName: "person",
        includes: [],
      }),
    };
    const filterCompiler = {
      compile: vi.fn().mockReturnValue([]),
    };
    const client = {
      query: vi.fn().mockResolvedValue({ rows: [{ rowData: { id: "person-1" } }] }),
    };
    const dbConnection = {
      withClient: vi
        .fn()
        .mockImplementation(async (_options: unknown, fn: (c: typeof client) => Promise<unknown>) =>
          fn(client),
        ),
    };
    const tableResolver = {
      resolve: vi.fn().mockResolvedValue({ schemaName: "workspace_test", tableName: "person" }),
    };
    const capabilities = {
      snapshot: vi.fn().mockResolvedValue({
        tables: new Set(["workspace_test.person"]),
        columns: new Map([["workspace_test.person", new Set(["id"])]]),
      }),
      snapshotHas: vi
        .fn()
        .mockImplementation(
          (_snapshot: unknown, requirement: { columns?: string[] }) =>
            JSON.stringify(requirement.columns) === JSON.stringify(["id"]),
        ),
    };
    const service = new DbRecordsReadService(
      {} as never,
      planner as never,
      filterCompiler as never,
      dbConnection as never,
      tableResolver as never,
      undefined,
      capabilities,
    );

    await service.list(DB_TARGET, "people");

    expect(capabilities.snapshotHas).toHaveBeenCalledWith(expect.any(Object), {
      table: { schemaName: "workspace_test", tableName: "person" },
      columns: ["id"],
    });
    expect(client.query).toHaveBeenCalledTimes(1);
  });

  it("retries once after flushing caches when the first attempt hits a stale-column error", async () => {
    const planner = {
      planObject: vi.fn().mockResolvedValue({
        objectMetadata: { id: "person-id", nameSingular: "person", namePlural: "people" },
        tableName: "person",
        includes: [],
      }),
    };
    const filterCompiler = {
      compile: vi.fn().mockReturnValue([]),
    };
    let attempt = 0;
    const client = {
      query: vi.fn().mockImplementation(async () => {
        attempt += 1;
        if (attempt === 1) {
          throw Object.assign(new Error("column missing"), { code: "42703" });
        }
        return {
          rows: [{ rowData: { id: "person-1", name: "Ada" }, totalCount: "1" }],
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
    const metadata = {
      resetListObjectsCache: vi.fn(),
    };
    const schemaCache = {
      clear: vi.fn().mockResolvedValue(undefined),
    };
    const service = new DbRecordsReadService(
      metadata as never,
      planner as never,
      filterCompiler as never,
      dbConnection as never,
      undefined,
      schemaCache as never,
    );

    const result = await service.list(DB_TARGET, "people");

    expect(metadata.resetListObjectsCache).toHaveBeenCalledTimes(1);
    expect(schemaCache.clear).toHaveBeenCalledWith({ kind: "metadata-objects" });
    expect(client.query).toHaveBeenCalledTimes(2);
    expect(result.data).toEqual([{ id: "person-1", name: "Ada" }]);
  });

  describe("list without count(*) over ()", () => {
    function makePlanner() {
      return {
        planObject: vi.fn().mockResolvedValue({
          objectMetadata: { id: "person-id", nameSingular: "person", namePlural: "people" },
          tableName: "person",
          includes: [],
        }),
      };
    }

    function makeFilterCompiler() {
      return { compile: vi.fn().mockReturnValue([]) };
    }

    function makeClientReturning(rows: Array<Record<string, unknown>>) {
      return {
        query: vi.fn().mockResolvedValue({ rows }),
      };
    }

    function makeDbConnection(client: { query: ReturnType<typeof vi.fn> }) {
      return {
        withClient: vi
          .fn()
          .mockImplementation(
            async (_options: unknown, fn: (c: typeof client) => Promise<unknown>) => fn(client),
          ),
      };
    }

    it("default list SQL omits count(*) over () and uses limit + 1", async () => {
      const planner = makePlanner();
      const filterCompiler = makeFilterCompiler();
      const client = makeClientReturning([]);
      const dbConnection = makeDbConnection(client);
      const service = new DbRecordsReadService(
        {} as never,
        planner as never,
        filterCompiler as never,
        dbConnection as never,
      );

      await service.list(DB_TARGET, "people", { limit: 25 });

      expect(client.query).toHaveBeenCalledTimes(1);
      const [sql, params] = client.query.mock.calls[0];
      expect(String(sql)).not.toMatch(/count\(\*\)\s+over\s*\(\s*\)/i);
      expect(String(sql)).toContain('select to_jsonb(t) as "rowData"');
      expect(String(sql)).toContain('from "workspace_test"."person" as t');
      // Params: limit + 1 = 26 (no OFFSET — first page has no keyset cursor)
      expect(params).toEqual([26]);
    });

    it("hasNextPage is true when limit + 1 rows return; sentinel is dropped from data", async () => {
      const planner = makePlanner();
      const filterCompiler = makeFilterCompiler();
      const rows = Array.from({ length: 26 }, (_, i) => ({
        rowData: { id: `id-${i}`, name: `n${i}` },
      }));
      const client = makeClientReturning(rows);
      const dbConnection = makeDbConnection(client);
      const service = new DbRecordsReadService(
        {} as never,
        planner as never,
        filterCompiler as never,
        dbConnection as never,
      );

      const result = await service.list(DB_TARGET, "people", { limit: 25 });

      expect(result.data).toHaveLength(25);
      expect((result.data[0] as { id: string }).id).toBe("id-0");
      expect((result.data[24] as { id: string }).id).toBe("id-24");
      expect(result.pageInfo?.hasNextPage).toBe(true);
      expect(decodeRecordCursor(result.pageInfo?.endCursor as string)).toEqual({
        lastSortValue: "id-24",
        lastId: "id-24",
        sortField: "id",
        sortDirection: "asc",
      });
    });

    it("hasNextPage is false when fewer than limit + 1 rows return", async () => {
      const planner = makePlanner();
      const filterCompiler = makeFilterCompiler();
      const rows = Array.from({ length: 10 }, (_, i) => ({
        rowData: { id: `id-${i}` },
      }));
      const client = makeClientReturning(rows);
      const dbConnection = makeDbConnection(client);
      const service = new DbRecordsReadService(
        {} as never,
        planner as never,
        filterCompiler as never,
        dbConnection as never,
      );

      const result = await service.list(DB_TARGET, "people", { limit: 25 });

      expect(result.data).toHaveLength(10);
      expect(result.pageInfo?.hasNextPage).toBe(false);
    });

    it("totalCount is undefined by default (no count(*) emitted)", async () => {
      const planner = makePlanner();
      const filterCompiler = makeFilterCompiler();
      const client = makeClientReturning([]);
      const dbConnection = makeDbConnection(client);
      const service = new DbRecordsReadService(
        {} as never,
        planner as never,
        filterCompiler as never,
        dbConnection as never,
      );

      const result = await service.list(DB_TARGET, "people", { limit: 25 });

      expect(result.totalCount).toBeUndefined();
    });

    it("totalCount is populated when totalCount: true is passed", async () => {
      const planner = makePlanner();
      const filterCompiler = makeFilterCompiler();
      const client = {
        query: vi.fn().mockResolvedValue({
          rows: [{ rowData: { id: "x", name: "y" }, totalCount: "42" }],
        }),
      };
      const dbConnection = makeDbConnection(client);
      const service = new DbRecordsReadService(
        {} as never,
        planner as never,
        filterCompiler as never,
        dbConnection as never,
      );

      const result = await service.list(DB_TARGET, "people", { limit: 25, totalCount: true });

      expect(result.totalCount).toBe(42);
      const [sql] = client.query.mock.calls[0];
      expect(String(sql)).toMatch(/count\(\*\)\s+over\s*\(\s*\)/i);
    });
  });

  describe("keyset cursor (Twenty-compatible base64-JSON)", () => {
    function makePlanner() {
      return {
        planObject: vi.fn().mockResolvedValue({
          objectMetadata: { id: "person-id", nameSingular: "person", namePlural: "people" },
          tableName: "person",
          includes: [],
        }),
      };
    }

    function makeFilterCompiler() {
      return { compile: vi.fn().mockReturnValue([]) };
    }

    function makeClientReturning(rows: Array<Record<string, unknown>>) {
      return {
        query: vi.fn().mockResolvedValue({ rows }),
      };
    }

    function makeDbConnection(client: { query: ReturnType<typeof vi.fn> }) {
      return {
        withClient: vi
          .fn()
          .mockImplementation(
            async (_options: unknown, fn: (c: typeof client) => Promise<unknown>) => fn(client),
          ),
      };
    }

    it("rejects legacy db:<offset> cursor with UnsupportedDbReadError", async () => {
      const planner = makePlanner();
      const filterCompiler = makeFilterCompiler();
      const client = makeClientReturning([]);
      const dbConnection = makeDbConnection(client);
      const service = new DbRecordsReadService(
        {} as never,
        planner as never,
        filterCompiler as never,
        dbConnection as never,
      );

      await expect(service.list(DB_TARGET, "people", { cursor: "db:42" })).rejects.toBeInstanceOf(
        UnsupportedDbReadError,
      );

      // Legacy cursor is rejected before any DB query is issued.
      expect(client.query).not.toHaveBeenCalled();
    });

    it("rejects garbage cursor with UnsupportedDbReadError", async () => {
      const planner = makePlanner();
      const filterCompiler = makeFilterCompiler();
      const client = makeClientReturning([]);
      const dbConnection = makeDbConnection(client);
      const service = new DbRecordsReadService(
        {} as never,
        planner as never,
        filterCompiler as never,
        dbConnection as never,
      );

      await expect(
        service.list(DB_TARGET, "people", { cursor: "!!!not-base64!!!" }),
      ).rejects.toBeInstanceOf(UnsupportedDbReadError);
    });

    it("first page (no cursor) emits ORDER BY but no keyset WHERE", async () => {
      const planner = makePlanner();
      const filterCompiler = makeFilterCompiler();
      const client = makeClientReturning([]);
      const dbConnection = makeDbConnection(client);
      const service = new DbRecordsReadService(
        {} as never,
        planner as never,
        filterCompiler as never,
        dbConnection as never,
      );

      await service.list(DB_TARGET, "people", { limit: 10 });

      const [sql, params] = client.query.mock.calls[0];
      const sqlStr = String(sql);
      expect(sqlStr).toContain('order by t."id" asc');
      // No keyset WHERE clause on the first page.
      expect(sqlStr).not.toMatch(/t\."id"\s*[<>]\s*\$/);
      // Only the limit param — no cursor params.
      expect(params).toEqual([11]);
    });

    it("subsequent page (with cursor) emits keyset WHERE with cursor params", async () => {
      const planner = makePlanner();
      const filterCompiler = makeFilterCompiler();
      const client = makeClientReturning([]);
      const dbConnection = makeDbConnection(client);
      const service = new DbRecordsReadService(
        {} as never,
        planner as never,
        filterCompiler as never,
        dbConnection as never,
      );

      const cursor: RecordListCursor = {
        lastSortValue: "2026-04-01T00:00:00.000Z",
        lastId: "person-1",
        sortField: "createdAt",
        sortDirection: "desc",
      };

      await service.list(DB_TARGET, "people", {
        limit: 10,
        cursor: encodeRecordCursor(cursor),
      });

      const [sql, params] = client.query.mock.calls[0];
      const sqlStr = String(sql);
      // Keyset clause for desc sort: < comparator + id::text > tiebreaker.
      expect(sqlStr).toMatch(/t\."createdAt"\s*<\s*\$1/);
      expect(sqlStr).toMatch(/t\."createdAt"\s*=\s*\$1/);
      expect(sqlStr).toMatch(/t\."id"::text\s*>\s*\$2/);
      expect(sqlStr).toContain('order by t."createdAt" desc nulls last, t."id" asc');
      // Params: [lastSortValue, lastId, limit + 1].
      expect(params).toEqual(["2026-04-01T00:00:00.000Z", "person-1", 11]);
    });

    it("subsequent page asc sort uses > comparator", async () => {
      const planner = makePlanner();
      const filterCompiler = makeFilterCompiler();
      const client = makeClientReturning([]);
      const dbConnection = makeDbConnection(client);
      const service = new DbRecordsReadService(
        {} as never,
        planner as never,
        filterCompiler as never,
        dbConnection as never,
      );

      const cursor: RecordListCursor = {
        lastSortValue: "Acme",
        lastId: "company-1",
        sortField: "name",
        sortDirection: "asc",
      };

      await service.list(DB_TARGET, "people", {
        limit: 5,
        cursor: encodeRecordCursor(cursor),
      });

      const [sql] = client.query.mock.calls[0];
      const sqlStr = String(sql);
      expect(sqlStr).toMatch(/t\."name"\s*>\s*\$1/);
      expect(sqlStr).toContain('order by t."name" asc nulls first, t."id" asc');
    });

    it("end cursor on a populated page captures the last row's sort value and id", async () => {
      const planner = makePlanner();
      const filterCompiler = makeFilterCompiler();
      const client = makeClientReturning([
        { rowData: { id: "p-1", createdAt: "2026-04-01" } },
        { rowData: { id: "p-2", createdAt: "2026-04-02" } },
        { rowData: { id: "p-3", createdAt: "2026-04-03" } },
      ]);
      const dbConnection = makeDbConnection(client);
      const service = new DbRecordsReadService(
        {} as never,
        planner as never,
        filterCompiler as never,
        dbConnection as never,
      );

      const result = await service.list(DB_TARGET, "people", {
        limit: 5,
        sort: "createdAt",
        order: "desc",
      });

      // Three rows is fewer than limit + 1 (=6), so no sentinel → hasNextPage false.
      expect(result.pageInfo?.hasNextPage).toBe(false);
      const decoded = decodeRecordCursor(result.pageInfo?.endCursor as string);
      expect(decoded).toEqual({
        lastSortValue: "2026-04-03",
        lastId: "p-3",
        sortField: "createdAt",
        sortDirection: "desc",
      });
    });

    it("end cursor is undefined when the page is empty", async () => {
      const planner = makePlanner();
      const filterCompiler = makeFilterCompiler();
      const client = makeClientReturning([]);
      const dbConnection = makeDbConnection(client);
      const service = new DbRecordsReadService(
        {} as never,
        planner as never,
        filterCompiler as never,
        dbConnection as never,
      );

      const result = await service.list(DB_TARGET, "people", { limit: 5 });

      expect(result.data).toEqual([]);
      expect(result.pageInfo?.hasNextPage).toBe(false);
      expect(result.pageInfo?.endCursor).toBeUndefined();
    });

    it("decoded cursor's sort field and direction override --sort / --order", async () => {
      // The CLI normally feeds back the prior endCursor verbatim, so the cursor
      // itself defines the active sort. If the caller also passes --sort/--order,
      // the cursor wins so subsequent pages stay coherent with page 1.
      const planner = makePlanner();
      const filterCompiler = makeFilterCompiler();
      const client = makeClientReturning([]);
      const dbConnection = makeDbConnection(client);
      const service = new DbRecordsReadService(
        {} as never,
        planner as never,
        filterCompiler as never,
        dbConnection as never,
      );

      const cursor: RecordListCursor = {
        lastSortValue: "X",
        lastId: "id-1",
        sortField: "createdAt",
        sortDirection: "desc",
      };

      await service.list(DB_TARGET, "people", {
        limit: 5,
        // Caller sends conflicting sort; cursor takes precedence.
        sort: "name",
        order: "asc",
        cursor: encodeRecordCursor(cursor),
      });

      const [sql] = client.query.mock.calls[0];
      const sqlStr = String(sql);
      expect(sqlStr).toContain('order by t."createdAt" desc');
      expect(sqlStr).not.toContain('order by t."name"');
    });
  });
});
