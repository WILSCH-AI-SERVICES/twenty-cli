import os from "os";

import fs from "fs-extra";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { CliError } from "../../../errors/cli-error";
import { ConfigService, TwentyConfigFile } from "../config.service";

vi.mock("fs-extra");
vi.mock("os");

function getWorkspaceConfig(config: TwentyConfigFile, workspace: string) {
  const workspaceConfig = config.workspaces?.[workspace];
  expect(workspaceConfig).toBeDefined();
  return workspaceConfig as NonNullable<TwentyConfigFile["workspaces"]>[string];
}

function getWorkspaceDbConfig(config: TwentyConfigFile, workspace: string) {
  const workspaceConfig = getWorkspaceConfig(config, workspace);
  expect(workspaceConfig.db).toBeDefined();
  return workspaceConfig.db!;
}

describe("ConfigService", () => {
  const mockHomedir = "/home/testuser";
  const mockConfigPath = `${mockHomedir}/.twenty/config.json`;
  const envKeys = [
    "TWENTY_API_TOKEN",
    "TWENTY_TOKEN",
    "TWENTY_BASE_URL",
    "TWENTY_PROFILE",
  ] as const;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = process.env;
    vi.mocked(os.homedir).mockReturnValue(mockHomedir);
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    for (const key of envKeys) {
      delete process.env[key];
    }
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  describe("listWorkspaces", () => {
    it("returns empty array when no config exists", async () => {
      vi.mocked(fs.pathExists).mockResolvedValue(false as never);

      const service = new ConfigService();
      const result = await service.listWorkspaces();

      expect(result).toEqual([]);
    });

    it("returns empty array when config has no workspaces", async () => {
      vi.mocked(fs.pathExists).mockResolvedValue(true as never);
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({}) as never);

      const service = new ConfigService();
      const result = await service.listWorkspaces();

      expect(result).toEqual([]);
    });

    it("returns workspace info with isDefault marked", async () => {
      const config: TwentyConfigFile = {
        workspaces: {
          prod: { apiUrl: "https://api.twenty.com", apiKey: "key1" },
          staging: { apiUrl: "https://staging.twenty.com", apiKey: "key2" },
        },
        defaultWorkspace: "prod",
      };
      vi.mocked(fs.pathExists).mockResolvedValue(true as never);
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(config) as never);

      const service = new ConfigService();
      const result = await service.listWorkspaces();

      expect(result).toHaveLength(2);
      expect(result).toContainEqual({
        name: "prod",
        isDefault: true,
        apiUrl: "https://api.twenty.com",
      });
      expect(result).toContainEqual({
        name: "staging",
        isDefault: false,
        apiUrl: "https://staging.twenty.com",
      });
    });

    it("returns workspaces without apiUrl when not set", async () => {
      const config: TwentyConfigFile = {
        workspaces: {
          minimal: { apiKey: "key1" },
        },
        defaultWorkspace: "minimal",
      };
      vi.mocked(fs.pathExists).mockResolvedValue(true as never);
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(config) as never);

      const service = new ConfigService();
      const result = await service.listWorkspaces();

      expect(result).toEqual([{ name: "minimal", isDefault: true, apiUrl: undefined }]);
    });
  });

  describe("resolveApiConfig", () => {
    it("resolves apiUrl from explicit workspace config without requiring auth", async () => {
      const config: TwentyConfigFile = {
        workspaces: {
          smoke: { apiUrl: "https://smoke.example.com" },
        },
        defaultWorkspace: "default",
      };
      vi.mocked(fs.pathExists).mockResolvedValue(true as never);
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(config) as never);

      const service = new ConfigService();
      const result = await service.resolveApiConfig({
        workspace: "smoke",
        requireAuth: false,
      });

      expect(result).toEqual({
        apiUrl: "https://smoke.example.com",
        apiKey: "",
        workspace: "smoke",
        tokenSource: "none",
      });
    });

    it("resolves apiUrl from TWENTY_BASE_URL without requiring auth", async () => {
      process.env.TWENTY_BASE_URL = "https://env.twenty.com";
      vi.mocked(fs.pathExists).mockResolvedValue(false as never);

      const service = new ConfigService();
      const result = await service.resolveApiConfig({ requireAuth: false });

      expect(result.apiUrl).toBe("https://env.twenty.com");
      expect(result.apiKey).toBe("");
      expect(result.tokenSource).toBe("none");
    });

    it("resolves API tokens from TWENTY_API_TOKEN before legacy workspace config", async () => {
      process.env.TWENTY_API_TOKEN = "env-token";
      process.env.TWENTY_TOKEN = "legacy-env-token";
      const config: TwentyConfigFile = {
        workspaces: {
          default: { apiUrl: "https://api.twenty.com", apiKey: "legacy-token" },
        },
        defaultWorkspace: "default",
      };
      vi.mocked(fs.pathExists).mockResolvedValue(true as never);
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(config) as never);

      const service = new ConfigService();
      const result = await service.resolveApiConfig({ requireAuth: true });

      expect(result).toMatchObject({
        apiKey: "env-token",
        tokenSource: "env",
      });
    });

    it("falls back to legacy TWENTY_TOKEN before legacy workspace config", async () => {
      process.env.TWENTY_TOKEN = "legacy-env-token";
      const config: TwentyConfigFile = {
        workspaces: {
          default: { apiUrl: "https://api.twenty.com", apiKey: "legacy-token" },
        },
        defaultWorkspace: "default",
      };
      vi.mocked(fs.pathExists).mockResolvedValue(true as never);
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(config) as never);

      const service = new ConfigService();
      const result = await service.resolveApiConfig({ requireAuth: true });

      expect(result).toMatchObject({
        apiKey: "legacy-env-token",
        tokenSource: "env",
      });
    });

    it("still resolves legacy config API tokens for compatibility", async () => {
      const config: TwentyConfigFile = {
        workspaces: {
          default: { apiUrl: "https://api.twenty.com", apiKey: "legacy-token" },
        },
        defaultWorkspace: "default",
      };
      vi.mocked(fs.pathExists).mockResolvedValue(true as never);
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(config) as never);

      const service = new ConfigService();
      const result = await service.resolveApiConfig({ requireAuth: true });

      expect(result).toMatchObject({
        apiKey: "legacy-token",
        tokenSource: "legacy-config",
      });
    });

    it("throws the selected workspace auth guidance when auth is required and missing", async () => {
      vi.mocked(fs.pathExists).mockResolvedValue(false as never);

      const service = new ConfigService();

      await expect(
        service.resolveApiConfig({
          workspace: "smoke",
          requireAuth: true,
          missingAuthSuggestion:
            "Set TWENTY_API_TOKEN or configure an API key for the selected workspace.",
        }),
      ).rejects.toEqual(
        new CliError(
          "Missing API token.",
          "AUTH",
          "Set TWENTY_API_TOKEN or configure an API key for the selected workspace.",
        ),
      );
    });
  });

  describe("setDefaultWorkspace", () => {
    it("throws if workspace does not exist", async () => {
      const config: TwentyConfigFile = {
        workspaces: {
          prod: { apiKey: "key1" },
        },
        defaultWorkspace: "prod",
      };
      vi.mocked(fs.pathExists).mockResolvedValue(true as never);
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(config) as never);

      const service = new ConfigService();

      await expect(service.setDefaultWorkspace("nonexistent")).rejects.toThrow(CliError);
      await expect(service.setDefaultWorkspace("nonexistent")).rejects.toThrow(
        "Workspace 'nonexistent' does not exist",
      );
    });

    it("throws if no config exists", async () => {
      vi.mocked(fs.pathExists).mockResolvedValue(false as never);

      const service = new ConfigService();

      await expect(service.setDefaultWorkspace("prod")).rejects.toThrow(CliError);
      await expect(service.setDefaultWorkspace("prod")).rejects.toThrow(
        "Workspace 'prod' does not exist",
      );
    });

    it("updates and saves config with new default", async () => {
      const config: TwentyConfigFile = {
        workspaces: {
          prod: { apiKey: "key1" },
          staging: { apiKey: "key2" },
        },
        defaultWorkspace: "prod",
      };
      vi.mocked(fs.pathExists).mockResolvedValue(true as never);
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(config) as never);
      vi.mocked(fs.outputFile).mockResolvedValue(undefined as never);

      const service = new ConfigService();
      await service.setDefaultWorkspace("staging");

      expect(fs.outputFile).toHaveBeenCalledWith(
        mockConfigPath,
        expect.stringContaining('"defaultWorkspace": "staging"'),
        "utf-8",
      );
    });
  });

  describe("saveWorkspace", () => {
    it("creates config if not exists and sets as default", async () => {
      vi.mocked(fs.pathExists).mockResolvedValue(false as never);
      vi.mocked(fs.outputFile).mockResolvedValue(undefined as never);

      const service = new ConfigService();
      await service.saveWorkspace("prod", {
        apiUrl: "https://api.twenty.com",
        apiKey: "key1",
      });

      expect(fs.outputFile).toHaveBeenCalledWith(mockConfigPath, expect.any(String), "utf-8");

      const savedConfig = JSON.parse(
        vi.mocked(fs.outputFile).mock.calls[0][1] as string,
      ) as TwentyConfigFile;
      expect(savedConfig.workspaces?.prod).toEqual({
        apiUrl: "https://api.twenty.com",
        apiKey: "key1",
      });
      expect(savedConfig.defaultWorkspace).toBe("prod");
    });

    it("adds to existing config without changing default", async () => {
      const existingConfig: TwentyConfigFile = {
        workspaces: {
          prod: { apiKey: "key1" },
        },
        defaultWorkspace: "prod",
      };
      vi.mocked(fs.pathExists).mockResolvedValue(true as never);
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(existingConfig) as never);
      vi.mocked(fs.outputFile).mockResolvedValue(undefined as never);

      const service = new ConfigService();
      await service.saveWorkspace("staging", {
        apiUrl: "https://staging.twenty.com",
        apiKey: "key2",
      });

      const savedConfig = JSON.parse(
        vi.mocked(fs.outputFile).mock.calls[0][1] as string,
      ) as TwentyConfigFile;
      expect(savedConfig.workspaces?.staging).toEqual({
        apiUrl: "https://staging.twenty.com",
        apiKey: "key2",
      });
      expect(savedConfig.defaultWorkspace).toBe("prod");
    });

    it("updates existing workspace config", async () => {
      const existingConfig: TwentyConfigFile = {
        workspaces: {
          prod: { apiUrl: "https://old.twenty.com", apiKey: "oldkey" },
        },
        defaultWorkspace: "prod",
      };
      vi.mocked(fs.pathExists).mockResolvedValue(true as never);
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(existingConfig) as never);
      vi.mocked(fs.outputFile).mockResolvedValue(undefined as never);

      const service = new ConfigService();
      await service.saveWorkspace("prod", {
        apiUrl: "https://new.twenty.com",
        apiKey: "newkey",
      });

      const savedConfig = JSON.parse(
        vi.mocked(fs.outputFile).mock.calls[0][1] as string,
      ) as TwentyConfigFile;
      expect(savedConfig.workspaces?.prod).toEqual({
        apiUrl: "https://new.twenty.com",
        apiKey: "newkey",
      });
    });
  });

  describe("removeWorkspace", () => {
    it("removes workspace from config", async () => {
      const config: TwentyConfigFile = {
        workspaces: {
          prod: { apiKey: "key1" },
          staging: { apiKey: "key2" },
        },
        defaultWorkspace: "prod",
      };
      vi.mocked(fs.pathExists).mockResolvedValue(true as never);
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(config) as never);
      vi.mocked(fs.outputFile).mockResolvedValue(undefined as never);

      const service = new ConfigService();
      await service.removeWorkspace("staging");

      const savedConfig = JSON.parse(
        vi.mocked(fs.outputFile).mock.calls[0][1] as string,
      ) as TwentyConfigFile;
      expect(savedConfig.workspaces?.staging).toBeUndefined();
      expect(savedConfig.workspaces?.prod).toEqual({ apiKey: "key1" });
      expect(savedConfig.defaultWorkspace).toBe("prod");
    });

    it("clears default if removing last workspace", async () => {
      const config: TwentyConfigFile = {
        workspaces: {
          prod: { apiKey: "key1" },
        },
        defaultWorkspace: "prod",
      };
      vi.mocked(fs.pathExists).mockResolvedValue(true as never);
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(config) as never);
      vi.mocked(fs.outputFile).mockResolvedValue(undefined as never);

      const service = new ConfigService();
      await service.removeWorkspace("prod");

      const savedConfig = JSON.parse(
        vi.mocked(fs.outputFile).mock.calls[0][1] as string,
      ) as TwentyConfigFile;
      expect(savedConfig.workspaces?.prod).toBeUndefined();
      expect(savedConfig.defaultWorkspace).toBeUndefined();
    });

    it("throws if workspace does not exist", async () => {
      const config: TwentyConfigFile = {
        workspaces: {
          prod: { apiKey: "key1" },
        },
        defaultWorkspace: "prod",
      };
      vi.mocked(fs.pathExists).mockResolvedValue(true as never);
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(config) as never);

      const service = new ConfigService();

      await expect(service.removeWorkspace("nonexistent")).rejects.toThrow(CliError);
      await expect(service.removeWorkspace("nonexistent")).rejects.toThrow(
        "Workspace 'nonexistent' does not exist",
      );
    });

    it("throws if no config exists", async () => {
      vi.mocked(fs.pathExists).mockResolvedValue(false as never);

      const service = new ConfigService();

      await expect(service.removeWorkspace("prod")).rejects.toThrow(CliError);
    });

    it("sets next available workspace as default when removing default", async () => {
      const config: TwentyConfigFile = {
        workspaces: {
          alpha: { apiKey: "key1" },
          beta: { apiKey: "key2" },
          gamma: { apiKey: "key3" },
        },
        defaultWorkspace: "beta",
      };
      vi.mocked(fs.pathExists).mockResolvedValue(true as never);
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(config) as never);
      vi.mocked(fs.outputFile).mockResolvedValue(undefined as never);

      const service = new ConfigService();
      await service.removeWorkspace("beta");

      const savedConfig = JSON.parse(
        vi.mocked(fs.outputFile).mock.calls[0][1] as string,
      ) as TwentyConfigFile;
      expect(savedConfig.workspaces?.beta).toBeUndefined();
      // Should pick one of the remaining workspaces as default
      expect(["alpha", "gamma"]).toContain(savedConfig.defaultWorkspace);
    });
  });

  describe("db profiles", () => {
    it("stores named db profiles under a workspace", async () => {
      const config = {
        workspaces: {
          prod: { apiKey: "key1", apiUrl: "https://api.twenty.com" },
        },
        defaultWorkspace: "prod",
      } as TwentyConfigFile;
      vi.mocked(fs.pathExists).mockResolvedValue(true as never);
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(config) as never);
      vi.mocked(fs.outputFile).mockResolvedValue(undefined as never);

      const service = new ConfigService();
      await service.saveDbProfile("prod", {
        name: "readonly",
        workspace: "prod",
        databaseUrl: "postgresql://db.example.com:5432/twenty",
        credentialSource: "env",
      });

      const savedConfig = JSON.parse(
        vi.mocked(fs.outputFile).mock.calls[0][1] as string,
      ) as TwentyConfigFile;

      const prodDb = getWorkspaceDbConfig(savedConfig, "prod");
      expect(prodDb.profiles.readonly).toEqual({
        name: "readonly",
        workspace: "prod",
        databaseUrl: "postgresql://db.example.com:5432/twenty",
        credentialSource: "env",
      });
    });

    it("does not persist db profile cached passwords", async () => {
      const config = {
        workspaces: {
          prod: { apiKey: "key1", apiUrl: "https://api.twenty.com" },
        },
        defaultWorkspace: "prod",
      } as TwentyConfigFile;
      vi.mocked(fs.pathExists).mockResolvedValue(true as never);
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(config) as never);
      vi.mocked(fs.outputFile).mockResolvedValue(undefined as never);

      const service = new ConfigService();
      await service.saveDbProfile("prod", {
        name: "readonly",
        workspace: "prod",
        databaseUrl: "postgresql://reader@db.example.com:5432/twenty",
        credentialSource: "env",
        cachedUser: "reader",
        cachedPassword: "secret",
      });

      const savedConfig = JSON.parse(
        vi.mocked(fs.outputFile).mock.calls[0][1] as string,
      ) as TwentyConfigFile;

      const prodDb = getWorkspaceDbConfig(savedConfig, "prod");
      expect(prodDb.profiles.readonly).toEqual({
        name: "readonly",
        workspace: "prod",
        databaseUrl: "postgresql://reader@db.example.com:5432/twenty",
        credentialSource: "env",
        cachedUser: "reader",
      });
    });

    it("does not persist db profile database url passwords", async () => {
      const config = {
        workspaces: {
          prod: { apiKey: "key1", apiUrl: "https://api.twenty.com" },
        },
        defaultWorkspace: "prod",
      } as TwentyConfigFile;
      vi.mocked(fs.pathExists).mockResolvedValue(true as never);
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(config) as never);
      vi.mocked(fs.outputFile).mockResolvedValue(undefined as never);

      const service = new ConfigService();
      await service.saveDbProfile("prod", {
        name: "readonly",
        workspace: "prod",
        databaseUrl: "postgresql://reader:secret@db.example.com:5432/twenty?sslmode=require",
        credentialSource: "manual",
      });

      const savedConfig = JSON.parse(
        vi.mocked(fs.outputFile).mock.calls[0][1] as string,
      ) as TwentyConfigFile;

      const prodDb = getWorkspaceDbConfig(savedConfig, "prod");
      expect(prodDb.profiles.readonly).toEqual({
        name: "readonly",
        workspace: "prod",
        databaseUrl: "postgresql://reader@db.example.com:5432/twenty?sslmode=require",
        credentialSource: "manual",
      });
    });

    it("ignores legacy persisted cached passwords when reading db profiles", async () => {
      const config = {
        workspaces: {
          prod: {
            apiKey: "key1",
            db: {
              activeProfile: "readonly",
              profiles: {
                readonly: {
                  name: "readonly",
                  workspace: "prod",
                  databaseUrl: "postgresql://reader@db.example.com:5432/twenty",
                  credentialSource: "env",
                  cachedPassword: "legacy-secret",
                },
              },
            },
          },
        },
        defaultWorkspace: "prod",
      } as TwentyConfigFile;
      vi.mocked(fs.pathExists).mockResolvedValue(true as never);
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(config) as never);

      const service = new ConfigService();

      await expect(service.getDbProfile("prod", "readonly")).resolves.toEqual({
        name: "readonly",
        workspace: "prod",
        databaseUrl: "postgresql://reader@db.example.com:5432/twenty",
        credentialSource: "env",
      });
      await expect(service.listDbProfiles("prod")).resolves.toEqual([
        {
          name: "readonly",
          workspace: "prod",
          databaseUrl: "postgresql://reader@db.example.com:5432/twenty",
          credentialSource: "env",
        },
      ]);
    });

    it("switches active db profile without changing api config", async () => {
      const config = {
        workspaces: {
          prod: {
            apiKey: "key1",
            apiUrl: "https://api.twenty.com",
            db: {
              activeProfile: "readonly",
              profiles: {
                readonly: {
                  name: "readonly",
                  workspace: "prod",
                  databaseUrl: "postgresql://db.example.com:5432/twenty",
                  credentialSource: "env",
                },
                writer: {
                  name: "writer",
                  workspace: "prod",
                  databaseUrl: "postgresql://db.example.com:5432/twenty_writer",
                  credentialSource: "env",
                },
              },
            },
          },
        },
        defaultWorkspace: "prod",
      } as TwentyConfigFile;
      vi.mocked(fs.pathExists).mockResolvedValue(true as never);
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(config) as never);
      vi.mocked(fs.outputFile).mockResolvedValue(undefined as never);

      const service = new ConfigService();
      const before = await service.resolveApiConfig({ workspace: "prod", requireAuth: false });
      await service.setActiveDbProfile("prod", "writer");
      const after = await service.resolveApiConfig({ workspace: "prod", requireAuth: false });

      expect(before).toEqual(after);
      expect(before).toEqual({
        apiUrl: "https://api.twenty.com",
        apiKey: "key1",
        workspace: "prod",
        tokenSource: "legacy-config",
      });
      const savedConfig = JSON.parse(
        vi.mocked(fs.outputFile).mock.calls[0][1] as string,
      ) as TwentyConfigFile;
      const prodDb = getWorkspaceDbConfig(savedConfig, "prod");
      expect(prodDb.activeProfile).toBe("writer");
    });

    it("lists and removes db profiles", async () => {
      const config = {
        workspaces: {
          prod: {
            apiKey: "key1",
            db: {
              activeProfile: "readonly",
              profiles: {
                readonly: {
                  name: "readonly",
                  workspace: "prod",
                  databaseUrl: "postgresql://db.example.com:5432/twenty",
                  credentialSource: "env",
                },
                writer: {
                  name: "writer",
                  workspace: "prod",
                  databaseUrl: "postgresql://db.example.com:5432/twenty_writer",
                  credentialSource: "env",
                },
              },
            },
          },
        },
        defaultWorkspace: "prod",
      } as TwentyConfigFile;
      vi.mocked(fs.pathExists).mockResolvedValue(true as never);
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(config) as never);
      vi.mocked(fs.outputFile).mockResolvedValue(undefined as never);

      const service = new ConfigService();
      expect(await service.listDbProfiles("prod")).toEqual([
        {
          name: "readonly",
          workspace: "prod",
          databaseUrl: "postgresql://db.example.com:5432/twenty",
          credentialSource: "env",
        },
        {
          name: "writer",
          workspace: "prod",
          databaseUrl: "postgresql://db.example.com:5432/twenty_writer",
          credentialSource: "env",
        },
      ]);

      await service.removeDbProfile("prod", "writer");

      const savedConfig = JSON.parse(
        vi.mocked(fs.outputFile).mock.calls[0][1] as string,
      ) as TwentyConfigFile;
      const prodDb = getWorkspaceDbConfig(savedConfig, "prod");
      expect(prodDb.profiles.writer).toBeUndefined();
      expect(prodDb.activeProfile).toBe("readonly");
    });

    it("throws when setting an unknown active db profile", async () => {
      const config = {
        workspaces: {
          prod: {
            apiKey: "key1",
            db: {
              profiles: {
                readonly: {
                  name: "readonly",
                  workspace: "prod",
                  databaseUrl: "postgresql://db.example.com:5432/twenty",
                  credentialSource: "env",
                },
              },
            },
          },
        },
        defaultWorkspace: "prod",
      } as TwentyConfigFile;
      vi.mocked(fs.pathExists).mockResolvedValue(true as never);
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(config) as never);

      const service = new ConfigService();

      await expect(service.setActiveDbProfile("prod", "writer")).rejects.toEqual(
        new CliError(
          "DB profile 'writer' does not exist in workspace 'prod'",
          "INVALID_ARGUMENTS",
          'Use "twenty db profile list" to see available profiles.',
        ),
      );
    });
  });
});
