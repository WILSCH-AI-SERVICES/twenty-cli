import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { mockConstructor } from "../../../test-utils/mock-constructor";
import { ApiService } from "../../../utilities/api/services/api.service";
import { CliError } from "../../../utilities/errors/cli-error";
import { registerRolesCommand } from "../roles.command";

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

describe("roles command", () => {
  let program: Command;
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let mockPost: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    program = new Command();
    program.exitOverride();
    registerRolesCommand(program);
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
    it("registers roles command with correct name and description", () => {
      const cmd = program.commands.find((candidate) => candidate.name() === "roles");
      expect(cmd).toBeDefined();
      expect(cmd?.description()).toBe("Manage workspace roles");
    });

    it("has required operation argument and optional id argument", () => {
      const cmd = program.commands.find((candidate) => candidate.name() === "roles");
      const args = cmd?.registeredArguments ?? [];

      expect(args.length).toBe(2);
      expect(args[0].name()).toBe("operation");
      expect(args[0].required).toBe(true);
      expect(args[1].name()).toBe("id");
      expect(args[1].required).toBe(false);
    });

    it("has payload options", () => {
      const cmd = program.commands.find((candidate) => candidate.name() === "roles");
      const opts = cmd?.options ?? [];

      expect(opts.find((option) => option.long === "--data")).toBeDefined();
      expect(opts.find((option) => option.long === "--file")).toBeDefined();
      expect(opts.find((option) => option.long === "--set")).toBeDefined();
      expect(opts.find((option) => option.long === "--role-id")).toBeDefined();
      expect(opts.find((option) => option.long === "--include-targets")).toBeDefined();
      expect(opts.find((option) => option.long === "--include-permissions")).toBeDefined();
    });
  });

  describe("list operation", () => {
    it("lists roles", async () => {
      mockPost.mockResolvedValue({
        data: {
          data: {
            getRoles: [
              {
                id: "role-1",
                label: "Admin",
                description: "Workspace administrator",
                icon: "IconShield",
                isEditable: true,
                canUpdateAllSettings: true,
                canAccessAllTools: true,
                canReadAllObjectRecords: true,
                canUpdateAllObjectRecords: true,
                canSoftDeleteAllObjectRecords: true,
                canDestroyAllObjectRecords: true,
                canBeAssignedToUsers: true,
                canBeAssignedToAgents: true,
                canBeAssignedToApiKeys: true,
              },
            ],
          },
        },
      });

      await program.parseAsync(["node", "test", "roles", "list", "-o", "json", "--full"]);

      expect(mockPost).toHaveBeenCalledWith("/metadata", {
        query: expect.stringContaining("getRoles"),
      });

      const output = consoleSpy.mock.calls[0][0] as string;
      expect(JSON.parse(output)).toEqual([
        {
          id: "role-1",
          label: "Admin",
          description: "Workspace administrator",
          icon: "IconShield",
          isEditable: true,
          canUpdateAllSettings: true,
          canAccessAllTools: true,
          canReadAllObjectRecords: true,
          canUpdateAllObjectRecords: true,
          canSoftDeleteAllObjectRecords: true,
          canDestroyAllObjectRecords: true,
          canBeAssignedToUsers: true,
          canBeAssignedToAgents: true,
          canBeAssignedToApiKeys: true,
        },
      ]);
    });

    it("includes nested target fields when requested", async () => {
      mockPost.mockResolvedValue({
        data: {
          data: {
            getRoles: [
              {
                id: "role-1",
                label: "Admin",
                workspaceMembers: [{ id: "wm-1" }],
                agents: [{ id: "agent-1" }],
                apiKeys: [{ id: "key-1", name: "Deploy key" }],
              },
            ],
          },
        },
      });

      await program.parseAsync([
        "node",
        "test",
        "roles",
        "list",
        "--include-targets",
        "-o",
        "json",
        "--full",
      ]);

      expect(mockPost).toHaveBeenCalledWith("/metadata", {
        query: expect.stringContaining("workspaceMembers"),
      });
      expect(mockPost).toHaveBeenCalledWith("/metadata", {
        query: expect.stringContaining("agents"),
      });
      expect(mockPost).toHaveBeenCalledWith("/metadata", {
        query: expect.stringContaining("apiKeys"),
      });
    });
  });

  describe("get operation", () => {
    it("gets one role by id with nested permissions and targets when requested", async () => {
      mockPost.mockResolvedValue({
        data: {
          data: {
            getRoles: [
              {
                id: "role-1",
                label: "Admin",
                description: "Workspace administrator",
                workspaceMembers: [
                  { id: "wm-1", name: { firstName: "Ada", lastName: "Lovelace" } },
                ],
                agents: [{ id: "agent-1", name: "Assistant" }],
                apiKeys: [{ id: "key-1", name: "Deploy key", expiresAt: "2026-12-31T00:00:00Z" }],
                permissionFlags: [{ id: "pf-1", roleId: "role-1", flag: "WORKSPACE" }],
                objectPermissions: [{ objectMetadataId: "obj-1", canReadObjectRecords: true }],
                fieldPermissions: [
                  { id: "fp-1", fieldMetadataId: "field-1", canReadFieldValue: true },
                ],
              },
              {
                id: "role-2",
                label: "Viewer",
              },
            ],
          },
        },
      });

      await program.parseAsync([
        "node",
        "test",
        "roles",
        "get",
        "role-1",
        "--include-targets",
        "--include-permissions",
        "-o",
        "json",
        "--full",
      ]);

      expect(mockPost).toHaveBeenCalledWith("/metadata", {
        query: expect.stringContaining("permissionFlags"),
      });
      expect(mockPost).toHaveBeenCalledWith("/metadata", {
        query: expect.stringContaining("objectPermissions"),
      });
      expect(mockPost).toHaveBeenCalledWith("/metadata", {
        query: expect.stringContaining("fieldPermissions"),
      });

      const output = consoleSpy.mock.calls[0][0] as string;
      expect(JSON.parse(output)).toEqual({
        id: "role-1",
        label: "Admin",
        description: "Workspace administrator",
        workspaceMembers: [{ id: "wm-1", name: { firstName: "Ada", lastName: "Lovelace" } }],
        agents: [{ id: "agent-1", name: "Assistant" }],
        apiKeys: [{ id: "key-1", name: "Deploy key", expiresAt: "2026-12-31T00:00:00Z" }],
        permissionFlags: [{ id: "pf-1", roleId: "role-1", flag: "WORKSPACE" }],
        objectPermissions: [{ objectMetadataId: "obj-1", canReadObjectRecords: true }],
        fieldPermissions: [{ id: "fp-1", fieldMetadataId: "field-1", canReadFieldValue: true }],
      });
    });

    it("throws when id is missing for get", async () => {
      await expect(program.parseAsync(["node", "test", "roles", "get"])).rejects.toThrow(CliError);
    });

    it("throws when the role is not found", async () => {
      mockPost.mockResolvedValue({
        data: {
          data: {
            getRoles: [{ id: "role-2", label: "Viewer" }],
          },
        },
      });

      await expect(
        program.parseAsync(["node", "test", "roles", "get", "role-1", "-o", "json", "--full"]),
      ).rejects.toThrow("Role role-1 not found.");
    });
  });

  describe("create operation", () => {
    it("creates a role from JSON data", async () => {
      mockPost.mockResolvedValue({
        data: {
          data: {
            createOneRole: {
              id: "role-2",
              label: "Support",
              description: "Support role",
              icon: "IconHeadset",
              isEditable: true,
              canUpdateAllSettings: false,
              canAccessAllTools: false,
              canReadAllObjectRecords: true,
              canUpdateAllObjectRecords: false,
              canSoftDeleteAllObjectRecords: false,
              canDestroyAllObjectRecords: false,
              canBeAssignedToUsers: true,
              canBeAssignedToAgents: false,
              canBeAssignedToApiKeys: false,
            },
          },
        },
      });

      await program.parseAsync([
        "node",
        "test",
        "roles",
        "create",
        "-d",
        '{"label":"Support","description":"Support role"}',
        "-o",
        "json",
        "--full",
      ]);

      expect(mockPost).toHaveBeenCalledWith("/metadata", {
        query: expect.stringContaining("createOneRole"),
        variables: {
          createRoleInput: {
            label: "Support",
            description: "Support role",
          },
        },
      });
    });

    it("throws when create payload is missing", async () => {
      await expect(program.parseAsync(["node", "test", "roles", "create"])).rejects.toThrow(
        "Missing JSON payload",
      );
    });
  });

  describe("update operation", () => {
    it("updates a role from JSON data", async () => {
      mockPost.mockResolvedValue({
        data: {
          data: {
            updateOneRole: {
              id: "role-1",
              label: "Admin",
              description: "Updated",
              icon: "IconShield",
              isEditable: true,
              canUpdateAllSettings: true,
              canAccessAllTools: true,
              canReadAllObjectRecords: true,
              canUpdateAllObjectRecords: true,
              canSoftDeleteAllObjectRecords: true,
              canDestroyAllObjectRecords: true,
              canBeAssignedToUsers: true,
              canBeAssignedToAgents: true,
              canBeAssignedToApiKeys: true,
            },
          },
        },
      });

      await program.parseAsync([
        "node",
        "test",
        "roles",
        "update",
        "role-1",
        "-d",
        '{"description":"Updated"}',
        "-o",
        "json",
        "--full",
      ]);

      expect(mockPost).toHaveBeenCalledWith("/metadata", {
        query: expect.stringContaining("updateOneRole"),
        variables: {
          updateRoleInput: {
            id: "role-1",
            update: {
              description: "Updated",
            },
          },
        },
      });
    });

    it("throws when id is missing for update", async () => {
      await expect(
        program.parseAsync(["node", "test", "roles", "update", "-d", '{"description":"Updated"}']),
      ).rejects.toThrow(CliError);
    });
  });

  describe("delete operation", () => {
    it("deletes a role by id", async () => {
      mockPost.mockResolvedValue({
        data: {
          data: {
            deleteOneRole: "role-1",
          },
        },
      });

      await program.parseAsync([
        "node",
        "test",
        "roles",
        "delete",
        "role-1",
        "-o",
        "json",
        "--full",
      ]);

      expect(mockPost).toHaveBeenCalledWith("/metadata", {
        query: expect.stringContaining("deleteOneRole"),
        variables: { roleId: "role-1" },
      });

      const output = consoleSpy.mock.calls[0][0] as string;
      expect(JSON.parse(output)).toEqual({ id: "role-1" });
    });

    it("throws when id is missing for delete", async () => {
      await expect(program.parseAsync(["node", "test", "roles", "delete"])).rejects.toThrow(
        CliError,
      );
    });
  });

  describe("upsert-permission-flags operation", () => {
    it("upserts role permission flags from JSON data", async () => {
      mockPost.mockResolvedValue({
        data: {
          data: {
            upsertPermissionFlags: [
              {
                id: "pf-1",
                roleId: "role-1",
                flag: "WORKSPACE",
              },
            ],
          },
        },
      });

      await program.parseAsync([
        "node",
        "test",
        "roles",
        "upsert-permission-flags",
        "-d",
        '{"roleId":"role-1","permissionFlagKeys":["WORKSPACE"]}',
        "-o",
        "json",
        "--full",
      ]);

      expect(mockPost).toHaveBeenCalledWith("/metadata", {
        query: expect.stringContaining("upsertPermissionFlags"),
        variables: {
          upsertPermissionFlagsInput: {
            roleId: "role-1",
            permissionFlagKeys: ["WORKSPACE"],
          },
        },
      });
    });
  });

  describe("upsert-object-permissions operation", () => {
    it("upserts object permissions from JSON data", async () => {
      mockPost.mockResolvedValue({
        data: {
          data: {
            upsertObjectPermissions: [
              {
                objectMetadataId: "obj-1",
                canReadObjectRecords: true,
                canUpdateObjectRecords: false,
                canSoftDeleteObjectRecords: false,
                canDestroyObjectRecords: false,
              },
            ],
          },
        },
      });

      await program.parseAsync([
        "node",
        "test",
        "roles",
        "upsert-object-permissions",
        "-d",
        '{"roleId":"role-1","objectPermissions":[{"objectMetadataId":"obj-1","canReadObjectRecords":true}]}',
        "-o",
        "json",
        "--full",
      ]);

      expect(mockPost).toHaveBeenCalledWith("/metadata", {
        query: expect.stringContaining("upsertObjectPermissions"),
        variables: {
          upsertObjectPermissionsInput: {
            roleId: "role-1",
            objectPermissions: [
              {
                objectMetadataId: "obj-1",
                canReadObjectRecords: true,
              },
            ],
          },
        },
      });
    });
  });

  describe("upsert-field-permissions operation", () => {
    it("upserts field permissions from JSON data", async () => {
      mockPost.mockResolvedValue({
        data: {
          data: {
            upsertFieldPermissions: [
              {
                id: "fp-1",
                roleId: "role-1",
                objectMetadataId: "obj-1",
                fieldMetadataId: "field-1",
                canReadFieldValue: true,
                canUpdateFieldValue: false,
              },
            ],
          },
        },
      });

      await program.parseAsync([
        "node",
        "test",
        "roles",
        "upsert-field-permissions",
        "-d",
        '{"roleId":"role-1","fieldPermissions":[{"objectMetadataId":"obj-1","fieldMetadataId":"field-1","canReadFieldValue":true}]}',
        "-o",
        "json",
        "--full",
      ]);

      expect(mockPost).toHaveBeenCalledWith("/metadata", {
        query: expect.stringContaining("upsertFieldPermissions"),
        variables: {
          upsertFieldPermissionsInput: {
            roleId: "role-1",
            fieldPermissions: [
              {
                objectMetadataId: "obj-1",
                fieldMetadataId: "field-1",
                canReadFieldValue: true,
              },
            ],
          },
        },
      });
    });
  });

  describe("assign-agent operation", () => {
    it("assigns a role to an agent", async () => {
      mockPost.mockResolvedValue({
        data: {
          data: {
            assignRoleToAgent: true,
          },
        },
      });

      await program.parseAsync([
        "node",
        "test",
        "roles",
        "assign-agent",
        "agent-1",
        "--role-id",
        "role-1",
        "-o",
        "json",
        "--full",
      ]);

      expect(mockPost).toHaveBeenCalledWith("/metadata", {
        query: expect.stringContaining("assignRoleToAgent"),
        variables: {
          agentId: "agent-1",
          roleId: "role-1",
        },
      });

      const output = consoleSpy.mock.calls[0][0] as string;
      expect(JSON.parse(output)).toEqual({
        agentId: "agent-1",
        roleId: "role-1",
        assigned: true,
      });
    });

    it("throws when agent id or role id is missing", async () => {
      await expect(program.parseAsync(["node", "test", "roles", "assign-agent"])).rejects.toThrow(
        CliError,
      );
      await expect(
        program.parseAsync(["node", "test", "roles", "assign-agent", "agent-1"]),
      ).rejects.toThrow(CliError);
    });
  });

  describe("remove-agent operation", () => {
    it("removes a role from an agent", async () => {
      mockPost.mockResolvedValue({
        data: {
          data: {
            removeRoleFromAgent: true,
          },
        },
      });

      await program.parseAsync([
        "node",
        "test",
        "roles",
        "remove-agent",
        "agent-1",
        "-o",
        "json",
        "--full",
      ]);

      expect(mockPost).toHaveBeenCalledWith("/metadata", {
        query: expect.stringContaining("removeRoleFromAgent"),
        variables: {
          agentId: "agent-1",
        },
      });

      const output = consoleSpy.mock.calls[0][0] as string;
      expect(JSON.parse(output)).toEqual({
        agentId: "agent-1",
        removed: true,
      });
    });

    it("throws when agent id is missing", async () => {
      await expect(program.parseAsync(["node", "test", "roles", "remove-agent"])).rejects.toThrow(
        CliError,
      );
    });
  });

  describe("unknown operations", () => {
    it("throws for unknown operations", async () => {
      await expect(program.parseAsync(["node", "test", "roles", "explode"])).rejects.toThrow(
        CliError,
      );
    });
  });
});
