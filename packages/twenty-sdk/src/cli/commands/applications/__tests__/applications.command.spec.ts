import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { mockConstructor } from "../../../test-utils/mock-constructor";
import { ApiService } from "../../../utilities/api/services/api.service";
import { CliError } from "../../../utilities/errors/cli-error";
import { registerApplicationsCommand } from "../applications.command";

vi.mock("../../../utilities/api/services/api.service");
vi.mock("../../../utilities/shared/io", () => ({
  readJsonInput: vi.fn(),
  readFileOrStdin: vi.fn(),
}));
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

import { readFileOrStdin, readJsonInput } from "../../../utilities/shared/io";

describe("applications command", () => {
  let program: Command;
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let mockPost: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    program = new Command();
    program.exitOverride();
    registerApplicationsCommand(program);
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockPost = vi.fn();
    vi.mocked(readJsonInput).mockResolvedValue(undefined);
    vi.mocked(readFileOrStdin).mockResolvedValue("");
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
    it("registers applications command with correct name and description", () => {
      const cmd = program.commands.find((candidate) => candidate.name() === "applications");
      expect(cmd).toBeDefined();
      expect(cmd?.description()).toBe("Manage workspace applications");
    });

    it("has required operation argument and optional target argument", () => {
      const cmd = program.commands.find((candidate) => candidate.name() === "applications");
      const args = cmd?.registeredArguments ?? [];

      expect(args.length).toBe(2);
      expect(args[0].name()).toBe("operation");
      expect(args[0].required).toBe(true);
      expect(args[1].name()).toBe("target");
      expect(args[1].required).toBe(false);
    });

    it("has sync payload options", () => {
      const cmd = program.commands.find((candidate) => candidate.name() === "applications");
      const opts = cmd?.options ?? [];

      expect(opts.find((option) => option.long === "--manifest")).toBeDefined();
      expect(opts.find((option) => option.long === "--manifest-file")).toBeDefined();
      expect(opts.find((option) => option.long === "--package-json")).toBeDefined();
      expect(opts.find((option) => option.long === "--package-json-file")).toBeDefined();
      expect(opts.find((option) => option.long === "--yarn-lock-file")).toBeDefined();
      expect(opts.find((option) => option.long === "--name")).toBeDefined();
    });

    it("has variable update options", () => {
      const cmd = program.commands.find((candidate) => candidate.name() === "applications");
      const opts = cmd?.options ?? [];

      expect(opts.find((option) => option.long === "--key")).toBeDefined();
      expect(opts.find((option) => option.long === "--value")).toBeDefined();
      expect(opts.find((option) => option.long === "--yes")).toBeDefined();
    });

    it("has global options applied", () => {
      const cmd = program.commands.find((candidate) => candidate.name() === "applications");
      const opts = cmd?.options ?? [];

      expect(opts.find((option) => option.long === "--output")).toBeDefined();
      expect(opts.find((option) => option.long === "--query")).toBeDefined();
      expect(opts.find((option) => option.long === "--workspace")).toBeDefined();
    });
  });

  describe("list operation", () => {
    it("lists applications", async () => {
      const applications = [
        {
          id: "app-1",
          name: "Calendar Sync",
          universalIdentifier: "calendar-sync",
          canBeUninstalled: true,
        },
      ];
      mockPost.mockResolvedValue({ data: { data: { findManyApplications: applications } } });

      await program.parseAsync(["node", "test", "applications", "list", "-o", "json", "--full"]);

      expect(mockPost).toHaveBeenCalledWith("/metadata", {
        query: expect.stringContaining("findManyApplications"),
      });

      const output = consoleSpy.mock.calls[0][0] as string;
      expect(JSON.parse(output)).toEqual(applications);
    });

    it("uses the current application role field and normalizes the output shape", async () => {
      mockPost.mockResolvedValue({
        data: {
          data: {
            findManyApplications: [
              {
                id: "app-1",
                name: "Calendar Sync",
                universalIdentifier: "calendar-sync",
                canBeUninstalled: true,
                defaultRoleId: "role-1",
              },
            ],
          },
        },
      });

      await program.parseAsync(["node", "test", "applications", "list", "-o", "json", "--full"]);

      expect(mockPost).toHaveBeenCalledWith(
        "/metadata",
        expect.objectContaining({
          query: expect.stringContaining("defaultRoleId"),
        }),
      );

      const output = consoleSpy.mock.calls[0][0] as string;
      expect(JSON.parse(output)).toEqual([
        {
          id: "app-1",
          name: "Calendar Sync",
          universalIdentifier: "calendar-sync",
          canBeUninstalled: true,
          defaultRoleId: "role-1",
          defaultServerlessFunctionRoleId: "role-1",
        },
      ]);
    });
  });

  describe("get operation", () => {
    it("gets one application by id", async () => {
      const application = {
        id: "app-1",
        name: "Calendar Sync",
        universalIdentifier: "calendar-sync",
        applicationVariables: [{ id: "var-1", key: "API_TOKEN", value: "***" }],
      };
      mockPost.mockResolvedValue({ data: { data: { findOneApplication: application } } });

      await program.parseAsync([
        "node",
        "test",
        "applications",
        "get",
        "app-1",
        "-o",
        "json",
        "--full",
      ]);

      expect(mockPost).toHaveBeenCalledWith("/metadata", {
        query: expect.stringContaining("findOneApplication"),
        variables: { id: "app-1" },
      });

      const output = consoleSpy.mock.calls[0][0] as string;
      expect(JSON.parse(output)).toEqual(application);
    });

    it("falls back to the legacy application role field when the current schema is unavailable", async () => {
      mockPost
        .mockResolvedValueOnce({
          data: {
            errors: [
              {
                message: 'Cannot query field "defaultRoleId" on type "Application".',
              },
            ],
          },
        })
        .mockResolvedValueOnce({
          data: {
            data: {
              findOneApplication: {
                id: "app-1",
                name: "Calendar Sync",
                universalIdentifier: "calendar-sync",
                defaultServerlessFunctionRoleId: "role-legacy",
              },
            },
          },
        });

      await program.parseAsync([
        "node",
        "test",
        "applications",
        "get",
        "app-1",
        "-o",
        "json",
        "--full",
      ]);

      expect(mockPost).toHaveBeenNthCalledWith(
        1,
        "/metadata",
        expect.objectContaining({
          query: expect.stringContaining("defaultRoleId"),
          variables: { id: "app-1" },
        }),
      );
      expect(mockPost).toHaveBeenNthCalledWith(
        2,
        "/metadata",
        expect.objectContaining({
          query: expect.stringContaining("defaultServerlessFunctionRoleId"),
          variables: { id: "app-1" },
        }),
      );

      const output = consoleSpy.mock.calls[0][0] as string;
      expect(JSON.parse(output)).toEqual({
        id: "app-1",
        name: "Calendar Sync",
        universalIdentifier: "calendar-sync",
        defaultRoleId: "role-legacy",
        defaultServerlessFunctionRoleId: "role-legacy",
      });
    });

    it("throws when get target is missing", async () => {
      await expect(program.parseAsync(["node", "test", "applications", "get"])).rejects.toThrow(
        CliError,
      );
    });
  });

  describe("sync operation", () => {
    it("syncs an application from the current metadata manifest surface", async () => {
      vi.mocked(readJsonInput).mockResolvedValueOnce({
        application: {
          universalIdentifier: "com.acme.calendar-sync",
          displayName: "Calendar Sync",
        },
      });
      mockPost.mockResolvedValue({
        data: {
          data: {
            syncApplication: {
              applicationUniversalIdentifier: "com.acme.calendar-sync",
              actions: [{ type: "upsert_object", name: "calendarEvent" }],
            },
          },
        },
      });

      await program.parseAsync([
        "node",
        "test",
        "applications",
        "sync",
        "--manifest-file",
        "manifest.json",
        "-o",
        "json",
        "--full",
      ]);

      expect(mockPost).toHaveBeenCalledWith("/metadata", {
        query: expect.stringContaining("syncApplication"),
        variables: {
          manifest: {
            application: {
              universalIdentifier: "com.acme.calendar-sync",
              displayName: "Calendar Sync",
            },
          },
        },
      });

      const output = consoleSpy.mock.calls[0][0] as string;
      expect(JSON.parse(output)).toEqual({
        applicationUniversalIdentifier: "com.acme.calendar-sync",
        actions: [{ type: "upsert_object", name: "calendarEvent" }],
      });
    });

    it("falls back to the legacy sync schema when the current selection is rejected", async () => {
      vi.mocked(readJsonInput)
        .mockResolvedValueOnce({
          application: {
            universalIdentifier: "com.acme.calendar-sync",
          },
        })
        .mockResolvedValueOnce({
          name: "@acme/calendar-sync",
          version: "1.0.0",
        });
      vi.mocked(readFileOrStdin).mockResolvedValue("lockfile-v1");
      mockPost
        .mockResolvedValueOnce({
          data: {
            errors: [
              {
                message:
                  'Field "syncApplication" must not have a selection since type "Boolean!" has no subfields.',
              },
            ],
          },
        })
        .mockResolvedValueOnce({ data: { data: { syncApplication: true } } });

      await program.parseAsync([
        "node",
        "test",
        "applications",
        "sync",
        "--manifest-file",
        "manifest.json",
        "--package-json-file",
        "package.json",
        "--yarn-lock-file",
        "yarn.lock",
        "-o",
        "json",
        "--full",
      ]);

      expect(mockPost).toHaveBeenNthCalledWith(2, "/graphql", {
        query: expect.stringContaining("syncApplication"),
        variables: {
          manifest: {
            application: {
              universalIdentifier: "com.acme.calendar-sync",
            },
          },
          packageJson: {
            name: "@acme/calendar-sync",
            version: "1.0.0",
          },
          yarnLock: "lockfile-v1",
        },
      });

      const output = consoleSpy.mock.calls[0][0] as string;
      expect(JSON.parse(output)).toEqual({ success: true, compatibility: "legacy" });
    });

    it("throws when the manifest input is missing", async () => {
      await expect(program.parseAsync(["node", "test", "applications", "sync"])).rejects.toThrow(
        CliError,
      );
    });
  });

  describe("create-development operation", () => {
    it("creates or resolves a development application by universal identifier", async () => {
      mockPost.mockResolvedValue({
        data: {
          data: {
            createDevelopmentApplication: {
              id: "app-dev-1",
              universalIdentifier: "com.example.widget",
            },
          },
        },
      });

      await program.parseAsync([
        "node",
        "test",
        "applications",
        "create-development",
        "com.example.widget",
        "--name",
        "Widget Dev",
        "-o",
        "json",
        "--full",
      ]);

      expect(mockPost).toHaveBeenCalledWith("/metadata", {
        query: expect.stringContaining("createDevelopmentApplication"),
        variables: {
          universalIdentifier: "com.example.widget",
          name: "Widget Dev",
        },
      });

      expect(JSON.parse(consoleSpy.mock.calls[0][0] as string)).toEqual({
        id: "app-dev-1",
        universalIdentifier: "com.example.widget",
      });
    });

    it("throws when create-development target is missing", async () => {
      await expect(
        program.parseAsync(["node", "test", "applications", "create-development"]),
      ).rejects.toThrow(CliError);
    });
  });

  describe("generate-token operation", () => {
    it("generates an application token pair", async () => {
      mockPost.mockResolvedValue({
        data: {
          data: {
            generateApplicationToken: {
              applicationAccessToken: "access-token",
              applicationRefreshToken: "refresh-token",
            },
          },
        },
      });

      await program.parseAsync([
        "node",
        "test",
        "applications",
        "generate-token",
        "app-1",
        "-o",
        "json",
        "--full",
      ]);

      expect(mockPost).toHaveBeenCalledWith("/metadata", {
        query: expect.stringContaining("generateApplicationToken"),
        variables: {
          applicationId: "app-1",
        },
      });

      expect(JSON.parse(consoleSpy.mock.calls[0][0] as string)).toEqual({
        applicationAccessToken: "access-token",
        applicationRefreshToken: "refresh-token",
      });
    });

    it("throws when generate-token target is missing", async () => {
      await expect(
        program.parseAsync(["node", "test", "applications", "generate-token"]),
      ).rejects.toThrow(CliError);
    });
  });

  describe("uninstall operation", () => {
    it("uninstalls an application by universal identifier", async () => {
      mockPost.mockResolvedValue({ data: { data: { uninstallApplication: true } } });

      await program.parseAsync([
        "node",
        "test",
        "applications",
        "uninstall",
        "calendar-sync",
        "--yes",
        "-o",
        "json",
        "--full",
      ]);

      expect(mockPost).toHaveBeenCalledWith("/metadata", {
        query: expect.stringContaining("uninstallApplication"),
        variables: { universalIdentifier: "calendar-sync" },
      });

      const output = consoleSpy.mock.calls[0][0] as string;
      expect(JSON.parse(output)).toEqual({ success: true, universalIdentifier: "calendar-sync" });
    });

    it("throws when uninstall target is missing", async () => {
      await expect(
        program.parseAsync(["node", "test", "applications", "uninstall"]),
      ).rejects.toThrow(CliError);
    });

    it("requires --yes for uninstall", async () => {
      await expect(
        program.parseAsync(["node", "test", "applications", "uninstall", "calendar-sync"]),
      ).rejects.toMatchObject({
        message: "Uninstall requires --yes.",
        code: "INVALID_ARGUMENTS",
      });
    });
  });

  describe("update-variable operation", () => {
    it("updates one application variable", async () => {
      mockPost.mockResolvedValue({ data: { data: { updateOneApplicationVariable: true } } });

      await program.parseAsync([
        "node",
        "test",
        "applications",
        "update-variable",
        "app-1",
        "--key",
        "API_TOKEN",
        "--value",
        "secret",
        "-o",
        "json",
        "--full",
      ]);

      expect(mockPost).toHaveBeenCalledWith("/metadata", {
        query: expect.stringContaining("updateOneApplicationVariable"),
        variables: {
          applicationId: "app-1",
          key: "API_TOKEN",
          value: "secret",
        },
      });

      const output = consoleSpy.mock.calls[0][0] as string;
      expect(JSON.parse(output)).toEqual({
        success: true,
        applicationId: "app-1",
        key: "API_TOKEN",
      });
    });

    it("throws when application id is missing", async () => {
      await expect(
        program.parseAsync([
          "node",
          "test",
          "applications",
          "update-variable",
          "--key",
          "API_TOKEN",
          "--value",
          "secret",
        ]),
      ).rejects.toThrow(CliError);
    });

    it("throws when key or value is missing", async () => {
      await expect(
        program.parseAsync([
          "node",
          "test",
          "applications",
          "update-variable",
          "app-1",
          "--key",
          "API_TOKEN",
        ]),
      ).rejects.toThrow(CliError);
    });
  });

  describe("unknown operations", () => {
    it("throws for unknown operations", async () => {
      await expect(program.parseAsync(["node", "test", "applications", "explode"])).rejects.toThrow(
        CliError,
      );
    });
  });
});
