import { Command } from "commander";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

import { SchemaCacheEntry } from "../schema-cache.service";
import {
  extractCoreRecordResources,
  extractMetadataResources,
  registerCachedSchemaCommands,
} from "../schema-command-materializer";

vi.mock("../../shared/services", () => ({
  createServices: vi.fn(),
}));

import { createServices } from "../../shared/services";

const coreEntry: SchemaCacheEntry = {
  schemaVersion: 1,
  kind: "core-openapi",
  baseUrl: "https://crm.acme.com/",
  workspace: "default",
  fetchedAt: "2026-04-26T00:00:00.000Z",
  contentHash: "core-hash",
  schema: {
    openapi: "3.1.0",
    paths: {
      "/people": {
        get: { operationId: "listPeople" },
        post: { operationId: "createPerson" },
        patch: { operationId: "updatePeople" },
        delete: { operationId: "deletePeople" },
      },
      "/people/{id}": {
        get: { operationId: "getPerson" },
        patch: { operationId: "updatePerson" },
        delete: { operationId: "deletePerson" },
      },
      "/batch/people": {
        post: { operationId: "batchCreatePeople" },
        patch: { operationId: "batchUpdatePeople" },
        delete: { operationId: "batchDeletePeople" },
      },
      "/people/groupBy": {
        get: { operationId: "groupPeople" },
      },
      "/restore/people": {
        patch: { operationId: "restorePeople" },
      },
      "/restore/people/{id}": {
        patch: { operationId: "restorePerson" },
      },
    },
  },
};

const metadataEntry: SchemaCacheEntry = {
  schemaVersion: 1,
  kind: "metadata-openapi",
  baseUrl: "https://crm.acme.com/",
  workspace: "default",
  fetchedAt: "2026-04-26T00:00:00.000Z",
  contentHash: "metadata-hash",
  schema: {
    openapi: "3.1.0",
    paths: {
      "/metadata/views": {
        get: { operationId: "listViews" },
        post: { operationId: "createView" },
      },
      "/metadata/views/{id}": {
        get: { operationId: "getView" },
        patch: { operationId: "updateView" },
        delete: { operationId: "deleteView" },
      },
      "/apiKeys": {
        get: { operationId: "listApiKeys" },
        post: { operationId: "createApiKey" },
      },
      "/apiKeys/{id}": {
        get: { operationId: "getApiKey" },
        patch: { operationId: "updateApiKey" },
        delete: { operationId: "deleteApiKey" },
      },
    },
  },
};

function createMockServices() {
  return {
    records: {
      list: vi.fn().mockResolvedValue({ data: [{ id: "person-1" }] }),
      get: vi.fn().mockResolvedValue({ id: "person-1" }),
      create: vi.fn().mockResolvedValue({ id: "person-2" }),
      update: vi.fn().mockResolvedValue({ id: "person-1", name: "Updated" }),
      updateMany: vi.fn().mockResolvedValue([{ id: "person-1", name: "Updated" }]),
      delete: vi.fn().mockResolvedValue({ id: "person-1", deleted: true }),
      destroy: vi.fn().mockResolvedValue({ id: "person-1", destroyed: true }),
      destroyMany: vi.fn().mockResolvedValue([{ id: "person-1", destroyed: true }]),
      restore: vi.fn().mockResolvedValue({ id: "person-1", deletedAt: null }),
      restoreMany: vi.fn().mockResolvedValue([{ id: "person-1", deletedAt: null }]),
      batchCreate: vi.fn().mockResolvedValue([]),
      batchUpdate: vi.fn().mockResolvedValue([]),
      batchDelete: vi.fn().mockResolvedValue([]),
      groupBy: vi.fn().mockResolvedValue([]),
    },
    api: {
      get: vi.fn().mockResolvedValue({ data: [{ id: "view-1" }] }),
      post: vi.fn().mockResolvedValue({ data: { id: "view-2" } }),
      patch: vi.fn().mockResolvedValue({ data: { id: "view-1", name: "Updated" } }),
      delete: vi.fn().mockResolvedValue({ data: { id: "view-1", deleted: true } }),
    },
    output: {
      render: vi.fn(),
    },
  };
}

