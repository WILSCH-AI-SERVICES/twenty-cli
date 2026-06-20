import { Command } from "commander";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { mockConstructor } from "../../../test-utils/mock-constructor";
import { ApiService } from "../../../utilities/api/services/api.service";
import { CliError } from "../../../utilities/errors/cli-error";
import { registerApiKeysCommand } from "../api-keys.command";

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

describe("api-keys command", () => {
  let program: Command;
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let mockPost: ReturnType<typeof vi.fn>;
  let mockDelete: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    program = new Command();
    program.exitOverride();
    registerApiKeysCommand(program);
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockPost = vi.fn();
    mockDelete = vi.fn();
    vi.mocked(ApiService).mockImplementation(
      mockConstructor(
        () =>
          ({
            post: mockPost,
            get: vi.fn(),
            put: vi.fn(),
            patch: vi.fn(),
            delete: mockDelete,
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
    it("registers api-keys command with correct name and description", () => {
      const apiKeysCmd = program.commands.find((cmd) => cmd.name() === "api-keys");
      expect(apiKeysCmd).toBeDefined();
      expect(apiKeysCmd?.description()).toBe("Manage API keys");
    });

    it("registers explicit subcommands for each API key operation", () => {
      const apiKeysCmd = program.commands.find((cmd) => cmd.name() === "api-keys");
      const subcommands = apiKeysCmd?.commands.map((cmd) => cmd.name()) ?? [];
      const help = apiKeysCmd?.helpInformation() ?? "";

      expect(subcommands).toEqual(
        expect.arrayContaining([
          "list",
          "get",
          "create",
          "update",
          "delete",
          "revoke",
          "assign-role",
        ]),
      );
      expect(help).toContain("Commands:");
      expect(help).toContain("list");
      expect(help).toContain("get");
      expect(help).toContain("create");
      expect(help).toContain("update");
      expect(help).toContain("delete");
      expect(help).toContain("revoke");
      expect(help).toContain("assign-role");
    });

    it("has global options applied", () => {
      const apiKeysCmd = program.commands.find((cmd) => cmd.name() === "api-keys");
      const listCmd = apiKeysCmd?.commands.find((cmd) => cmd.name() === "list");
      const createCmd = apiKeysCmd?.commands.find((cmd) => cmd.name() === "create");
      const opts = listCmd?.options ?? [];
      const outputOpt = opts.find((o) => o.long === "--output");
      const queryOpt = opts.find((o) => o.long === "--query");
      const workspaceOpt = opts.find((o) => o.long === "--workspace");
      expect(outputOpt).toBeDefined();
      expect(queryOpt).toBeDefined();
      expect(workspaceOpt).toBeDefined();

      const createOpts = createCmd?.options ?? [];
      expect(createOpts.find((o) => o.long === "--name")).toBeDefined();
      expect(createOpts.find((o) => o.long === "--expires-at")).toBeDefined();
      expect(createOpts.find((o) => o.long === "--role-id")).toBeDefined();
    });
  });

  describe("list operation", () => {
    it("lists API keys", async () => {
      const apiKeys = [
        {
          id: "key-1",
          name: "Test Key 1",
          expiresAt: "2025-01-01",
          revokedAt: null,
          createdAt: "2024-01-01",
        },
        {
          id: "key-2",
          name: "Test Key 2",
          expiresAt: "2025-06-01",
          revokedAt: null,
          createdAt: "2024-01-02",
        },
      ];
      mockPost.mockResolvedValue({ data: { data: { apiKeys } } });

      await program.parseAsync(["node", "test", "api-keys", "list", "-o", "json", "--full"]);

      expect(mockPost).toHaveBeenCalledWith("/metadata", {
        query: expect.stringContaining("apiKeys"),
      });
      expect(consoleSpy).toHaveBeenCalled();
      const output = consoleSpy.mock.calls[0][0] as string;
      const parsed = JSON.parse(output);
      expect(parsed).toHaveLength(2);
      expect(parsed[0].id).toBe("key-1");
    });

    it("accepts parent-first global options before the list subcommand", async () => {
      mockPost.mockResolvedValue({ data: { data: { apiKeys: [] } } });

      await program.parseAsync(["node", "test", "api-keys", "-o", "json", "--full", "list"]);

      expect(mockPost).toHaveBeenCalledWith("/metadata", {
        query: expect.stringContaining("apiKeys"),
      });
    });

    it("handles empty API keys list", async () => {
      mockPost.mockResolvedValue({ data: { data: { apiKeys: [] } } });

      await program.parseAsync(["node", "test", "api-keys", "list", "-o", "json", "--full"]);

      expect(consoleSpy).toHaveBeenCalled();
      const output = consoleSpy.mock.calls[0][0] as string;
      const parsed = JSON.parse(output);
      expect(parsed).toEqual([]);
    });

    it("handles null API keys response", async () => {
      mockPost.mockResolvedValue({ data: { data: { apiKeys: null } } });

      await program.parseAsync(["node", "test", "api-keys", "list", "-o", "json", "--full"]);

      expect(consoleSpy).toHaveBeenCalled();
      const output = consoleSpy.mock.calls[0][0] as string;
      const parsed = JSON.parse(output);
      expect(parsed).toEqual([]);
    });
  });

  describe("get operation", () => {
    it("gets a single API key by ID", async () => {
      const apiKey = {
        id: "key-1",
        name: "Test Key",
        expiresAt: "2025-01-01",
        revokedAt: null,
        createdAt: "2024-01-01",
        updatedAt: "2024-01-02",
      };
      mockPost.mockResolvedValue({ data: { data: { apiKey } } });

      await program.parseAsync([
        "node",
        "test",
        "api-keys",
        "get",
        "key-1",
        "-o",
        "json",
        "--full",
      ]);

      expect(mockPost).toHaveBeenCalledWith("/metadata", {
        query: expect.stringContaining("apiKey(input: { id: $id })"),
        variables: { id: "key-1" },
      });
      expect(consoleSpy).toHaveBeenCalled();
      const output = consoleSpy.mock.calls[0][0] as string;
      const parsed = JSON.parse(output);
      expect(parsed.id).toBe("key-1");
      expect(parsed.name).toBe("Test Key");
    });

    it("throws error when ID is missing", async () => {
      await expect(program.parseAsync(["node", "test", "api-keys", "get"])).rejects.toThrow(
        CliError,
      );
    });
  });

  describe("create operation", () => {
    it("creates an API key with required metadata", async () => {
      const newApiKey = { id: "key-new", name: "New API Key", expiresAt: "2025-12-31T00:00:00Z" };
      mockPost.mockResolvedValueOnce({ data: { data: { createApiKey: newApiKey } } });
      mockPost.mockResolvedValueOnce({
        data: { data: { generateApiKeyToken: { token: "secret-token-123" } } },
      });

      await program.parseAsync([
        "node",
        "test",
        "api-keys",
        "create",
        "--name",
        "New API Key",
        "--expires-at",
        "2025-12-31T00:00:00Z",
        "--role-id",
        "role-1",
        "-o",
        "json",
        "--full",
      ]);

      expect(mockPost).toHaveBeenNthCalledWith(1, "/metadata", {
        query: expect.stringContaining("createApiKey"),
        variables: {
          input: {
            name: "New API Key",
            expiresAt: "2025-12-31T00:00:00Z",
            roleId: "role-1",
          },
        },
      });
      expect(mockPost).toHaveBeenNthCalledWith(2, "/metadata", {
        query: expect.stringContaining("generateApiKeyToken"),
        variables: { id: "key-new", expiresAt: "2025-12-31T00:00:00Z" },
      });
      expect(consoleSpy).toHaveBeenCalled();
      const output = consoleSpy.mock.calls[0][0] as string;
      const parsed = JSON.parse(output);
      expect(parsed.id).toBe("key-new");
      expect(parsed.token).toBe("secret-token-123");
    });

    it("throws error when --name is missing", async () => {
      await expect(program.parseAsync(["node", "test", "api-keys", "create"])).rejects.toThrow(
        CliError,
      );
    });

    it("throws error when --expires-at is missing", async () => {
      await expect(
        program.parseAsync(["node", "test", "api-keys", "create", "--name", "Failed Key"]),
      ).rejects.toThrow(CliError);
    });

    it("throws error when --role-id is missing", async () => {
      await expect(
        program.parseAsync([
          "node",
          "test",
          "api-keys",
          "create",
          "--name",
          "Failed Key",
          "--expires-at",
          "2025-12-31T00:00:00Z",
        ]),
      ).rejects.toThrow(CliError);
    });

    it("throws error when createApiKey returns null", async () => {
      mockPost.mockResolvedValueOnce({ data: { data: { createApiKey: null } } });

      await expect(
        program.parseAsync([
          "node",
          "test",
          "api-keys",
          "create",
          "--name",
          "Failed Key",
          "--expires-at",
          "2025-12-31T00:00:00Z",
          "--role-id",
          "role-1",
        ]),
      ).rejects.toThrow(CliError);
    });
  });

  describe("update operation", () => {
    it("updates an API key by ID", async () => {
      const apiKey = { id: "key-1", name: "Updated Key", expiresAt: "2026-01-01T00:00:00Z" };
      mockPost.mockResolvedValue({ data: { data: { updateApiKey: apiKey } } });

      await program.parseAsync([
        "node",
        "test",
        "api-keys",
        "update",
        "key-1",
        "--name",
        "Updated Key",
        "--expires-at",
        "2026-01-01T00:00:00Z",
        "-o",
        "json",
        "--full",
      ]);

      expect(mockPost).toHaveBeenCalledWith("/metadata", {
        query: expect.stringContaining("updateApiKey"),
        variables: {
          input: {
            id: "key-1",
            name: "Updated Key",
            expiresAt: "2026-01-01T00:00:00Z",
            revokedAt: undefined,
          },
        },
      });
    });
  });

  describe("revoke operation", () => {
    it("revokes an API key by ID", async () => {
      mockPost.mockResolvedValue({ data: { data: { revokeApiKey: { id: "key-1" } } } });

      await program.parseAsync(["node", "test", "api-keys", "revoke", "key-1"]);

      expect(mockPost).toHaveBeenCalledWith("/metadata", {
        query: expect.stringContaining("revokeApiKey"),
        variables: { id: "key-1" },
      });
      expect(consoleSpy).toHaveBeenCalledWith("API key key-1 revoked.");
    });

    it("throws error when ID is missing", async () => {
      await expect(program.parseAsync(["node", "test", "api-keys", "revoke"])).rejects.toThrow(
        CliError,
      );
    });
  });

  describe("delete operation", () => {
    it("deletes an API key through the metadata REST endpoint", async () => {
      const deletedApiKey = { id: "key-1", name: "Deleted Key", revokedAt: "2026-01-01T00:00:00Z" };
      mockDelete.mockResolvedValue({ data: deletedApiKey });

      await program.parseAsync([
        "node",
        "test",
        "api-keys",
        "delete",
        "key-1",
        "-o",
        "json",
        "--full",
      ]);

      expect(mockDelete).toHaveBeenCalledWith("/rest/metadata/apiKeys/key-1");
      expect(consoleSpy).toHaveBeenCalled();
      const output = consoleSpy.mock.calls[0][0] as string;
      const parsed = JSON.parse(output);
      expect(parsed).toEqual(deletedApiKey);
    });

    it("renders a stable fallback when the delete response is empty", async () => {
      mockDelete.mockResolvedValue({ data: undefined });

      await program.parseAsync([
        "node",
        "test",
        "api-keys",
        "delete",
        "key-1",
        "-o",
        "json",
        "--full",
      ]);

      const output = consoleSpy.mock.calls[0][0] as string;
      const parsed = JSON.parse(output);
      expect(parsed).toEqual({ id: "key-1", deleted: true });
    });

    it("throws error when delete ID is missing", async () => {
      await expect(program.parseAsync(["node", "test", "api-keys", "delete"])).rejects.toThrow(
        CliError,
      );
    });
  });

  describe("assign-role operation", () => {
    it("assigns a role to an API key", async () => {
      mockPost.mockResolvedValue({ data: { data: { assignRoleToApiKey: true } } });

      await program.parseAsync([
        "node",
        "test",
        "api-keys",
        "assign-role",
        "key-1",
        "--role-id",
        "role-2",
        "-o",
        "json",
        "--full",
      ]);

      expect(mockPost).toHaveBeenCalledWith("/metadata", {
        query: expect.stringContaining("assignRoleToApiKey"),
        variables: { id: "key-1", roleId: "role-2" },
      });

      const output = consoleSpy.mock.calls[0][0] as string;
      const parsed = JSON.parse(output);
      expect(parsed).toEqual({
        apiKeyId: "key-1",
        roleId: "role-2",
        assigned: true,
      });
    });
  });

  describe("error handling", () => {
    it("requires a subcommand", async () => {
      await expect(program.parseAsync(["node", "test", "api-keys"])).rejects.toThrow();
    });
  });
});
