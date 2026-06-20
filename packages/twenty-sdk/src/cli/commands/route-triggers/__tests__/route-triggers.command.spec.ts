import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { mockConstructor } from "../../../test-utils/mock-constructor";
import { ApiService } from "../../../utilities/api/services/api.service";
import { CliError } from "../../../utilities/errors/cli-error";
import { registerRouteTriggersCommand } from "../route-triggers.command";

vi.mock("../../../utilities/api/services/api.service");
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

describe("route-triggers command", () => {
  let program: Command;
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let mockPost: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    program = new Command();
    program.exitOverride();
    registerRouteTriggersCommand(program);
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockPost = vi.fn();
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
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    vi.clearAllMocks();
  });

  describe("command registration", () => {
    it("registers route-triggers command with correct name and description", () => {
      const cmd = program.commands.find((candidate) => candidate.name() === "route-triggers");
      expect(cmd).toBeDefined();
      expect(cmd?.description()).toBe("Manage route triggers");
    });

    it("registers explicit subcommands for each route trigger operation", () => {
      const cmd = program.commands.find((candidate) => candidate.name() === "route-triggers");
      const subcommands = cmd?.commands.map((candidate) => candidate.name()) ?? [];
      const help = cmd?.helpInformation() ?? "";

      expect(subcommands).toEqual(
        expect.arrayContaining(["list", "get", "create", "update", "delete"]),
      );
      expect(help).toContain("Commands:");
      expect(help).toContain("list");
      expect(help).toContain("get");
      expect(help).toContain("create");
      expect(help).toContain("update");
      expect(help).toContain("delete");
    });

    it("has payload options and global options on the appropriate subcommands", () => {
      const cmd = program.commands.find((candidate) => candidate.name() === "route-triggers");
      const createCmd = cmd?.commands.find((candidate) => candidate.name() === "create");
      const updateCmd = cmd?.commands.find((candidate) => candidate.name() === "update");
      const getCmd = cmd?.commands.find((candidate) => candidate.name() === "get");
      const deleteCmd = cmd?.commands.find((candidate) => candidate.name() === "delete");

      expect(createCmd?.options.find((option) => option.long === "--data")).toBeDefined();
      expect(createCmd?.options.find((option) => option.long === "--file")).toBeDefined();
      expect(createCmd?.options.find((option) => option.long === "--set")).toBeDefined();
      expect(createCmd?.options.find((option) => option.long === "--output")).toBeDefined();
      expect(createCmd?.options.find((option) => option.long === "--query")).toBeDefined();
      expect(createCmd?.options.find((option) => option.long === "--workspace")).toBeDefined();

      expect(updateCmd?.options.find((option) => option.long === "--data")).toBeDefined();
      expect(updateCmd?.options.find((option) => option.long === "--file")).toBeDefined();
      expect(updateCmd?.options.find((option) => option.long === "--set")).toBeDefined();

      expect(deleteCmd?.options.find((option) => option.long === "--yes")).toBeDefined();
      expect(getCmd?.options.find((option) => option.long === "--output")).toBeDefined();
    });
  });

  describe("list operation", () => {
    it("lists route triggers", async () => {
      mockPost.mockResolvedValue({
        data: {
          data: {
            findManyRouteTriggers: [
              {
                id: "route-1",
                path: "/hello",
                isAuthRequired: true,
                httpMethod: "GET",
                createdAt: "2026-03-21T00:00:00.000Z",
                updatedAt: "2026-03-21T00:00:00.000Z",
              },
            ],
          },
        },
      });

      await program.parseAsync(["node", "test", "route-triggers", "list", "-o", "json", "--full"]);

      expect(mockPost).toHaveBeenCalledWith("/metadata", {
        query: expect.stringContaining("findManyRouteTriggers"),
      });

      const output = consoleSpy.mock.calls[0][0] as string;
      expect(JSON.parse(output)).toEqual([
        {
          id: "route-1",
          path: "/hello",
          isAuthRequired: true,
          httpMethod: "GET",
          createdAt: "2026-03-21T00:00:00.000Z",
          updatedAt: "2026-03-21T00:00:00.000Z",
        },
      ]);
    });

    it("accepts parent-first global options before the list subcommand", async () => {
      mockPost.mockResolvedValue({
        data: {
          data: {
            findManyRouteTriggers: [],
          },
        },
      });

      await program.parseAsync(["node", "test", "route-triggers", "-o", "json", "--full", "list"]);

      expect(mockPost).toHaveBeenCalledWith("/metadata", {
        query: expect.stringContaining("findManyRouteTriggers"),
      });
    });

    it("surfaces a compatibility error when standalone route trigger fields are unavailable", async () => {
      mockPost.mockResolvedValue({
        data: {
          errors: [{ message: 'Cannot query field "findManyRouteTriggers" on type "Query".' }],
        },
      });

      await expect(
        program.parseAsync(["node", "test", "route-triggers", "list", "-o", "json", "--full"]),
      ).rejects.toThrow("Route trigger management is not available");
    });
  });

  describe("get operation", () => {
    it("gets one route trigger by id", async () => {
      mockPost.mockResolvedValue({
        data: {
          data: {
            findOneRouteTrigger: {
              id: "route-1",
              path: "/hello",
              isAuthRequired: false,
              httpMethod: "POST",
              createdAt: "2026-03-21T00:00:00.000Z",
              updatedAt: "2026-03-22T00:00:00.000Z",
            },
          },
        },
      });

      await program.parseAsync([
        "node",
        "test",
        "route-triggers",
        "get",
        "route-1",
        "-o",
        "json",
        "--full",
      ]);

      expect(mockPost).toHaveBeenCalledWith("/metadata", {
        query: expect.stringContaining("findOneRouteTrigger"),
        variables: { id: "route-1" },
      });

      const output = consoleSpy.mock.calls[0][0] as string;
      expect(JSON.parse(output)).toEqual({
        id: "route-1",
        path: "/hello",
        isAuthRequired: false,
        httpMethod: "POST",
        createdAt: "2026-03-21T00:00:00.000Z",
        updatedAt: "2026-03-22T00:00:00.000Z",
      });
    });

    it("throws when route trigger id is missing", async () => {
      await expect(program.parseAsync(["node", "test", "route-triggers", "get"])).rejects.toThrow(
        CliError,
      );
    });
  });

  describe("create operation", () => {
    it("creates a route trigger from JSON data", async () => {
      const payload = {
        path: "/hello",
        isAuthRequired: true,
        httpMethod: "GET",
        serverlessFunctionId: "fn-1",
      };
      mockPost.mockResolvedValue({
        data: {
          data: {
            createOneRouteTrigger: {
              id: "route-1",
              path: "/hello",
              isAuthRequired: true,
              httpMethod: "GET",
              createdAt: "2026-03-21T00:00:00.000Z",
              updatedAt: "2026-03-21T00:00:00.000Z",
            },
          },
        },
      });

      await program.parseAsync([
        "node",
        "test",
        "route-triggers",
        "create",
        "-d",
        JSON.stringify(payload),
        "-o",
        "json",
        "--full",
      ]);

      expect(mockPost).toHaveBeenCalledWith("/metadata", {
        query: expect.stringContaining("createOneRouteTrigger"),
        variables: {
          input: payload,
        },
      });
    });

    it("throws when create payload is missing", async () => {
      await expect(
        program.parseAsync(["node", "test", "route-triggers", "create"]),
      ).rejects.toThrow("Missing JSON payload");
    });
  });

  describe("update operation", () => {
    it("updates a route trigger from JSON data", async () => {
      mockPost.mockResolvedValue({
        data: {
          data: {
            updateOneRouteTrigger: {
              id: "route-1",
              path: "/updated",
              isAuthRequired: false,
              httpMethod: "PATCH",
              createdAt: "2026-03-21T00:00:00.000Z",
              updatedAt: "2026-03-22T00:00:00.000Z",
            },
          },
        },
      });

      await program.parseAsync([
        "node",
        "test",
        "route-triggers",
        "update",
        "route-1",
        "-d",
        '{"path":"/updated","isAuthRequired":false,"httpMethod":"PATCH"}',
        "-o",
        "json",
        "--full",
      ]);

      expect(mockPost).toHaveBeenCalledWith("/metadata", {
        query: expect.stringContaining("updateOneRouteTrigger"),
        variables: {
          input: {
            id: "route-1",
            update: {
              path: "/updated",
              isAuthRequired: false,
              httpMethod: "PATCH",
            },
          },
        },
      });
    });

    it("throws when route trigger id is missing for update", async () => {
      await expect(
        program.parseAsync(["node", "test", "route-triggers", "update"]),
      ).rejects.toThrow(CliError);
    });
  });

  describe("delete operation", () => {
    it("deletes a route trigger by id", async () => {
      mockPost.mockResolvedValue({
        data: {
          data: {
            deleteOneRouteTrigger: {
              id: "route-1",
              path: "/hello",
              isAuthRequired: true,
              httpMethod: "GET",
              createdAt: "2026-03-21T00:00:00.000Z",
              updatedAt: "2026-03-21T00:00:00.000Z",
            },
          },
        },
      });

      await program.parseAsync([
        "node",
        "test",
        "route-triggers",
        "delete",
        "route-1",
        "--yes",
        "-o",
        "json",
        "--full",
      ]);

      expect(mockPost).toHaveBeenCalledWith("/metadata", {
        query: expect.stringContaining("deleteOneRouteTrigger"),
        variables: {
          input: {
            id: "route-1",
          },
        },
      });

      const output = consoleSpy.mock.calls[0][0] as string;
      expect(JSON.parse(output)).toEqual({
        id: "route-1",
        path: "/hello",
        isAuthRequired: true,
        httpMethod: "GET",
        createdAt: "2026-03-21T00:00:00.000Z",
        updatedAt: "2026-03-21T00:00:00.000Z",
      });
    });

    it("throws when route trigger id is missing for delete", async () => {
      await expect(
        program.parseAsync(["node", "test", "route-triggers", "delete"]),
      ).rejects.toThrow(CliError);
    });

    it("requires --yes for delete", async () => {
      await expect(
        program.parseAsync(["node", "test", "route-triggers", "delete", "route-1"]),
      ).rejects.toMatchObject({
        message: "Delete requires --yes.",
        code: "INVALID_ARGUMENTS",
      });
    });
  });

  describe("unknown operations", () => {
    it("requires a subcommand", async () => {
      await expect(program.parseAsync(["node", "test", "route-triggers"])).rejects.toThrow();
    });
  });
});
