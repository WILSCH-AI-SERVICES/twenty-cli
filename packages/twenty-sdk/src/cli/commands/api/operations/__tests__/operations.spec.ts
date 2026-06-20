import { Command } from "commander";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { CliError } from "../../../../utilities/errors/cli-error";
import { registerApiCommand } from "../../api.command";
import { runBatchCreateOperation } from "../batch-create.operation";
import { runBatchDeleteOperation } from "../batch-delete.operation";
import { runBatchUpdateOperation } from "../batch-update.operation";
import { runCreateOperation } from "../create.operation";
import { runDeleteOperation } from "../delete.operation";
import { runDestroyOperation } from "../destroy.operation";
import { runExportOperation } from "../export.operation";
import { runGetOperation } from "../get.operation";
import { runImportOperation } from "../import.operation";
import { runListOperation } from "../list.operation";
import { runMergeOperation } from "../merge.operation";
import { runRestoreOperation } from "../restore.operation";
import { ApiOperationContext } from "../types";
import { runUpdateOperation } from "../update.operation";

const mockCreateCommandContext = vi.hoisted(() => vi.fn());

vi.mock("../../../../utilities/shared/context", async () => {
  const actual = await vi.importActual<typeof import("../../../../utilities/shared/context")>(
    "../../../../utilities/shared/context",
  );

  return {
    ...actual,
    createCommandContext: mockCreateCommandContext,
  };
});

// Mock the body utility
vi.mock("../../../../utilities/shared/body", () => ({
  parseBody: vi.fn().mockImplementation(async (data: string | undefined) => {
    if (data) return JSON.parse(data);
    return {};
  }),
  parseArrayPayload: vi.fn().mockImplementation(async (data: string | undefined) => {
    if (data) return JSON.parse(data);
    return [];
  }),
}));

// Mock the io utility
vi.mock("../../../../utilities/shared/io", () => ({
  readJsonInput: vi.fn().mockImplementation(async (data: string | undefined) => {
    if (data) return JSON.parse(data);
    return undefined;
  }),
}));

function createMockContext(overrides: Partial<ApiOperationContext> = {}): ApiOperationContext {
  return {
    object: "people",
    arg: undefined,
    options: {},
    globalOptions: { output: "json" },
    services: {
      api: {} as any,
      records: {
        create: vi.fn().mockResolvedValue({ id: "test-id", name: "Test" }),
        update: vi.fn().mockResolvedValue({ id: "test-id", name: "Updated" }),
        delete: vi.fn().mockResolvedValue(undefined),
        get: vi.fn().mockResolvedValue({ id: "test-id", name: "Test" }),
        list: vi.fn().mockResolvedValue({ data: [{ id: "1" }, { id: "2" }] }),
        listAll: vi.fn().mockResolvedValue({ data: [{ id: "1" }, { id: "2" }, { id: "3" }] }),
        destroy: vi.fn().mockResolvedValue(undefined),
        destroyMany: vi.fn().mockResolvedValue([{ id: "1" }, { id: "2" }]),
        restore: vi.fn().mockResolvedValue({ id: "test-id", deletedAt: null }),
        restoreMany: vi.fn().mockResolvedValue([{ id: "1" }, { id: "2" }]),
        merge: vi.fn().mockResolvedValue({ id: "merged-id" }),
        batchCreate: vi.fn().mockResolvedValue([{ id: "1" }, { id: "2" }]),
        batchUpdate: vi.fn().mockResolvedValue([{ id: "1" }, { id: "2" }]),
        updateMany: vi.fn().mockResolvedValue([{ id: "1" }, { id: "2" }]),
        batchDelete: vi.fn().mockResolvedValue({ deleted: 2 }),
        findDuplicates: vi.fn(),
        groupBy: vi.fn(),
      } as any,
      metadata: {} as any,
      output: {
        render: vi.fn(),
      } as any,
      importer: {
        import: vi.fn().mockResolvedValue([{ name: "Test1" }, { name: "Test2" }]),
      } as any,
      exporter: {
        export: vi.fn(),
      } as any,
    },
    ...overrides,
  } as ApiOperationContext;
}

