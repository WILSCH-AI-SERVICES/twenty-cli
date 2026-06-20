import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { mockConstructor } from "../../../test-utils/mock-constructor";
import { ApiService } from "../../../utilities/api/services/api.service";
import { CliError } from "../../../utilities/errors/cli-error";
import { registerSkillsCommand } from "../skills.command";

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

describe("skills command", () => {
  let program: Command;
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let mockPost: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    program = new Command();
    program.exitOverride();
    registerSkillsCommand(program);
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
    it("registers skills command with correct name and description", () => {
      const cmd = program.commands.find((candidate) => candidate.name() === "skills");
      expect(cmd).toBeDefined();
      expect(cmd?.description()).toBe("Manage workspace AI skills");
    });

    it("registers list/get/create/update/delete/activate/deactivate as explicit subcommands", () => {
      const cmd = program.commands.find((candidate) => candidate.name() === "skills");
      const subcommandNames = cmd?.commands.map((candidate) => candidate.name()) ?? [];

      expect(subcommandNames).toEqual([
        "list",
        "get",
        "create",
        "update",
        "delete",
        "activate",
        "deactivate",
      ]);
      expect(cmd?.registeredArguments ?? []).toHaveLength(0);
    });

    it("has payload options on the relevant subcommand and global options on child commands", () => {
      const cmd = program.commands.find((candidate) => candidate.name() === "skills");
      const createCmd = cmd?.commands.find((candidate) => candidate.name() === "create");
      const opts = createCmd?.options ?? [];

      expect(opts.find((option) => option.long === "--data")).toBeDefined();
      expect(opts.find((option) => option.long === "--file")).toBeDefined();
      expect(opts.find((option) => option.long === "--set")).toBeDefined();
      expect(opts.find((option) => option.long === "--output")).toBeDefined();
      expect(opts.find((option) => option.long === "--query")).toBeDefined();
      expect(opts.find((option) => option.long === "--workspace")).toBeDefined();
    });
  });

  describe("list operation", () => {
    it("lists skills", async () => {
      mockPost.mockResolvedValue({
        data: {
          data: {
            skills: [
              {
                id: "skill-1",
                name: "workflow-building",
                label: "Workflow Building",
                icon: "IconBolt",
                description: "Instructions for workflow design",
                content: "# Steps",
                isCustom: true,
                isActive: true,
                applicationId: null,
                createdAt: "2026-03-21T00:00:00.000Z",
                updatedAt: "2026-03-21T00:00:00.000Z",
              },
            ],
          },
        },
      });

      await program.parseAsync(["node", "test", "skills", "list", "-o", "json", "--full"]);

      expect(mockPost).toHaveBeenCalledWith("/metadata", {
        query: expect.stringContaining("skills"),
      });

      const output = consoleSpy.mock.calls[0][0] as string;
      expect(JSON.parse(output)).toEqual([
        {
          id: "skill-1",
          name: "workflow-building",
          label: "Workflow Building",
          icon: "IconBolt",
          description: "Instructions for workflow design",
          content: "# Steps",
          isCustom: true,
          isActive: true,
          applicationId: null,
          createdAt: "2026-03-21T00:00:00.000Z",
          updatedAt: "2026-03-21T00:00:00.000Z",
        },
      ]);
    });
  });

  describe("get operation", () => {
    it("gets one skill by id", async () => {
      mockPost.mockResolvedValue({
        data: {
          data: {
            skill: {
              id: "skill-1",
              name: "workflow-building",
              label: "Workflow Building",
              icon: "IconBolt",
              description: "Instructions for workflow design",
              content: "# Steps",
              isCustom: false,
              isActive: true,
              standardId: "std-1",
              applicationId: "app-1",
              createdAt: "2026-03-21T00:00:00.000Z",
              updatedAt: "2026-03-22T00:00:00.000Z",
            },
          },
        },
      });

      await program.parseAsync([
        "node",
        "test",
        "skills",
        "get",
        "skill-1",
        "-o",
        "json",
        "--full",
      ]);

      expect(mockPost).toHaveBeenCalledWith("/metadata", {
        query: expect.stringContaining("skill"),
        variables: { id: "skill-1" },
      });

      const output = consoleSpy.mock.calls[0][0] as string;
      expect(JSON.parse(output)).toEqual({
        id: "skill-1",
        name: "workflow-building",
        label: "Workflow Building",
        icon: "IconBolt",
        description: "Instructions for workflow design",
        content: "# Steps",
        isCustom: false,
        isActive: true,
        standardId: "std-1",
        applicationId: "app-1",
        createdAt: "2026-03-21T00:00:00.000Z",
        updatedAt: "2026-03-22T00:00:00.000Z",
      });
    });

    it("throws when skill id is missing", async () => {
      await expect(program.parseAsync(["node", "test", "skills", "get"])).rejects.toThrow(CliError);
    });
  });

  describe("create operation", () => {
    it("creates a skill from JSON data", async () => {
      const payload = {
        name: "workflow-building",
        label: "Workflow Building",
        icon: "IconBolt",
        description: "Instructions for workflow design",
        content: "# Steps",
      };
      mockPost.mockResolvedValue({
        data: {
          data: {
            createSkill: {
              id: "skill-1",
              ...payload,
              isCustom: true,
              isActive: true,
              applicationId: null,
              createdAt: "2026-03-21T00:00:00.000Z",
              updatedAt: "2026-03-21T00:00:00.000Z",
            },
          },
        },
      });

      await program.parseAsync([
        "node",
        "test",
        "skills",
        "create",
        "-d",
        JSON.stringify(payload),
        "-o",
        "json",
        "--full",
      ]);

      expect(mockPost).toHaveBeenCalledWith("/metadata", {
        query: expect.stringContaining("createSkill"),
        variables: { input: payload },
      });
    });

    it("throws when create payload is missing", async () => {
      await expect(program.parseAsync(["node", "test", "skills", "create"])).rejects.toThrow(
        "Missing JSON payload",
      );
    });
  });

  describe("update operation", () => {
    it("updates a skill from JSON data", async () => {
      mockPost.mockResolvedValue({
        data: {
          data: {
            updateSkill: {
              id: "skill-1",
              name: "workflow-building",
              label: "Workflow Design",
              icon: "IconSparkles",
              description: "Updated instructions",
              content: "# Updated",
              isCustom: true,
              isActive: false,
              applicationId: null,
              createdAt: "2026-03-21T00:00:00.000Z",
              updatedAt: "2026-03-22T00:00:00.000Z",
            },
          },
        },
      });

      await program.parseAsync([
        "node",
        "test",
        "skills",
        "update",
        "skill-1",
        "-d",
        '{"label":"Workflow Design","content":"# Updated","isActive":false}',
        "-o",
        "json",
        "--full",
      ]);

      expect(mockPost).toHaveBeenCalledWith("/metadata", {
        query: expect.stringContaining("updateSkill"),
        variables: {
          input: {
            id: "skill-1",
            label: "Workflow Design",
            content: "# Updated",
            isActive: false,
          },
        },
      });
    });

    it("throws when skill id is missing for update", async () => {
      await expect(program.parseAsync(["node", "test", "skills", "update"])).rejects.toThrow(
        CliError,
      );
    });

    it("throws when update payload is missing", async () => {
      await expect(
        program.parseAsync(["node", "test", "skills", "update", "skill-1"]),
      ).rejects.toThrow("Missing JSON payload");
    });
  });

  describe("delete operation", () => {
    it("deletes a skill by id", async () => {
      mockPost.mockResolvedValue({
        data: {
          data: {
            deleteSkill: {
              id: "skill-1",
            },
          },
        },
      });

      await program.parseAsync([
        "node",
        "test",
        "skills",
        "delete",
        "skill-1",
        "-o",
        "json",
        "--full",
      ]);

      expect(mockPost).toHaveBeenCalledWith("/metadata", {
        query: expect.stringContaining("deleteSkill"),
        variables: { id: "skill-1" },
      });

      const output = consoleSpy.mock.calls[0][0] as string;
      expect(JSON.parse(output)).toEqual({ id: "skill-1" });
    });
  });

  describe("activate and deactivate operations", () => {
    it("activates a skill", async () => {
      mockPost.mockResolvedValue({
        data: {
          data: {
            activateSkill: {
              id: "skill-1",
              isActive: true,
            },
          },
        },
      });

      await program.parseAsync([
        "node",
        "test",
        "skills",
        "activate",
        "skill-1",
        "-o",
        "json",
        "--full",
      ]);

      expect(mockPost).toHaveBeenCalledWith("/metadata", {
        query: expect.stringContaining("activateSkill"),
        variables: { id: "skill-1" },
      });

      const output = consoleSpy.mock.calls[0][0] as string;
      expect(JSON.parse(output)).toEqual({
        id: "skill-1",
        isActive: true,
      });
    });

    it("deactivates a skill", async () => {
      mockPost.mockResolvedValue({
        data: {
          data: {
            deactivateSkill: {
              id: "skill-1",
              isActive: false,
            },
          },
        },
      });

      await program.parseAsync([
        "node",
        "test",
        "skills",
        "deactivate",
        "skill-1",
        "-o",
        "json",
        "--full",
      ]);

      expect(mockPost).toHaveBeenCalledWith("/metadata", {
        query: expect.stringContaining("deactivateSkill"),
        variables: { id: "skill-1" },
      });

      const output = consoleSpy.mock.calls[0][0] as string;
      expect(JSON.parse(output)).toEqual({
        id: "skill-1",
        isActive: false,
      });
    });

    it("throws when skill id is missing", async () => {
      await expect(program.parseAsync(["node", "test", "skills", "activate"])).rejects.toThrow(
        CliError,
      );
      await expect(program.parseAsync(["node", "test", "skills", "deactivate"])).rejects.toThrow(
        CliError,
      );
    });
  });

  describe("unknown operations", () => {
    it("throws for unknown operations", async () => {
      await expect(program.parseAsync(["node", "test", "skills", "explode"])).rejects.toMatchObject(
        {
          code: "commander.unknownCommand",
        },
      );
    });
  });
});
