import { Command } from "commander";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { mockConstructor } from "../../../test-utils/mock-constructor";
import { ApiService } from "../../../utilities/api/services/api.service";
import { MetadataSubscriptionService } from "../../../utilities/api/services/metadata-subscription.service";
import { CliError } from "../../../utilities/errors/cli-error";
import { registerServerlessCommand } from "../serverless.command";

vi.mock("../../../utilities/api/services/api.service");
vi.mock("../../../utilities/api/services/metadata-subscription.service");
vi.mock("../../../utilities/config/services/config.service", () => ({
  ConfigService: vi.fn(function MockConfigService() {
    return {
      getConfig: vi.fn().mockResolvedValue({
        apiUrl: "https://api.twenty.com",
        apiKey: "test-token",
        workspace: "default",
      }),
    };
  }),
}));

describe("serverless command", () => {
  let program: Command;
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let mockPost: ReturnType<typeof vi.fn>;
  let mockSubscribe: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    program = new Command();
    program.exitOverride();
    registerServerlessCommand(program);
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockPost = vi.fn();
    mockSubscribe = vi.fn();
    vi.mocked(ApiService).mockImplementation(
      mockConstructor(
        () =>
          ({
            post: mockPost,
            get: vi.fn(),
            put: vi.fn(),
            patch: vi.fn(),
            delete: vi.fn(),
            request: vi.fn(),
          }) as unknown as ApiService,
      ),
    );
    vi.mocked(MetadataSubscriptionService).mockImplementation(
      mockConstructor(
        () =>
          ({
            subscribe: mockSubscribe,
          }) as unknown as MetadataSubscriptionService,
      ),
    );
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    vi.clearAllMocks();
  });

  function makeUnknownSymbolError(symbol: string): { message: string } {
    return {
      message: `Cannot query field "${symbol}" on type "Query".`,
    };
  }

  describe("command registration", () => {
    it("registers serverless command with correct name and description", () => {
      const serverlessCmd = program.commands.find((cmd) => cmd.name() === "serverless");
      expect(serverlessCmd).toBeDefined();
      expect(serverlessCmd?.description()).toBe("Manage serverless functions");
      expect(serverlessCmd?.registeredArguments ?? []).toHaveLength(0);

      const subcommands = serverlessCmd?.commands.map((cmd) => cmd.name()) ?? [];
      const help = serverlessCmd?.helpInformation() ?? "";

      expect(subcommands).toEqual(
        expect.arrayContaining([
          "list",
          "get",
          "create",
          "update",
          "delete",
          "publish",
          "execute",
          "packages",
          "source",
          "logs",
          "create-layer",
        ]),
      );
      expect(help).toContain("Commands:");
      expect(help).toContain("list");
      expect(help).toContain("create");
      expect(help).toContain("create-layer");
      expect(help).toContain("publish");
      expect(help).toContain("source");
      expect(help).toContain("logs");
    });

    it("registers the available-packages alias", async () => {
      mockPost.mockResolvedValue({
        data: { data: { getAvailablePackages: { zod: "^3.25.0" } } },
      });

      await program.parseAsync([
        "node",
        "test",
        "serverless",
        "available-packages",
        "fn-1",
        "-o",
        "json",
        "--full",
      ]);

      expect(mockPost).toHaveBeenCalledWith("/metadata", {
        query: expect.stringContaining("getAvailablePackages(input: $input)"),
        variables: { input: { id: "fn-1" } },
      });
    });

    it("has --data option", () => {
      const serverlessCmd = program.commands.find((cmd) => cmd.name() === "serverless");
      const createCmd = serverlessCmd?.commands.find((cmd) => cmd.name() === "create");
      const opts = createCmd?.options ?? [];
      const dataOpt = opts.find((o) => o.long === "--data");
      expect(dataOpt).toBeDefined();
    });

    it("has --file option", () => {
      const serverlessCmd = program.commands.find((cmd) => cmd.name() === "serverless");
      const createCmd = serverlessCmd?.commands.find((cmd) => cmd.name() === "create");
      const opts = createCmd?.options ?? [];
      const fileOpt = opts.find((o) => o.long === "--file");
      expect(fileOpt).toBeDefined();
    });

    it("has --yes on delete", () => {
      const serverlessCmd = program.commands.find((cmd) => cmd.name() === "serverless");
      const deleteCmd = serverlessCmd?.commands.find((cmd) => cmd.name() === "delete");
      const opts = deleteCmd?.options ?? [];
      const yesOpt = opts.find((o) => o.long === "--yes");
      expect(yesOpt).toBeDefined();
    });

    it("has --name option", () => {
      const serverlessCmd = program.commands.find((cmd) => cmd.name() === "serverless");
      const createCmd = serverlessCmd?.commands.find((cmd) => cmd.name() === "create");
      const opts = createCmd?.options ?? [];
      const nameOpt = opts.find((o) => o.long === "--name");
      expect(nameOpt).toBeDefined();
    });

    it("has --description option", () => {
      const serverlessCmd = program.commands.find((cmd) => cmd.name() === "serverless");
      const createCmd = serverlessCmd?.commands.find((cmd) => cmd.name() === "create");
      const opts = createCmd?.options ?? [];
      const descOpt = opts.find((o) => o.long === "--description");
      expect(descOpt).toBeDefined();
    });

    it("has --set option", () => {
      const serverlessCmd = program.commands.find((cmd) => cmd.name() === "serverless");
      const createCmd = serverlessCmd?.commands.find((cmd) => cmd.name() === "create");
      const opts = createCmd?.options ?? [];
      const setOpt = opts.find((o) => o.long === "--set");
      expect(setOpt).toBeDefined();
    });

    it("has --timeout-seconds option", () => {
      const serverlessCmd = program.commands.find((cmd) => cmd.name() === "serverless");
      const createCmd = serverlessCmd?.commands.find((cmd) => cmd.name() === "create");
      const opts = createCmd?.options ?? [];
      const timeoutOpt = opts.find((o) => o.long === "--timeout-seconds");
      expect(timeoutOpt).toBeDefined();
    });

    it("has layer creation options", () => {
      const serverlessCmd = program.commands.find((cmd) => cmd.name() === "serverless");
      const createLayerCmd = serverlessCmd?.commands.find((cmd) => cmd.name() === "create-layer");
      const opts = createLayerCmd?.options ?? [];

      expect(opts.find((option) => option.long === "--package-json")).toBeDefined();
      expect(opts.find((option) => option.long === "--package-json-file")).toBeDefined();
      expect(opts.find((option) => option.long === "--yarn-lock")).toBeDefined();
      expect(opts.find((option) => option.long === "--yarn-lock-file")).toBeDefined();
    });

    it("has global options applied", () => {
      const serverlessCmd = program.commands.find((cmd) => cmd.name() === "serverless");
      const listCmd = serverlessCmd?.commands.find((cmd) => cmd.name() === "list");
      const opts = listCmd?.options ?? [];
      const outputOpt = opts.find((o) => o.long === "--output");
      const queryOpt = opts.find((o) => o.long === "--query");
      const workspaceOpt = opts.find((o) => o.long === "--workspace");
      expect(outputOpt).toBeDefined();
      expect(queryOpt).toBeDefined();
      expect(workspaceOpt).toBeDefined();
    });
  });

  describe("list operation", () => {
    it("lists serverless functions", async () => {
      const functions = [
        {
          id: "fn-1",
          name: "Function 1",
          description: "Test 1",
          runtime: "nodejs22.x",
          timeoutSeconds: 30,
          handlerPath: "src/index.ts",
          handlerName: "handler",
          createdAt: "2024-01-01",
          updatedAt: "2024-01-02",
        },
        {
          id: "fn-2",
          name: "Function 2",
          description: "Test 2",
          runtime: "nodejs22.x",
          timeoutSeconds: 60,
          handlerPath: "src/main.ts",
          handlerName: "main",
          createdAt: "2024-01-03",
          updatedAt: "2024-01-04",
        },
      ];
      mockPost.mockResolvedValue({ data: { data: { findManyServerlessFunctions: functions } } });

      await program.parseAsync(["node", "test", "serverless", "list", "-o", "json", "--full"]);

      expect(mockPost).toHaveBeenCalledWith("/metadata", {
        query: expect.stringContaining("findManyServerlessFunctions"),
      });
      expect(consoleSpy).toHaveBeenCalled();
      const output = consoleSpy.mock.calls[0][0] as string;
      const parsed = JSON.parse(output);
      expect(parsed).toHaveLength(2);
      expect(parsed[0].id).toBe("fn-1");
    });

    it("handles empty functions list", async () => {
      mockPost.mockResolvedValue({ data: { data: { findManyServerlessFunctions: [] } } });

      await program.parseAsync(["node", "test", "serverless", "list", "-o", "json", "--full"]);

      expect(consoleSpy).toHaveBeenCalled();
      const output = consoleSpy.mock.calls[0][0] as string;
      const parsed = JSON.parse(output);
      expect(parsed).toEqual([]);
    });

    it("handles null functions response", async () => {
      mockPost.mockResolvedValue({ data: { data: { findManyServerlessFunctions: null } } });

      await program.parseAsync(["node", "test", "serverless", "list", "-o", "json", "--full"]);

      expect(consoleSpy).toHaveBeenCalled();
      const output = consoleSpy.mock.calls[0][0] as string;
      const parsed = JSON.parse(output);
      expect(parsed).toEqual([]);
    });

    it("falls back to legacy logic-function queries on older workspaces", async () => {
      const functions = [{ id: "fn-1", name: "Legacy Function" }];
      mockPost
        .mockResolvedValueOnce({
          data: {
            errors: [makeUnknownSymbolError("findManyServerlessFunctions")],
          },
        })
        .mockResolvedValueOnce({
          data: { data: { findManyLogicFunctions: functions } },
        });

      await program.parseAsync(["node", "test", "serverless", "list", "-o", "json", "--full"]);

      expect(mockPost).toHaveBeenNthCalledWith(1, "/metadata", {
        query: expect.stringContaining("findManyServerlessFunctions"),
      });
      expect(mockPost).toHaveBeenNthCalledWith(2, "/metadata", {
        query: expect.stringContaining("findManyLogicFunctions"),
      });
      const output = consoleSpy.mock.calls[0][0] as string;
      expect(JSON.parse(output)).toEqual(functions);
    });

    it("does not fall back to legacy queries for non-schema graphql errors", async () => {
      mockPost.mockResolvedValue({
        data: {
          errors: [{ message: "Workspace auth failed." }],
        },
      });

      await expect(
        program.parseAsync(["node", "test", "serverless", "list", "-o", "json", "--full"]),
      ).rejects.toMatchObject({
        message: "Workspace auth failed.",
        code: "API_ERROR",
      });

      expect(mockPost).toHaveBeenCalledTimes(1);
      expect(mockPost).toHaveBeenCalledWith("/metadata", {
        query: expect.stringContaining("findManyServerlessFunctions"),
      });
    });
  });

  describe("get operation", () => {
    it("gets a single function by ID", async () => {
      const func = {
        id: "fn-1",
        name: "Function 1",
        description: "Test",
        runtime: "nodejs22.x",
        timeoutSeconds: 30,
        handlerPath: "src/index.ts",
        handlerName: "handler",
        createdAt: "2024-01-01",
        updatedAt: "2024-01-02",
      };
      mockPost.mockResolvedValue({ data: { data: { findOneServerlessFunction: func } } });

      await program.parseAsync([
        "node",
        "test",
        "serverless",
        "get",
        "fn-1",
        "-o",
        "json",
        "--full",
      ]);

      expect(mockPost).toHaveBeenCalledWith("/metadata", {
        query: expect.stringContaining("findOneServerlessFunction(input: $input)"),
        variables: { input: { id: "fn-1" } },
      });
      expect(consoleSpy).toHaveBeenCalled();
      const output = consoleSpy.mock.calls[0][0] as string;
      const parsed = JSON.parse(output);
      expect(parsed.id).toBe("fn-1");
      expect(parsed.handlerPath).toBe("src/index.ts");
    });

    it("throws error when ID is missing", async () => {
      await expect(program.parseAsync(["node", "test", "serverless", "get"])).rejects.toThrow(
        CliError,
      );
    });
  });

  describe("create operation", () => {
    it("creates a function with --name option", async () => {
      const newFunc = {
        id: "fn-new",
        name: "NewFunction",
        description: "New function",
        runtime: "nodejs22.x",
        timeoutSeconds: 45,
      };
      mockPost.mockResolvedValue({ data: { data: { createOneServerlessFunction: newFunc } } });

      await program.parseAsync([
        "node",
        "test",
        "serverless",
        "create",
        "--name",
        "NewFunction",
        "--description",
        "New function",
        "--timeout-seconds",
        "45",
        "-o",
        "json",
        "--full",
      ]);

      expect(mockPost).toHaveBeenCalledWith("/metadata", {
        query: expect.stringContaining("createOneServerlessFunction"),
        variables: {
          input: {
            name: "NewFunction",
            description: "New function",
            timeoutSeconds: 45,
          },
        },
      });
      expect(consoleSpy).toHaveBeenCalled();
      const output = consoleSpy.mock.calls[0][0] as string;
      const parsed = JSON.parse(output);
      expect(parsed.id).toBe("fn-new");
    });

    it("creates a function from JSON payload", async () => {
      const newFunc = { id: "fn-new", name: "JsonFunction", description: null };
      mockPost.mockResolvedValue({ data: { data: { createOneServerlessFunction: newFunc } } });
      const payload = {
        name: "JsonFunction",
        source: {
          sourceHandlerCode: "export const handler = async () => ({ ok: true });",
          toolInputSchema: {},
          handlerName: "handler",
        },
      };

      await program.parseAsync([
        "node",
        "test",
        "serverless",
        "create",
        "-d",
        JSON.stringify(payload),
        "-o",
        "json",
        "--full",
      ]);

      expect(mockPost).toHaveBeenCalledWith("/metadata", {
        query: expect.stringContaining("createOneServerlessFunction"),
        variables: {
          input: {
            name: "JsonFunction",
            code: {
              "src/index.ts": "export const handler = async () => ({ ok: true });",
            },
            handlerName: "handler",
            handlerPath: "src/index.ts",
            toolInputSchema: {},
          },
        },
      });
    });

    it("prefers explicit handler-path values when shaping create payloads", async () => {
      mockPost.mockResolvedValue({
        data: { data: { createOneServerlessFunction: { id: "fn-new", name: "JsonFunction" } } },
      });

      await program.parseAsync([
        "node",
        "test",
        "serverless",
        "create",
        "-d",
        JSON.stringify({
          name: "JsonFunction",
          handlerPath: "src/explicit.ts",
          source: {
            sourceHandlerPath: "src/legacy.ts",
            sourceHandlerCode: "export const handler = async () => null;",
            handlerName: "handler",
          },
        }),
        "-o",
        "json",
        "--full",
      ]);

      expect(mockPost).toHaveBeenCalledWith("/metadata", {
        query: expect.stringContaining("createOneServerlessFunction"),
        variables: {
          input: {
            name: "JsonFunction",
            code: {
              "src/explicit.ts": "export const handler = async () => null;",
            },
            handlerName: "handler",
            handlerPath: "src/explicit.ts",
          },
        },
      });
    });

    it("throws error when --name is missing", async () => {
      await expect(program.parseAsync(["node", "test", "serverless", "create"])).rejects.toThrow(
        CliError,
      );
    });
  });

  describe("update operation", () => {
    it("updates a function with JSON data", async () => {
      mockPost.mockResolvedValue({ data: { data: { updateOneServerlessFunction: true } } });
      const payload = { name: "UpdatedFunction", description: "Updated description" };

      await program.parseAsync([
        "node",
        "test",
        "serverless",
        "update",
        "fn-1",
        "-d",
        JSON.stringify(payload),
        "-o",
        "json",
        "--full",
      ]);

      expect(mockPost).toHaveBeenCalledWith("/metadata", {
        query: expect.stringContaining("updateOneServerlessFunction(input: $input)"),
        variables: { input: { id: "fn-1", update: payload } },
      });
      expect(consoleSpy).toHaveBeenCalled();
      const output = consoleSpy.mock.calls[0][0] as string;
      const parsed = JSON.parse(output);
      expect(parsed.id).toBe("fn-1");
      expect(parsed.updated).toBe(true);
    });

    it("updates a function from options", async () => {
      mockPost.mockResolvedValue({ data: { data: { updateOneServerlessFunction: true } } });

      await program.parseAsync([
        "node",
        "test",
        "serverless",
        "update",
        "fn-1",
        "--description",
        "Desc",
        "--timeout-seconds",
        "90",
        "-o",
        "json",
        "--full",
      ]);

      expect(mockPost).toHaveBeenCalledWith("/metadata", {
        query: expect.stringContaining("updateOneServerlessFunction(input: $input)"),
        variables: {
          input: {
            id: "fn-1",
            update: { description: "Desc", timeoutSeconds: 90 },
          },
        },
      });
    });

    it("normalizes legacy source payloads when updating current serverless functions", async () => {
      mockPost.mockResolvedValue({ data: { data: { updateOneServerlessFunction: true } } });

      await program.parseAsync([
        "node",
        "test",
        "serverless",
        "update",
        "fn-1",
        "-d",
        JSON.stringify({
          sourceHandlerPath: "src/legacy.ts",
          source: {
            sourceHandlerCode: "export const renamed = async () => null;",
            handlerName: "renamed",
            toolInputSchema: {
              type: "object",
            },
          },
        }),
        "-o",
        "json",
        "--full",
      ]);

      expect(mockPost).toHaveBeenCalledWith("/metadata", {
        query: expect.stringContaining("updateOneServerlessFunction(input: $input)"),
        variables: {
          input: {
            id: "fn-1",
            update: {
              code: {
                "src/legacy.ts": "export const renamed = async () => null;",
              },
              handlerName: "renamed",
              handlerPath: "src/legacy.ts",
              toolInputSchema: {
                type: "object",
              },
            },
          },
        },
      });
    });

    it("throws error when ID is missing", async () => {
      const payload = { name: "UpdatedFunction" };
      await expect(
        program.parseAsync(["node", "test", "serverless", "update", "-d", JSON.stringify(payload)]),
      ).rejects.toThrow(CliError);
    });

    it("throws error when no update fields are provided", async () => {
      await expect(
        program.parseAsync(["node", "test", "serverless", "update", "fn-1"]),
      ).rejects.toThrow(CliError);
    });
  });

  describe("delete operation", () => {
    it("deletes a function by ID", async () => {
      mockPost.mockResolvedValue({
        data: { data: { deleteOneServerlessFunction: { id: "fn-1" } } },
      });

      await program.parseAsync(["node", "test", "serverless", "delete", "fn-1", "--yes"]);

      expect(mockPost).toHaveBeenCalledWith("/metadata", {
        query: expect.stringContaining("deleteOneServerlessFunction(input: $input)"),
        variables: { input: { id: "fn-1" } },
      });
      expect(consoleSpy).toHaveBeenCalledWith("Serverless function fn-1 deleted.");
    });

    it("throws error when ID is missing", async () => {
      await expect(program.parseAsync(["node", "test", "serverless", "delete"])).rejects.toThrow(
        CliError,
      );
    });

    it("requires --yes for delete", async () => {
      await expect(
        program.parseAsync(["node", "test", "serverless", "delete", "fn-1"]),
      ).rejects.toMatchObject({
        message: "Delete requires --yes.",
        code: "INVALID_ARGUMENTS",
      });
    });
  });

  describe("execute operation", () => {
    it("executes a function with payload", async () => {
      const result = {
        data: { result: "success" },
        logs: "ran successfully",
        status: "SUCCESS",
        duration: 150,
        error: null,
      };
      mockPost.mockResolvedValue({ data: { data: { executeOneServerlessFunction: result } } });
      const payload = { input: "test data" };

      await program.parseAsync([
        "node",
        "test",
        "serverless",
        "execute",
        "fn-1",
        "-d",
        JSON.stringify(payload),
        "-o",
        "json",
        "--full",
      ]);

      expect(mockPost).toHaveBeenCalledWith("/metadata", {
        query: expect.stringContaining("executeOneServerlessFunction(input: $input)"),
        variables: { input: { id: "fn-1", payload } },
      });
      expect(consoleSpy).toHaveBeenCalled();
      const output = consoleSpy.mock.calls[0][0] as string;
      const parsed = JSON.parse(output);
      expect(parsed.status).toBe("SUCCESS");
      expect(parsed.duration).toBe(150);
    });

    it("executes a function without payload", async () => {
      const result = { data: null, logs: "", status: "SUCCESS", duration: 50 };
      mockPost.mockResolvedValue({ data: { data: { executeOneServerlessFunction: result } } });

      await program.parseAsync([
        "node",
        "test",
        "serverless",
        "execute",
        "fn-1",
        "-o",
        "json",
        "--full",
      ]);

      expect(mockPost).toHaveBeenCalledWith("/metadata", {
        query: expect.stringContaining("executeOneServerlessFunction(input: $input)"),
        variables: { input: { id: "fn-1", payload: {} } },
      });
    });

    it("throws error when ID is missing", async () => {
      await expect(program.parseAsync(["node", "test", "serverless", "execute"])).rejects.toThrow(
        CliError,
      );
    });
  });

  describe("packages operation", () => {
    it("lists available packages for a function by ID", async () => {
      const result = { lodash: "^4.17.21", zod: "^3.25.0" };
      mockPost.mockResolvedValue({ data: { data: { getAvailablePackages: result } } });

      await program.parseAsync([
        "node",
        "test",
        "serverless",
        "packages",
        "fn-1",
        "-o",
        "json",
        "--full",
      ]);

      expect(mockPost).toHaveBeenCalledWith("/metadata", {
        query: expect.stringContaining("getAvailablePackages(input: $input)"),
        variables: { input: { id: "fn-1" } },
      });
      expect(consoleSpy).toHaveBeenCalled();
      const output = consoleSpy.mock.calls[0][0] as string;
      const parsed = JSON.parse(output);
      expect(parsed.lodash).toBe("^4.17.21");
    });

    it("throws error when ID is missing", async () => {
      await expect(program.parseAsync(["node", "test", "serverless", "packages"])).rejects.toThrow(
        CliError,
      );
    });
  });

  describe("create-layer operation", () => {
    it("creates a serverless layer from inline package.json and yarn.lock content", async () => {
      mockPost.mockResolvedValue({
        data: {
          data: {
            createOneServerlessFunctionLayer: {
              id: "layer-1",
              applicationId: null,
              createdAt: "2026-03-22T00:00:00.000Z",
              updatedAt: "2026-03-22T00:00:00.000Z",
            },
          },
        },
      });

      await program.parseAsync([
        "node",
        "test",
        "serverless",
        "create-layer",
        "--package-json",
        '{"dependencies":{"zod":"^3.25.0"}}',
        "--yarn-lock",
        "zod@^3.25.0:",
        "-o",
        "json",
        "--full",
      ]);

      expect(mockPost).toHaveBeenCalledWith("/metadata", {
        query: expect.stringContaining("createOneServerlessFunctionLayer"),
        variables: {
          packageJson: {
            dependencies: {
              zod: "^3.25.0",
            },
          },
          yarnLock: "zod@^3.25.0:",
        },
      });

      const output = consoleSpy.mock.calls[0][0] as string;
      const parsed = JSON.parse(output);
      expect(parsed.id).toBe("layer-1");
    });

    it("throws a clear error when layer creation is unavailable on a legacy workspace", async () => {
      mockPost.mockResolvedValue({
        data: {
          errors: [makeUnknownSymbolError("createOneServerlessFunctionLayer")],
        },
      });

      await expect(
        program.parseAsync([
          "node",
          "test",
          "serverless",
          "create-layer",
          "--package-json",
          '{"dependencies":{"zod":"^3.25.0"}}',
          "--yarn-lock",
          "zod@^3.25.0:",
        ]),
      ).rejects.toThrow(
        "Serverless layers are not available on this workspace because it does not expose createOneServerlessFunctionLayer.",
      );
    });
  });

  describe("logs operation", () => {
    it("requires bounded collection for json log output", async () => {
      await expect(
        program.parseAsync(["node", "test", "serverless", "logs", "fn-1", "-o", "json", "--full"]),
      ).rejects.toMatchObject({
        message:
          "Streaming JSON output requires --max-events or --wait-seconds so the command can terminate with a complete array.",
        code: "INVALID_ARGUMENTS",
      });
    });

    it("collects bounded log events for json output", async () => {
      mockSubscribe.mockReturnValue(
        (async function* () {
          yield {
            logicFunctionLogs: {
              logs: "first",
            },
          };
          yield {
            logicFunctionLogs: {
              logs: "second",
            },
          };
        })(),
      );

      await program.parseAsync([
        "node",
        "test",
        "serverless",
        "logs",
        "fn-1",
        "--max-events",
        "1",
        "-o",
        "json",
        "--full",
      ]);

      expect(consoleSpy).toHaveBeenCalledTimes(1);
      const output = consoleSpy.mock.calls[0][0] as string;
      expect(JSON.parse(output)).toEqual([{ logs: "first" }]);
    });

    it("streams logic function logs with a metadata subscription", async () => {
      mockSubscribe.mockReturnValue(
        (async function* () {
          yield {
            logicFunctionLogs: {
              logs: "hello\nworld",
            },
          };
        })(),
      );

      await program.parseAsync([
        "node",
        "test",
        "serverless",
        "logs",
        "fn-1",
        "--max-events",
        "1",
        "-o",
        "jsonl",
      ]);

      expect(MetadataSubscriptionService).toHaveBeenCalled();
      expect(mockSubscribe).toHaveBeenCalledWith(
        expect.objectContaining({
          query: expect.stringContaining("logicFunctionLogs"),
          variables: {
            input: {
              id: "fn-1",
            },
          },
        }),
      );
      expect(consoleSpy).toHaveBeenCalledWith('{"logs":"hello\\nworld"}');
    });

    it("requires at least one filter for logs", async () => {
      await expect(
        program.parseAsync(["node", "test", "serverless", "logs", "--max-events", "1"]),
      ).rejects.toThrow(CliError);
    });
  });

  describe("source operation", () => {
    it("gets source code for a function", async () => {
      const sourceCode = 'export default function handler() { return "Hello"; }';
      mockPost.mockResolvedValue({
        data: { data: { getServerlessFunctionSourceCode: sourceCode } },
      });

      await program.parseAsync(["node", "test", "serverless", "source", "fn-1"]);

      expect(mockPost).toHaveBeenCalledWith("/metadata", {
        query: expect.stringContaining("getServerlessFunctionSourceCode(input: $input)"),
        variables: { input: { id: "fn-1" } },
      });
      expect(consoleSpy).toHaveBeenCalledWith(JSON.stringify({ sourceCode }));
    });

    it("handles null source code", async () => {
      mockPost.mockResolvedValue({ data: { data: { getServerlessFunctionSourceCode: null } } });

      await program.parseAsync(["node", "test", "serverless", "source", "fn-1"]);

      expect(consoleSpy).toHaveBeenCalledWith(JSON.stringify({ sourceCode: "" }));
    });

    it("renders source code as structured output for json format", async () => {
      const sourceCode = "export const handler = async () => ({ ok: true });";
      mockPost.mockResolvedValue({
        data: { data: { getServerlessFunctionSourceCode: sourceCode } },
      });

      await program.parseAsync([
        "node",
        "test",
        "serverless",
        "source",
        "fn-1",
        "-o",
        "json",
        "--full",
      ]);

      const output = consoleSpy.mock.calls[0][0] as string;
      const parsed = JSON.parse(output);
      expect(parsed.sourceCode).toBe(sourceCode);
    });

    it("falls back to legacy source-code queries on older workspaces", async () => {
      const sourceCode = "export const handler = async () => ({ ok: true });";
      mockPost
        .mockResolvedValueOnce({
          data: {
            errors: [makeUnknownSymbolError("getServerlessFunctionSourceCode")],
          },
        })
        .mockResolvedValueOnce({
          data: { data: { getLogicFunctionSourceCode: sourceCode } },
        });

      await program.parseAsync(["node", "test", "serverless", "source", "fn-1"]);

      expect(mockPost).toHaveBeenNthCalledWith(1, "/metadata", {
        query: expect.stringContaining("getServerlessFunctionSourceCode(input: $input)"),
        variables: { input: { id: "fn-1" } },
      });
      expect(mockPost).toHaveBeenNthCalledWith(2, "/metadata", {
        query: expect.stringContaining("getLogicFunctionSourceCode(input: $input)"),
        variables: { input: { id: "fn-1" } },
      });
      expect(consoleSpy).toHaveBeenCalledWith(JSON.stringify({ sourceCode }));
    });

    it("throws error when ID is missing", async () => {
      await expect(program.parseAsync(["node", "test", "serverless", "source"])).rejects.toThrow(
        CliError,
      );
    });
  });

  describe("error handling", () => {
    it("requires operation argument", async () => {
      await expect(program.parseAsync(["node", "test", "serverless"])).rejects.toThrow();
    });

    it("throws error for unknown operation", async () => {
      await expect(
        program.parseAsync(["node", "test", "serverless", "unknown"]),
      ).rejects.toMatchObject({
        code: "commander.unknownCommand",
      });
    });

    it("publishes a function when the current schema supports it", async () => {
      mockPost.mockResolvedValue({
        data: { data: { publishServerlessFunction: { id: "fn-1", name: "Published" } } },
      });

      await program.parseAsync([
        "node",
        "test",
        "serverless",
        "publish",
        "fn-1",
        "-o",
        "json",
        "--full",
      ]);

      expect(mockPost).toHaveBeenCalledWith("/metadata", {
        query: expect.stringContaining("publishServerlessFunction(input: $input)"),
        variables: { input: { id: "fn-1" } },
      });
      const output = consoleSpy.mock.calls[0][0] as string;
      expect(JSON.parse(output)).toEqual({ id: "fn-1", name: "Published" });
    });

    it("throws a clear error when publish is unavailable on a legacy workspace", async () => {
      mockPost.mockResolvedValue({
        data: {
          errors: [makeUnknownSymbolError("publishServerlessFunction")],
        },
      });

      await expect(
        program.parseAsync(["node", "test", "serverless", "publish", "fn-1"]),
      ).rejects.toThrow("Publish is not available on this workspace");
    });

    it("rejects mixed-case router-era operations as unknown subcommands", async () => {
      await expect(
        program.parseAsync(["node", "test", "serverless", "LIST", "-o", "json", "--full"]),
      ).rejects.toMatchObject({
        code: "commander.unknownCommand",
      });
    });
  });
});
