import { Command } from "commander";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { readJsonInput } from "../../../utilities/shared/io";
import { registerApiCommand } from "../api.command";

const mockCreateCommandContext = vi.hoisted(() => vi.fn());

vi.mock("../../../utilities/shared/context", async () => {
  const actual = await vi.importActual<typeof import("../../../utilities/shared/context")>(
    "../../../utilities/shared/context",
  );

  return {
    ...actual,
    createCommandContext: mockCreateCommandContext,
  };
});

vi.mock("../../../utilities/shared/io", () => ({
  readJsonInput: vi.fn(),
}));

describe("api command", () => {
  let program: Command;
  let mockDelete: ReturnType<typeof vi.fn>;
  let mockDestroy: ReturnType<typeof vi.fn>;
  let mockDestroyMany: ReturnType<typeof vi.fn>;
  let mockBatchDelete: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    program = new Command();
    program.exitOverride();
    registerApiCommand(program);
    mockDelete = vi.fn();
    mockDestroy = vi.fn();
    mockDestroyMany = vi.fn();
    mockBatchDelete = vi.fn();
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
          render: vi.fn(),
        },
      },
    } as never);
    vi.mocked(readJsonInput).mockResolvedValue(undefined);
  });

  it("registers explicit subcommands for record operations", () => {
    const apiCmd = program.commands.find((command) => command.name() === "api");
    const subcommands = apiCmd?.commands.map((command) => command.name()) ?? [];
    const help = apiCmd?.helpInformation() ?? "";

    expect(apiCmd).toBeDefined();
    expect(apiCmd?.description()).toBe("Record operations");
    expect(apiCmd?.registeredArguments ?? []).toHaveLength(0);
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
    expect(help).toContain("Commands:");
    expect(help).toContain("list");
    expect(help).toContain("get");
    expect(help).toContain("batch-create");
    expect(help).toContain("find-duplicates");
    expect(help).toContain("group-by");
    expect(help).toContain("restore");
  });

  it("uses --yes without a legacy --force alias for destructive operations", () => {
    const apiCmd = program.commands.find((command) => command.name() === "api");
    const listCmd = apiCmd?.commands.find((command) => command.name() === "list");
    const deleteCmd = apiCmd?.commands.find((command) => command.name() === "delete");
    const destroyCmd = apiCmd?.commands.find((command) => command.name() === "destroy");
    const batchDeleteCmd = apiCmd?.commands.find((command) => command.name() === "batch-delete");

    expect(listCmd?.options.find((option) => option.long === "--yes")).toBeUndefined();

    for (const command of [deleteCmd, destroyCmd, batchDeleteCmd]) {
      expect(command?.options.find((option) => option.long === "--yes")).toBeDefined();
      expect(command?.options.find((option) => option.long === "--force")).toBeUndefined();
    }
  });

  it("requires --yes for delete", async () => {
    await expect(
      program.parseAsync(["node", "test", "api", "delete", "people", "record-123"]),
    ).rejects.toMatchObject({
      message: "Delete requires --yes.",
      code: "INVALID_ARGUMENTS",
      suggestion: "Re-run with --yes to confirm delete.",
    });
  });

  it("requires --yes for destroy", async () => {
    await expect(
      program.parseAsync(["node", "test", "api", "destroy", "people", "record-123"]),
    ).rejects.toMatchObject({
      message: "Destroy requires --yes.",
      code: "INVALID_ARGUMENTS",
      suggestion: "Re-run with --yes to confirm destroy.",
    });
  });

  it("requires --yes for batch-delete", async () => {
    await expect(
      program.parseAsync(["node", "test", "api", "batch-delete", "people", "--ids", "id-1,id-2"]),
    ).rejects.toMatchObject({
      message: "Batch delete requires --yes.",
      code: "INVALID_ARGUMENTS",
      suggestion: "Re-run with --yes to confirm batch delete.",
    });
  });
});