describe("schema command materializer", () => {
  let program: Command;
  let mockServices: ReturnType<typeof createMockServices>;

  beforeEach(() => {
    program = new Command();
    program.exitOverride();
    mockServices = createMockServices();
    vi.mocked(createServices).mockReturnValue(mockServices as any);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("extracts record resources from cached core OpenAPI paths", () => {
    expect(extractCoreRecordResources(coreEntry.schema)).toEqual([
      {
        apiName: "people",
        operations: [
          "batch-create",
          "batch-delete",
          "batch-update",
          "create",
          "delete",
          "destroy",
          "get",
          "group-by",
          "list",
          "restore",
          "update",
        ],
      },
    ]);
  });

  it("skips malformed cached core OpenAPI path entries", () => {
    expect(
      extractCoreRecordResources({
        paths: {
          "/broken": null,
          "/also-broken": "not a path item",
          "/companies": { get: { operationId: "listCompanies" } },
          "/companies/{id}": { delete: { operationId: "deleteCompany" } },
        },
      }),
    ).toEqual([
      {
        apiName: "companies",
        operations: ["delete", "destroy", "list"],
      },
    ]);
  });

  it("extracts metadata resources from cached metadata OpenAPI paths", () => {
    expect(extractMetadataResources(metadataEntry.schema)).toEqual([
      {
        apiName: "apiKeys",
        operations: ["create", "delete", "get", "list", "update"],
      },
      {
        apiName: "views",
        operations: ["create", "delete", "get", "list", "update"],
      },
    ]);
  });

  it("skips malformed cached metadata OpenAPI path entries", () => {
    expect(
      extractMetadataResources({
        paths: {
          "/metadata/broken": null,
          "/views": { get: { operationId: "listViews" } },
        },
      }),
    ).toEqual([
      {
        apiName: "views",
        operations: ["list"],
      },
    ]);
  });

  it("registers cache-backed records and metadata command trees", () => {
    registerCachedSchemaCommands(program, {
      coreOpenApi: coreEntry,
      metadataOpenApi: metadataEntry,
    });

    const records = program.commands.find((command) => command.name() === "records");
    const metadata = program.commands.find((command) => command.name() === "metadata");

    expect(records?.commands.map((command) => command.name())).toEqual(["people"]);
    expect(records?.commands[0]?.commands.map((command) => command.name())).toEqual([
      "batch-create",
      "batch-delete",
      "batch-update",
      "create",
      "delete",
      "destroy",
      "get",
      "group-by",
      "list",
      "restore",
      "update",
    ]);
    expect(metadata?.commands.map((command) => command.name())).toEqual(["api-keys", "views"]);
    expect(metadata?.commands.find((command) => command.name() === "api-keys")?.aliases()).toEqual(
      [],
    );
    expect(
      metadata?.commands
        .find((command) => command.name() === "views")
        ?.commands.map((command) => command.name()),
    ).toEqual(["create", "delete", "get", "list", "update"]);
  });

  it("registers kebab-case command names for cache-backed resource commands", async () => {
    registerCachedSchemaCommands(program, {
      coreOpenApi: {
        ...coreEntry,
        schema: {
          paths: {
            "/approvedAccessDomains": {
              get: { operationId: "listApprovedAccessDomains" },
            },
          },
        },
      },
      metadataOpenApi: metadataEntry,
    });

    const records = program.commands.find((command) => command.name() === "records");
    const metadata = program.commands.find((command) => command.name() === "metadata");
    expect(
      records?.commands.find((command) => command.name() === "approved-access-domains"),
    ).toBeDefined();
    expect(
      records?.commands
        .find((command) => command.name() === "approved-access-domains")
        ?.description(),
    ).toBe("Cached record commands for approved-access-domains");
    expect(
      records?.commands
        .find((command) => command.name() === "approved-access-domains")
        ?.commands.find((command) => command.name() === "list")
        ?.description(),
    ).toBe("List approved-access-domains");
    expect(
      records?.commands.find((command) => command.name() === "approved-access-domains")?.aliases(),
    ).toEqual([]);
    expect(metadata?.commands.find((command) => command.name() === "api-keys")).toBeDefined();
    expect(metadata?.commands.find((command) => command.name() === "api-keys")?.description()).toBe(
      "Cached metadata commands for api-keys",
    );
    expect(metadata?.commands.find((command) => command.name() === "api-keys")?.aliases()).toEqual(
      [],
    );

    await program.parseAsync([
      "node",
      "test",
      "records",
      "approved-access-domains",
      "list",
      "--limit",
      "1",
    ]);
    await program.parseAsync(["node", "test", "metadata", "api-keys", "list"]);

    expect(mockServices.records.list).toHaveBeenCalledWith("approvedAccessDomains", {
      limit: 1,
      cursor: undefined,
      filter: undefined,
      sort: undefined,
      order: undefined,
    });
    expect(mockServices.api.get).toHaveBeenCalledWith("/rest/metadata/apiKeys", {
      params: {},
    });
  });

  it("executes dynamic records operations through the records service", async () => {
    registerCachedSchemaCommands(program, { coreOpenApi: coreEntry });

    await program.parseAsync(["node", "test", "records", "people", "list", "--limit", "5"]);
    await program.parseAsync(["node", "test", "records", "people", "get", "person-1"]);
    await program.parseAsync(["node", "test", "records", "people", "group-by", "--field", "city"]);

    expect(mockServices.records.list).toHaveBeenCalledWith("people", {
      limit: 5,
      cursor: undefined,
      filter: undefined,
      sort: undefined,
      order: undefined,
    });
    expect(mockServices.records.get).toHaveBeenCalledWith("people", "person-1", {
      include: undefined,
    });
    expect(mockServices.records.groupBy).toHaveBeenCalledWith("people", {
      groupBy: [{ city: true }],
    });
    expect(mockServices.output.render).toHaveBeenCalledWith(
      { data: [{ id: "person-1" }] },
      { format: "json", query: undefined },
    );
    expect(mockServices.output.render).toHaveBeenCalledWith(
      { id: "person-1" },
      { format: "json", query: undefined },
    );
  });

  it("executes dynamic metadata operations through REST metadata endpoints", async () => {
    registerCachedSchemaCommands(program, { metadataOpenApi: metadataEntry });

    await program.parseAsync(["node", "test", "metadata", "views", "list"]);
    await program.parseAsync(["node", "test", "metadata", "views", "delete", "view-1"]);

    expect(mockServices.api.get).toHaveBeenCalledWith("/rest/metadata/views", {
      params: {},
    });
    expect(mockServices.api.delete).toHaveBeenCalledWith("/rest/metadata/views/view-1");
    expect(mockServices.output.render).toHaveBeenCalledWith([{ id: "view-1" }], {
      format: "json",
      query: undefined,
    });
    expect(mockServices.output.render).toHaveBeenCalledWith(
      { id: "view-1", deleted: true },
      { format: "json", query: undefined },
    );
  });

  it("requires --yes for dynamic destructive records operations", async () => {
    registerCachedSchemaCommands(program, { coreOpenApi: coreEntry });

    const deleteCommand = program.commands
      .find((command) => command.name() === "records")
      ?.commands.find((command) => command.name() === "people")
      ?.commands.find((command) => command.name() === "delete");

    expect(deleteCommand?.options.find((option) => option.long === "--yes")).toBeDefined();
    await expect(
      program.parseAsync(["node", "test", "records", "people", "delete", "person-1"]),
    ).rejects.toMatchObject({
      message: "Delete requires --yes.",
    });
    expect(mockServices.records.delete).not.toHaveBeenCalled();

    await program.parseAsync(["node", "test", "records", "people", "delete", "person-1", "--yes"]);

    expect(mockServices.records.delete).toHaveBeenCalledWith("people", "person-1");
  });

  it("executes dynamic bulk record operations through the records service", async () => {
    registerCachedSchemaCommands(program, { coreOpenApi: coreEntry });

    await program.parseAsync([
      "node",
      "test",
      "records",
      "people",
      "batch-update",
      "--data",
      '{"name":"Updated"}',
      "--ids",
      "person-1,person-2",
    ]);
    await program.parseAsync([
      "node",
      "test",
      "records",
      "people",
      "batch-delete",
      "--data",
      '["person-1","person-2"]',
      "--yes",
    ]);
    await program.parseAsync(["node", "test", "records", "people", "restore", "--ids", "person-1"]);
    await program.parseAsync([
      "node",
      "test",
      "records",
      "people",
      "destroy",
      "--ids",
      "person-1",
      "--yes",
    ]);

    expect(mockServices.records.updateMany).toHaveBeenCalledWith(
      "people",
      { name: "Updated" },
      { filter: "id[in]:[person-1,person-2]" },
    );
    expect(mockServices.records.batchDelete).toHaveBeenCalledWith("people", [
      "person-1",
      "person-2",
    ]);
    expect(mockServices.records.restoreMany).toHaveBeenCalledWith("people", {
      filter: "id[in]:[person-1]",
    });
    expect(mockServices.records.destroyMany).toHaveBeenCalledWith("people", {
      filter: "id[in]:[person-1]",
    });
  });

  it("still registers empty parent namespaces when no cached schema entries exist", () => {
    registerCachedSchemaCommands(program, {});

    expect(program.commands.find((command) => command.name() === "records")).toBeDefined();
    expect(program.commands.find((command) => command.name() === "metadata")).toBeDefined();
  });
});
