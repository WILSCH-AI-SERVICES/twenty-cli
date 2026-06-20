import { Command } from "commander";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { mockConstructor } from "../../../test-utils/mock-constructor";
import { ApiService } from "../../../utilities/api/services/api.service";
import { CliError } from "../../../utilities/errors/cli-error";
import { registerWebhooksCommand } from "../webhooks.command";

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

describe("webhooks command", () => {
  let program: Command;
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let mockPost: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    program = new Command();
    program.exitOverride();
    registerWebhooksCommand(program);
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
    it("registers webhooks command with correct name and description", () => {
      const webhooksCmd = program.commands.find((cmd) => cmd.name() === "webhooks");
      expect(webhooksCmd).toBeDefined();
      expect(webhooksCmd?.description()).toBe("Manage webhooks");
    });

    it("registers explicit subcommands for each webhook operation", () => {
      const webhooksCmd = program.commands.find((cmd) => cmd.name() === "webhooks");
      const subcommands = webhooksCmd?.commands.map((cmd) => cmd.name()) ?? [];
      const help = webhooksCmd?.helpInformation() ?? "";

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

    it("has global options applied", () => {
      const webhooksCmd = program.commands.find((cmd) => cmd.name() === "webhooks");
      const createCmd = webhooksCmd?.commands.find((cmd) => cmd.name() === "create");
      const updateCmd = webhooksCmd?.commands.find((cmd) => cmd.name() === "update");
      const opts = createCmd?.options ?? [];
      const outputOpt = opts.find((o) => o.long === "--output");
      const queryOpt = opts.find((o) => o.long === "--query");
      const workspaceOpt = opts.find((o) => o.long === "--workspace");
      expect(outputOpt).toBeDefined();
      expect(queryOpt).toBeDefined();
      expect(workspaceOpt).toBeDefined();

      const createOpts = createCmd?.options ?? [];
      expect(createOpts.find((o) => o.long === "--data")).toBeDefined();
      expect(createOpts.find((o) => o.long === "--file")).toBeDefined();
      expect(createOpts.find((o) => o.long === "--set")).toBeDefined();

      const updateOpts = updateCmd?.options ?? [];
      expect(updateOpts.find((o) => o.long === "--data")).toBeDefined();
      expect(updateOpts.find((o) => o.long === "--file")).toBeDefined();
      expect(updateOpts.find((o) => o.long === "--set")).toBeDefined();
    });
  });

  describe("list operation", () => {
    it("lists webhooks", async () => {
      const webhooks = [
        {
          id: "wh-1",
          targetUrl: "https://example.com/hook1",
          operations: ["create"],
          description: "Test 1",
          createdAt: "2024-01-01",
        },
        {
          id: "wh-2",
          targetUrl: "https://example.com/hook2",
          operations: ["update"],
          description: "Test 2",
          createdAt: "2024-01-02",
        },
      ];
      mockPost.mockResolvedValue({ data: { data: { webhooks } } });

      await program.parseAsync(["node", "test", "webhooks", "list", "-o", "json", "--full"]);

      expect(mockPost).toHaveBeenCalledWith("/metadata", {
        query: expect.stringContaining("webhooks"),
      });
      expect(consoleSpy).toHaveBeenCalled();
      const output = consoleSpy.mock.calls[0][0] as string;
      const parsed = JSON.parse(output);
      expect(parsed).toHaveLength(2);
      expect(parsed[0].id).toBe("wh-1");
    });

    it("accepts parent-first global options before the list subcommand", async () => {
      mockPost.mockResolvedValue({ data: { data: { webhooks: [] } } });

      await program.parseAsync(["node", "test", "webhooks", "-o", "json", "--full", "list"]);

      expect(mockPost).toHaveBeenCalledWith("/metadata", {
        query: expect.stringContaining("webhooks"),
      });
    });

    it("handles empty webhooks list", async () => {
      mockPost.mockResolvedValue({ data: { data: { webhooks: [] } } });

      await program.parseAsync(["node", "test", "webhooks", "list", "-o", "json", "--full"]);

      expect(consoleSpy).toHaveBeenCalled();
      const output = consoleSpy.mock.calls[0][0] as string;
      const parsed = JSON.parse(output);
      expect(parsed).toEqual([]);
    });

    it("handles null webhooks response", async () => {
      mockPost.mockResolvedValue({ data: { data: { webhooks: null } } });

      await program.parseAsync(["node", "test", "webhooks", "list", "-o", "json", "--full"]);

      expect(consoleSpy).toHaveBeenCalled();
      const output = consoleSpy.mock.calls[0][0] as string;
      const parsed = JSON.parse(output);
      expect(parsed).toEqual([]);
    });

    it("surfaces graphql errors instead of rendering an empty list", async () => {
      mockPost.mockResolvedValue({
        data: {
          errors: [{ message: "Forbidden" }],
        },
      });

      await expect(
        program.parseAsync(["node", "test", "webhooks", "list", "-o", "json", "--full"]),
      ).rejects.toThrow("Forbidden");
    });
  });

  describe("get operation", () => {
    it("gets a single webhook by ID", async () => {
      const webhook = {
        id: "wh-1",
        targetUrl: "https://example.com/hook",
        operations: ["create"],
        description: "Test",
        secret: "secret123",
        createdAt: "2024-01-01",
        updatedAt: "2024-01-02",
      };
      mockPost.mockResolvedValue({ data: { data: { webhook } } });

      await program.parseAsync(["node", "test", "webhooks", "get", "wh-1", "-o", "json", "--full"]);

      expect(mockPost).toHaveBeenCalledWith("/metadata", {
        query: expect.stringContaining("webhook(input: { id: $id })"),
        variables: { id: "wh-1" },
      });
      expect(consoleSpy).toHaveBeenCalled();
      const output = consoleSpy.mock.calls[0][0] as string;
      const parsed = JSON.parse(output);
      expect(parsed.id).toBe("wh-1");
      expect(parsed.secret).toBe("secret123");
    });

    it("throws error when ID is missing", async () => {
      await expect(program.parseAsync(["node", "test", "webhooks", "get"])).rejects.toThrow(
        CliError,
      );
    });
  });

  describe("create operation", () => {
    it("creates a webhook with JSON data", async () => {
      const newWebhook = {
        id: "wh-new",
        targetUrl: "https://example.com/new",
        operations: ["create"],
        description: "New webhook",
      };
      mockPost.mockResolvedValue({ data: { data: { createWebhook: newWebhook } } });
      const payload = { targetUrl: "https://example.com/new", operations: ["create"] };

      await program.parseAsync([
        "node",
        "test",
        "webhooks",
        "create",
        "-d",
        JSON.stringify(payload),
        "-o",
        "json",
        "--full",
      ]);

      expect(mockPost).toHaveBeenCalledWith("/metadata", {
        query: expect.stringContaining("createWebhook"),
        variables: { input: payload },
      });
      expect(consoleSpy).toHaveBeenCalled();
      const output = consoleSpy.mock.calls[0][0] as string;
      const parsed = JSON.parse(output);
      expect(parsed.id).toBe("wh-new");
    });

    it("throws error when data is missing", async () => {
      await expect(program.parseAsync(["node", "test", "webhooks", "create"])).rejects.toThrow(
        "Missing JSON payload",
      );
    });
  });

  describe("update operation", () => {
    it("updates a webhook with JSON data", async () => {
      const updatedWebhook = {
        id: "wh-1",
        targetUrl: "https://example.com/updated",
        operations: ["update"],
        description: "Updated webhook",
      };
      mockPost.mockResolvedValue({ data: { data: { updateWebhook: updatedWebhook } } });
      const payload = { targetUrl: "https://example.com/updated" };

      await program.parseAsync([
        "node",
        "test",
        "webhooks",
        "update",
        "wh-1",
        "-d",
        JSON.stringify(payload),
        "-o",
        "json",
        "--full",
      ]);

      expect(mockPost).toHaveBeenCalledWith("/metadata", {
        query: expect.stringContaining("updateWebhook"),
        variables: {
          input: {
            id: "wh-1",
            ...payload,
          },
        },
      });
      expect(consoleSpy).toHaveBeenCalled();
      const output = consoleSpy.mock.calls[0][0] as string;
      const parsed = JSON.parse(output);
      expect(parsed.id).toBe("wh-1");
      expect(parsed.targetUrl).toBe("https://example.com/updated");
    });

    it("throws error when ID is missing", async () => {
      const payload = { targetUrl: "https://example.com/updated" };
      await expect(
        program.parseAsync(["node", "test", "webhooks", "update", "-d", JSON.stringify(payload)]),
      ).rejects.toThrow(CliError);
    });

    it("throws error when data is missing", async () => {
      await expect(
        program.parseAsync(["node", "test", "webhooks", "update", "wh-1"]),
      ).rejects.toThrow("Missing JSON payload");
    });
  });

  describe("delete operation", () => {
    it("deletes a webhook by ID", async () => {
      mockPost.mockResolvedValue({ data: { data: { deleteWebhook: true } } });

      await program.parseAsync(["node", "test", "webhooks", "delete", "wh-1"]);

      expect(mockPost).toHaveBeenCalledWith("/metadata", {
        query: expect.stringContaining("deleteWebhook(input: { id: $id })"),
        variables: { id: "wh-1" },
      });
      expect(consoleSpy).toHaveBeenCalledWith("Webhook wh-1 deleted.");
    });

    it("surfaces graphql errors instead of claiming delete succeeded", async () => {
      mockPost.mockResolvedValue({
        data: {
          errors: [{ message: "Webhook is locked" }],
        },
      });

      await expect(
        program.parseAsync(["node", "test", "webhooks", "delete", "wh-1"]),
      ).rejects.toThrow("Webhook is locked");
      expect(consoleSpy).not.toHaveBeenCalledWith("Webhook wh-1 deleted.");
    });

    it("throws error when ID is missing", async () => {
      await expect(program.parseAsync(["node", "test", "webhooks", "delete"])).rejects.toThrow(
        CliError,
      );
    });
  });

  describe("error handling", () => {
    it("requires a subcommand", async () => {
      await expect(program.parseAsync(["node", "test", "webhooks"])).rejects.toThrow();
    });
  });
});