describe("API Operations", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    vi.clearAllMocks();
  });

  describe("registerApiCommand", () => {
    let program: Command;
    let mockDelete: ReturnType<typeof vi.fn>;
    let mockDestroy: ReturnType<typeof vi.fn>;
    let mockDestroyMany: ReturnType<typeof vi.fn>;
    let mockBatchDelete: ReturnType<typeof vi.fn>;
    let mockOutputRender: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      program = new Command();
      program.exitOverride();
      registerApiCommand(program);
      mockDelete = vi.fn();
      mockDestroy = vi.fn();
      mockDestroyMany = vi.fn();
      mockBatchDelete = vi.fn();
      mockOutputRender = vi.fn();
      mockCreateCommandContext.mockReset();
      mockCreateCommandContext.mockReturnValue({
        globalOptions: {
          output: "json",
          query: undefined,
        },
        services: {
          records: {
            delete: mockDelete,
            destroy: mockDestroy,
            destroyMany: mockDestroyMany,
            batchDelete: mockBatchDelete,
          },
          output: {
            render: mockOutputRender,
          },
        },
      } as never);
    });

    it("registers explicit subcommands for record operations", () => {
      const apiCmd = program.commands.find((command) => command.name() === "api");
      const subcommands = apiCmd?.commands.map((command) => command.name()) ?? [];

      expect(subcommands).toEqual(
        expect.arrayContaining([
          "list",
          "get",
          "create",
          "update",
          "delete",
          "destroy",
          "batch-create",
          "batch-update",
          "batch-delete",
          "import",
          "export",
          "find-duplicates",
          "group-by",
          "merge",
          "restore",
        ]),
      );
    });

    it("routes delete through the registered command", async () => {
      mockDelete.mockResolvedValue(undefined);

      await program.parseAsync(["node", "test", "api", "delete", "people", "record-123", "--yes"]);

      expect(mockDelete).toHaveBeenCalledWith("people", "record-123");
      expect(mockOutputRender).not.toHaveBeenCalled();
    });
  });

  // ==================== CREATE OPERATION ====================
  describe("runCreateOperation", () => {
    it("creates record with --data and renders output", async () => {
      const ctx = createMockContext({
        options: { data: '{"name":"Test Person"}' },
      });

      await runCreateOperation(ctx);

      expect(ctx.services.records.create).toHaveBeenCalledWith("people", { name: "Test Person" });
      expect(ctx.services.output.render).toHaveBeenCalledWith(
        { id: "test-id", name: "Test" },
        { format: "json", query: undefined },
      );
    });

    it("propagates error when create fails", async () => {
      const ctx = createMockContext({
        options: { data: '{"name":"Test"}' },
      });
      (ctx.services.records.create as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("API error"),
      );

      await expect(runCreateOperation(ctx)).rejects.toThrow("API error");
    });
  });

  // ==================== UPDATE OPERATION ====================
  describe("runUpdateOperation", () => {
    it("updates record with ID and renders output", async () => {
      const ctx = createMockContext({
        arg: "record-123",
        options: { data: '{"name":"Updated Name"}' },
      });

      await runUpdateOperation(ctx);

      expect(ctx.services.records.update).toHaveBeenCalledWith("people", "record-123", {
        name: "Updated Name",
      });
      expect(ctx.services.output.render).toHaveBeenCalled();
    });

    it("throws CliError when ID is missing", async () => {
      const ctx = createMockContext({
        arg: undefined,
        options: { data: '{"name":"Test"}' },
      });

      await expect(runUpdateOperation(ctx)).rejects.toThrow(CliError);
      await expect(runUpdateOperation(ctx)).rejects.toThrow("Missing record ID");
    });
  });

  // ==================== DELETE OPERATION ====================
  describe("runDeleteOperation", () => {
    it("deletes record when --yes is provided", async () => {
      const ctx = createMockContext({
        arg: "record-123",
        options: { yes: true },
      });

      await runDeleteOperation(ctx);

      expect(ctx.services.records.delete).toHaveBeenCalledWith("people", "record-123");
      expect(consoleSpy).toHaveBeenCalledWith("Deleted people record-123");
    });

    it("requires --yes before deleting", async () => {
      const ctx = createMockContext({
        arg: "record-123",
        options: {},
      });

      await expect(runDeleteOperation(ctx)).rejects.toMatchObject({
        message: "Delete requires --yes.",
        code: "INVALID_ARGUMENTS",
        suggestion: "Re-run with --yes to confirm delete.",
      });
      expect(ctx.services.records.delete).not.toHaveBeenCalled();
    });

    it("throws CliError when ID is missing", async () => {
      const ctx = createMockContext({
        arg: undefined,
        options: { yes: true },
      });

      await expect(runDeleteOperation(ctx)).rejects.toThrow(CliError);
      await expect(runDeleteOperation(ctx)).rejects.toThrow("Missing record ID");
    });

    it("renders response if delete returns data", async () => {
      const ctx = createMockContext({
        arg: "record-123",
        options: { yes: true },
      });
      (ctx.services.records.delete as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: "record-123",
        deleted: true,
      });

      await runDeleteOperation(ctx);

      expect(ctx.services.output.render).toHaveBeenCalledWith(
        { id: "record-123", deleted: true },
        expect.any(Object),
      );
    });
  });

  // ==================== GET OPERATION ====================
  describe("runGetOperation", () => {
    it("gets record by ID and renders output", async () => {
      const ctx = createMockContext({
        arg: "record-123",
        options: { include: "company,notes" },
      });

      await runGetOperation(ctx);

      expect(ctx.services.records.get).toHaveBeenCalledWith("people", "record-123", {
        include: "company,notes",
      });
      expect(ctx.services.output.render).toHaveBeenCalled();
    });

    it("throws CliError when ID is missing", async () => {
      const ctx = createMockContext({
        arg: undefined,
      });

      await expect(runGetOperation(ctx)).rejects.toThrow(CliError);
      await expect(runGetOperation(ctx)).rejects.toThrow("Missing record ID");
    });
  });

  // ==================== LIST OPERATION ====================
  describe("runListOperation", () => {
    it("lists records with pagination options", async () => {
      const ctx = createMockContext({
        options: {
          limit: "10",
          cursor: "abc123",
          filter: "name[eq]=Test",
          sort: "createdAt",
          order: "desc",
        },
      });

      await runListOperation(ctx);

      expect(ctx.services.records.list).toHaveBeenCalledWith("people", {
        limit: 10,
        cursor: "abc123",
        filter: "name[eq]=Test",
        include: undefined,
        sort: "createdAt",
        order: "desc",
        params: {},
      });
      expect(ctx.services.output.render).toHaveBeenCalled();
    });

    it("uses listAll when --all is provided", async () => {
      const ctx = createMockContext({
        options: { all: true },
      });

      await runListOperation(ctx);

      expect(ctx.services.records.listAll).toHaveBeenCalledWith(
        "people",
        expect.objectContaining({
          limit: 200,
          maxRecords: 10000,
          maxRecordsErrorMessage: expect.stringContaining("api list --all exceeded"),
        }),
      );
      expect(ctx.services.records.list).not.toHaveBeenCalled();
    });

    it("rejects invalid list limits and max-record caps", async () => {
      await expect(
        runListOperation(createMockContext({ options: { limit: "0" } })),
      ).rejects.toThrow("--limit must be an integer between 1 and 500.");
      await expect(
        runListOperation(createMockContext({ options: { all: true, maxRecords: "1000001" } })),
      ).rejects.toThrow("--max-records must be an integer between 1 and 1000000.");
    });

    it("parses key-value params correctly", async () => {
      const ctx = createMockContext({
        options: {
          param: ["depth=2", "include_deleted=true"],
        },
      });

      await runListOperation(ctx);

      expect(ctx.services.records.list).toHaveBeenCalledWith(
        "people",
        expect.objectContaining({
          params: { depth: ["2"], include_deleted: ["true"] },
        }),
      );
    });

    it("rejects --fields because upstream list routes do not parse it", async () => {
      const ctx = createMockContext({
        options: {
          fields: "id,name",
        },
      });

      await expect(runListOperation(ctx)).rejects.toThrow(CliError);
      await expect(runListOperation(ctx)).rejects.toThrow(
        "--fields is not supported for list. Twenty REST find-many only supports depth-based field expansion.",
      );
    });
  });

  // ==================== DESTROY OPERATION ====================
  describe("runDestroyOperation", () => {
    it("destroys record when --yes is provided", async () => {
      const ctx = createMockContext({
        arg: "record-123",
        options: { yes: true },
      });

      await runDestroyOperation(ctx);

      expect(ctx.services.records.destroy).toHaveBeenCalledWith("people", "record-123");
      expect(consoleSpy).toHaveBeenCalledWith("Destroyed people record-123");
    });

    it("requires --yes before destroying", async () => {
      const ctx = createMockContext({
        arg: "record-123",
        options: {},
      });

      await expect(runDestroyOperation(ctx)).rejects.toMatchObject({
        message: "Destroy requires --yes.",
        code: "INVALID_ARGUMENTS",
        suggestion: "Re-run with --yes to confirm destroy.",
      });
      expect(ctx.services.records.destroy).not.toHaveBeenCalled();
    });

    it("throws CliError when ID is missing", async () => {
      const ctx = createMockContext({
        arg: undefined,
        options: { yes: true },
      });

      await expect(runDestroyOperation(ctx)).rejects.toThrow(CliError);
    });

    it("destroys many records when ids are provided with --yes", async () => {
      const ctx = createMockContext({
        arg: undefined,
        options: { yes: true, ids: "record-1,record-2" },
      });

      await runDestroyOperation(ctx);

      expect(ctx.services.records.destroyMany).toHaveBeenCalledWith("people", {
        filter: "id[in]:[record-1,record-2]",
      });
      expect(ctx.services.output.render).toHaveBeenCalled();
    });
    it("requires a target before checking --yes", async () => {
      const ctx = createMockContext({
        arg: undefined,
        options: {},
      });

      await expect(runDestroyOperation(ctx)).rejects.toThrow("Missing record ID");
    });
  });

  // ==================== RESTORE OPERATION ====================
  describe("runRestoreOperation", () => {
    it("restores record by ID and renders output", async () => {
      const ctx = createMockContext({
        arg: "record-123",
      });

      await runRestoreOperation(ctx);

      expect(ctx.services.records.restore).toHaveBeenCalledWith("people", "record-123");
      expect(ctx.services.output.render).toHaveBeenCalled();
    });

    it("throws CliError when ID is missing", async () => {
      const ctx = createMockContext({
        arg: undefined,
      });

      await expect(runRestoreOperation(ctx)).rejects.toThrow(CliError);
      await expect(runRestoreOperation(ctx)).rejects.toThrow("Missing record ID");
    });

    it("restores many records when a filter is provided", async () => {
      const ctx = createMockContext({
        arg: undefined,
        options: { filter: "deletedAt[is]:not_null" },
      });

      await runRestoreOperation(ctx);

      expect(ctx.services.records.restoreMany).toHaveBeenCalledWith("people", {
        filter: "deletedAt[is]:not_null",
      });
      expect(ctx.services.output.render).toHaveBeenCalled();
    });
  });

  // ==================== IMPORT OPERATION ====================
  describe("runImportOperation", () => {
    it("imports records from file and batch creates them", async () => {
      const ctx = createMockContext({
        arg: "/path/to/data.csv",
        options: {},
      });

      await runImportOperation(ctx);

      expect(ctx.services.importer.import).toHaveBeenCalledWith("/path/to/data.csv", {
        dryRun: undefined,
      });
      expect(ctx.services.records.batchCreate).toHaveBeenCalledWith("people", [
        { name: "Test1" },
        { name: "Test2" },
      ]);
      expect(consoleSpy).toHaveBeenCalledWith("Import complete: 2 imported.");
    });

    it("throws CliError when file path is missing", async () => {
      const ctx = createMockContext({
        arg: undefined,
      });

      await expect(runImportOperation(ctx)).rejects.toThrow(CliError);
      await expect(runImportOperation(ctx)).rejects.toThrow("Missing import file path");
    });

    it("does not create records in dry-run mode", async () => {
      const ctx = createMockContext({
        arg: "/path/to/data.csv",
        options: { dryRun: true },
      });

      await runImportOperation(ctx);

      expect(ctx.services.importer.import).toHaveBeenCalledWith("/path/to/data.csv", {
        dryRun: true,
      });
      expect(ctx.services.records.batchCreate).not.toHaveBeenCalled();
    });

    it("handles empty import gracefully", async () => {
      const ctx = createMockContext({
        arg: "/path/to/empty.csv",
      });
      (ctx.services.importer.import as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      await runImportOperation(ctx);

      expect(consoleSpy).toHaveBeenCalledWith("No records to import.");
      expect(ctx.services.records.batchCreate).not.toHaveBeenCalled();
    });

    it("continues on error when --continue-on-error is set", async () => {
      const ctx = createMockContext({
        arg: "/path/to/data.csv",
        options: { continueOnError: true, batchSize: "1" },
      });
      (ctx.services.importer.import as ReturnType<typeof vi.fn>).mockResolvedValue([
        { name: "Test1" },
        { name: "Test2" },
      ]);
      (ctx.services.records.batchCreate as ReturnType<typeof vi.fn>)
        .mockRejectedValueOnce(new Error("Batch 1 failed"))
        .mockResolvedValueOnce([{ id: "2" }]);

      await runImportOperation(ctx);

      expect(consoleSpy).toHaveBeenCalledWith("Import complete: 1 imported, 1 failed.");
    });

    it("caps batch size at 60", async () => {
      const ctx = createMockContext({
        arg: "/path/to/data.csv",
        options: { batchSize: "100" },
      });
      const manyRecords = Array.from({ length: 120 }, (_, i) => ({ name: `Test${i}` }));
      (ctx.services.importer.import as ReturnType<typeof vi.fn>).mockResolvedValue(manyRecords);

      await runImportOperation(ctx);

      // Should have been called twice with batches of 60
      expect(ctx.services.records.batchCreate).toHaveBeenCalledTimes(2);
      expect(
        (ctx.services.records.batchCreate as ReturnType<typeof vi.fn>).mock.calls[0][1],
      ).toHaveLength(60);
      expect(
        (ctx.services.records.batchCreate as ReturnType<typeof vi.fn>).mock.calls[1][1],
      ).toHaveLength(60);
    });
  });

  describe("runBatchUpdateOperation", () => {
    it("uses collection update-many when filter and shared data are provided", async () => {
      const ctx = createMockContext({
        options: {
          filter: "status[eq]:TODO",
          data: '{"status":"DONE"}',
        },
      });

      await runBatchUpdateOperation(ctx);

      expect(ctx.services.records.updateMany).toHaveBeenCalledWith(
        "people",
        { status: "DONE" },
        {
          filter: "status[eq]:TODO",
        },
      );
      expect(ctx.services.output.render).toHaveBeenCalled();
    });
  });

  // ==================== EXPORT OPERATION ====================
  describe("runExportOperation", () => {
    it("exports records to JSON format", async () => {
      const ctx = createMockContext({
        options: { format: "json", outputFile: "/path/to/output.json" },
      });

      await runExportOperation(ctx);

      expect(ctx.services.records.list).toHaveBeenCalled();
      expect(ctx.services.exporter.export).toHaveBeenCalledWith([{ id: "1" }, { id: "2" }], {
        format: "json",
        output: "/path/to/output.json",
      });
    });

    it("exports records to CSV format", async () => {
      const ctx = createMockContext({
        options: { format: "csv" },
      });

      await runExportOperation(ctx);

      expect(ctx.services.exporter.export).toHaveBeenCalledWith(expect.any(Array), {
        format: "csv",
        output: undefined,
      });
    });

    it("throws CliError for unsupported format", async () => {
      const ctx = createMockContext({
        options: { format: "xml" },
      });

      await expect(runExportOperation(ctx)).rejects.toThrow(CliError);
      await expect(runExportOperation(ctx)).rejects.toThrow("Unsupported export format");
    });

    it("uses listAll when --all is provided", async () => {
      const ctx = createMockContext({
        options: { all: true, format: "json" },
      });

      await runExportOperation(ctx);

      expect(ctx.services.records.listAll).toHaveBeenCalledWith(
        "people",
        expect.objectContaining({
          limit: 200,
          maxRecords: 10000,
          maxRecordsErrorMessage: expect.stringContaining("api export --all exceeded"),
        }),
      );
      expect(ctx.services.records.list).not.toHaveBeenCalled();
    });

    it("uses the larger default max-record cap for file exports", async () => {
      const ctx = createMockContext({
        options: { all: true, format: "json", outputFile: "/tmp/people.json" },
      });

      await runExportOperation(ctx);

      expect(ctx.services.records.listAll).toHaveBeenCalledWith(
        "people",
        expect.objectContaining({
          maxRecords: 100000,
        }),
      );
    });

    it("uses --output as file path when not a format", async () => {
      const ctx = createMockContext({
        options: { output: "/path/to/file.json", format: "json" },
      });

      await runExportOperation(ctx);

      expect(ctx.services.exporter.export).toHaveBeenCalledWith(expect.any(Array), {
        format: "json",
        output: "/path/to/file.json",
      });
    });

    it("rejects --fields because export uses the same upstream list contract", async () => {
      const ctx = createMockContext({
        options: { format: "json", fields: "id,name" },
      });

      await expect(runExportOperation(ctx)).rejects.toThrow(CliError);
      await expect(runExportOperation(ctx)).rejects.toThrow(
        "--fields is not supported for export. Twenty REST find-many only supports depth-based field expansion.",
      );
    });
  });

  // ==================== MERGE OPERATION ====================
  describe("runMergeOperation", () => {
    it("merges records using --source and --target", async () => {
      const ctx = createMockContext({
        options: { source: "id-1", target: "id-2" },
      });

      await runMergeOperation(ctx);

      expect(ctx.services.records.merge).toHaveBeenCalledWith("people", {
        ids: ["id-1", "id-2"],
        conflictPriorityIndex: 0,
      });
      expect(ctx.services.output.render).toHaveBeenCalled();
    });

    it("merges records using --ids", async () => {
      const ctx = createMockContext({
        options: { ids: "id-1,id-2,id-3", priority: "1" },
      });

      await runMergeOperation(ctx);

      expect(ctx.services.records.merge).toHaveBeenCalledWith("people", {
        ids: ["id-1", "id-2", "id-3"],
        conflictPriorityIndex: 1,
      });
    });

    it("merges records using --data JSON payload", async () => {
      const ctx = createMockContext({
        options: { data: '{"ids":["a","b"],"conflictPriorityIndex":0}' },
      });

      await runMergeOperation(ctx);

      expect(ctx.services.records.merge).toHaveBeenCalledWith("people", {
        ids: ["a", "b"],
        conflictPriorityIndex: 0,
      });
    });

    it("throws CliError when only --source is provided", async () => {
      const ctx = createMockContext({
        options: { source: "id-1" },
      });

      await expect(runMergeOperation(ctx)).rejects.toThrow(CliError);
      await expect(runMergeOperation(ctx)).rejects.toThrow(
        "Both --source and --target are required",
      );
    });

    it("throws CliError when no payload is provided", async () => {
      const ctx = createMockContext({
        options: {},
      });

      await expect(runMergeOperation(ctx)).rejects.toThrow(CliError);
      await expect(runMergeOperation(ctx)).rejects.toThrow("Missing payload");
    });

    it("adds dryRun flag when --dry-run is provided", async () => {
      const ctx = createMockContext({
        options: { ids: "id-1,id-2", dryRun: true },
      });

      await runMergeOperation(ctx);

      expect(ctx.services.records.merge).toHaveBeenCalledWith("people", {
        ids: ["id-1", "id-2"],
        conflictPriorityIndex: 0,
        dryRun: true,
      });
    });
  });

  // ==================== BATCH CREATE OPERATION ====================
  describe("runBatchCreateOperation", () => {
    it("batch creates records from --data JSON array", async () => {
      const ctx = createMockContext({
        options: { data: '[{"name":"A"},{"name":"B"}]' },
      });

      await runBatchCreateOperation(ctx);

      expect(ctx.services.records.batchCreate).toHaveBeenCalledWith("people", [
        { name: "A" },
        { name: "B" },
      ]);
      expect(ctx.services.output.render).toHaveBeenCalled();
    });

    it("batch creates records from CSV file", async () => {
      const ctx = createMockContext({
        options: { file: "/path/to/data.csv" },
      });

      await runBatchCreateOperation(ctx);

      expect(ctx.services.importer.import).toHaveBeenCalledWith("/path/to/data.csv");
      expect(ctx.services.records.batchCreate).toHaveBeenCalled();
    });

    it("propagates error when batch create fails", async () => {
      const ctx = createMockContext({
        options: { data: '[{"name":"A"}]' },
      });
      (ctx.services.records.batchCreate as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("Batch failed"),
      );

      await expect(runBatchCreateOperation(ctx)).rejects.toThrow("Batch failed");
    });
  });

  // ==================== BATCH UPDATE OPERATION ====================
  describe("runBatchUpdateOperation", () => {
    it("batch updates records from --data JSON array", async () => {
      const ctx = createMockContext({
        options: { data: '[{"id":"1","name":"Updated A"},{"id":"2","name":"Updated B"}]' },
      });

      await runBatchUpdateOperation(ctx);

      expect(ctx.services.records.batchUpdate).toHaveBeenCalledWith(
        "people",
        [
          { id: "1", name: "Updated A" },
          { id: "2", name: "Updated B" },
        ],
        { concurrency: 4 },
      );
      expect(ctx.services.output.render).toHaveBeenCalled();
    });

    it("batch updates records from CSV file", async () => {
      const ctx = createMockContext({
        options: { file: "/path/to/updates.csv" },
      });

      await runBatchUpdateOperation(ctx);

      expect(ctx.services.importer.import).toHaveBeenCalledWith("/path/to/updates.csv");
      expect(ctx.services.records.batchUpdate).toHaveBeenCalledWith("people", expect.any(Array), {
        concurrency: 4,
      });
    });

    it("passes custom batch update concurrency", async () => {
      const ctx = createMockContext({
        options: { data: '[{"id":"1","name":"Updated A"}]', concurrency: "2" },
      });

      await runBatchUpdateOperation(ctx);

      expect(ctx.services.records.batchUpdate).toHaveBeenCalledWith(
        "people",
        [{ id: "1", name: "Updated A" }],
        { concurrency: 2 },
      );
    });

    it("rejects invalid batch update concurrency", async () => {
      const ctx = createMockContext({
        options: { data: '[{"id":"1"}]', concurrency: "0" },
      });

      await expect(runBatchUpdateOperation(ctx)).rejects.toThrow(
        "--concurrency must be an integer between 1 and 10.",
      );
    });

    it("propagates error when batch update fails", async () => {
      const ctx = createMockContext({
        options: { data: '[{"id":"1"}]' },
      });
      (ctx.services.records.batchUpdate as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("Update failed"),
      );

      await expect(runBatchUpdateOperation(ctx)).rejects.toThrow("Update failed");
    });
  });

  // ==================== BATCH DELETE OPERATION ====================
  describe("runBatchDeleteOperation", () => {
    it("batch deletes records with --ids when --yes is provided", async () => {
      const ctx = createMockContext({
        options: { ids: "id-1,id-2,id-3", yes: true },
      });

      await runBatchDeleteOperation(ctx);

      expect(ctx.services.records.batchDelete).toHaveBeenCalledWith("people", [
        "id-1",
        "id-2",
        "id-3",
      ]);
      expect(ctx.services.output.render).toHaveBeenCalled();
    });

    it("batch deletes records with --data JSON array", async () => {
      const ctx = createMockContext({
        options: { data: '["id-a","id-b"]', yes: true },
      });

      await runBatchDeleteOperation(ctx);

      expect(ctx.services.records.batchDelete).toHaveBeenCalledWith("people", ["id-a", "id-b"]);
    });

    it("requires --yes before batch deleting", async () => {
      const ctx = createMockContext({
        options: { ids: "id-1,id-2" },
      });

      await expect(runBatchDeleteOperation(ctx)).rejects.toMatchObject({
        message: "Batch delete requires --yes.",
        code: "INVALID_ARGUMENTS",
        suggestion: "Re-run with --yes to confirm batch delete.",
      });
      expect(ctx.services.records.batchDelete).not.toHaveBeenCalled();
    });

    it("checks for --yes before payload validation", async () => {
      const ctx = createMockContext({
        options: {},
      });

      await expect(runBatchDeleteOperation(ctx)).rejects.toMatchObject({
        message: "Batch delete requires --yes.",
        code: "INVALID_ARGUMENTS",
      });
    });

    it("throws CliError when no IDs provided", async () => {
      const ctx = createMockContext({
        options: { yes: true },
      });

      await expect(runBatchDeleteOperation(ctx)).rejects.toThrow(CliError);
      await expect(runBatchDeleteOperation(ctx)).rejects.toThrow("Missing JSON payload");
    });

    it("throws CliError when payload is not an array", async () => {
      const ctx = createMockContext({
        options: { data: '{"id":"1"}', yes: true },
      });

      await expect(runBatchDeleteOperation(ctx)).rejects.toThrow(CliError);
      await expect(runBatchDeleteOperation(ctx)).rejects.toThrow(
        "Batch payload must be a JSON array",
      );
    });

    it("throws CliError when IDs array is empty", async () => {
      const ctx = createMockContext({
        options: { ids: "  ,  , ", yes: true },
      });

      await expect(runBatchDeleteOperation(ctx)).rejects.toThrow(CliError);
      await expect(runBatchDeleteOperation(ctx)).rejects.toThrow("No valid IDs provided");
    });
  });
});
