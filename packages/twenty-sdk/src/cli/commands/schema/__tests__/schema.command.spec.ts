import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildProgram } from "../../../program";
import { CliError } from "../../../utilities/errors/cli-error";
import { registerSchemaCommand } from "../schema.command";

vi.mock("../../../utilities/shared/services", () => ({
  createServices: vi.fn(),
}));

import { createServices } from "../../../utilities/shared/services";

function createMockServices() {
  return {
    schemaCache: {
      refresh: vi.fn().mockResolvedValue({
        workspace: "default",
        baseUrl: "https://crm.acme.com/",
        refreshed: [{ kind: "core-openapi", contentHash: "hash", bytes: 100 }],
      }),
      status: vi.fn().mockResolvedValue({
        workspace: "default",
        baseUrl: "https://crm.acme.com/",
        staleAfterMs: 86400000,
        entries: [{ kind: "core-openapi", exists: true, stale: false }],
      }),
      clear: vi.fn().mockResolvedValue({
        workspace: "default",
        baseUrl: "https://crm.acme.com/",
        cleared: [{ kind: "graphql" }],
      }),
    },
    output: {
      render: vi.fn(),
    },
  };
}

describe("schema command", () => {
  let program: Command;
  let mockServices: ReturnType<typeof createMockServices>;

  beforeEach(() => {
    program = new Command();
    program.exitOverride();
    registerSchemaCommand(program);
    mockServices = createMockServices();
    vi.mocked(createServices).mockReturnValue(mockServices as any);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("registers schema cache subcommands", () => {
    const command = program.commands.find((candidate) => candidate.name() === "schema");

    expect(command).toBeDefined();
    expect(command?.description()).toBe("Manage cached Twenty discovery schemas");
    expect(command?.commands.map((subcommand) => subcommand.name())).toEqual([
      "refresh",
      "status",
      "clear",
    ]);
  });

  it("refreshes all schemas by default and renders the report", async () => {
    await program.parseAsync(["node", "test", "schema", "refresh", "-o", "json", "--full"]);

    expect(mockServices.schemaCache.refresh).toHaveBeenCalledWith({
      workspace: undefined,
      kind: undefined,
    });
    expect(mockServices.output.render).toHaveBeenCalledWith(
      expect.objectContaining({
        refreshed: expect.any(Array),
      }),
      { format: "json", query: undefined },
    );
  });

  it("refreshes one requested schema kind", async () => {
    await program.parseAsync(["node", "test", "schema", "refresh", "metadata"]);

    expect(mockServices.schemaCache.refresh).toHaveBeenCalledWith({
      workspace: undefined,
      kind: "metadata",
    });
  });

  it("renders schema cache status with a ttl override", async () => {
    await program.parseAsync([
      "node",
      "test",
      "schema",
      "status",
      "graphql",
      "--ttl-hours",
      "2",
      "-o",
      "json",
      "--full",
    ]);

    expect(mockServices.schemaCache.status).toHaveBeenCalledWith({
      workspace: undefined,
      kind: "graphql",
      ttlMs: 7200000,
    });
    expect(mockServices.output.render).toHaveBeenCalledWith(
      expect.objectContaining({
        entries: expect.any(Array),
      }),
      { format: "json", query: undefined },
    );
  });

  it("clears cached schemas", async () => {
    await program.parseAsync(["node", "test", "schema", "clear", "graphql"]);

    expect(mockServices.schemaCache.clear).toHaveBeenCalledWith({
      workspace: undefined,
      kind: "graphql",
    });
    expect(mockServices.output.render).toHaveBeenCalledWith(
      expect.objectContaining({
        cleared: expect.any(Array),
      }),
      { format: "json", query: undefined },
    );
  });

  it("rejects invalid ttl values", async () => {
    await expect(
      program.parseAsync(["node", "test", "schema", "status", "--ttl-hours", "0"]),
    ).rejects.toThrow(CliError);
  });

  it("includes schema in the built program", () => {
    const builtProgram = buildProgram();

    expect(builtProgram.commands.some((command) => command.name() === "schema")).toBe(true);
  });
});
