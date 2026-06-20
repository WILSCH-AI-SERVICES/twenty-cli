import fs from "fs-extra";
import { describe, it, expect, vi, beforeEach } from "vitest";

import { loadCliEnvironment, resolveEnvFileFromArgv, upsertEnvValue } from "../environment.service";

vi.mock("fs-extra", () => ({
  default: {
    outputFile: vi.fn(),
    pathExists: vi.fn(),
    pathExistsSync: vi.fn(),
    readFile: vi.fn(),
    readFileSync: vi.fn(),
  },
}));

describe("environment service", () => {
  describe("resolveEnvFileFromArgv", () => {
    it("returns undefined when no env file option is present", () => {
      expect(resolveEnvFileFromArgv(["node", "twenty", "search", "acme"])).toBeUndefined();
    });

    it("reads env file from separated flag value", () => {
      expect(resolveEnvFileFromArgv(["node", "twenty", "--env-file", ".env.staging"])).toBe(
        ".env.staging",
      );
    });

    it("reads env file from inline flag value", () => {
      expect(resolveEnvFileFromArgv(["node", "twenty", "--env-file=.env.staging"])).toBe(
        ".env.staging",
      );
    });
  });

  describe("loadCliEnvironment", () => {
    const cwd = "/workspace";

    beforeEach(() => {
      vi.clearAllMocks();
      vi.mocked(fs.pathExistsSync).mockReturnValue(false as never);
      vi.mocked(fs.readFileSync).mockReturnValue("" as never);
    });

    it("loads .env and .env.local with local file precedence", () => {
      vi.mocked(fs.pathExistsSync).mockImplementation(
        ((filePath: string) =>
          filePath === "/workspace/.env" || filePath === "/workspace/.env.local") as never,
      );
      vi.mocked(fs.readFileSync).mockImplementation(((filePath: string) => {
        if (filePath === "/workspace/.env") {
          return "TWENTY_API_TOKEN=from-dotenv\nTWENTY_BASE_URL=https://api.example.com";
        }

        return "TWENTY_API_TOKEN=from-local\nTWENTY_PROFILE=local";
      }) as never);

      const env: NodeJS.ProcessEnv = {};
      const result = loadCliEnvironment({ cwd, env });

      expect(result.loadedFiles).toEqual(["/workspace/.env", "/workspace/.env.local"]);
      expect(env.TWENTY_API_TOKEN).toBe("from-local");
      expect(env.TWENTY_BASE_URL).toBe("https://api.example.com");
      expect(env.TWENTY_PROFILE).toBe("local");
    });

    it("loads an explicit env file after the default files", () => {
      vi.mocked(fs.pathExistsSync).mockImplementation(
        ((filePath: string) =>
          filePath === "/workspace/.env" || filePath === "/workspace/.env.production") as never,
      );
      vi.mocked(fs.readFileSync).mockImplementation(((filePath: string) => {
        if (filePath === "/workspace/.env") {
          return "TWENTY_API_TOKEN=from-dotenv\nTWENTY_PROFILE=default";
        }

        return "TWENTY_API_TOKEN=from-production\nTWENTY_PROFILE=production";
      }) as never);

      const env: NodeJS.ProcessEnv = {};
      const result = loadCliEnvironment({
        cwd,
        env,
        argv: ["node", "twenty", "search", "acme", "--env-file", ".env.production"],
      });

      expect(result.explicitEnvFile).toBe("/workspace/.env.production");
      expect(result.loadedFiles).toEqual(["/workspace/.env", "/workspace/.env.production"]);
      expect(env.TWENTY_API_TOKEN).toBe("from-production");
      expect(env.TWENTY_PROFILE).toBe("production");
    });

    it("does not override variables already present in the shell environment", () => {
      vi.mocked(fs.pathExistsSync).mockImplementation(
        ((filePath: string) => filePath === "/workspace/.env") as never,
      );
      vi.mocked(fs.readFileSync).mockReturnValue(
        "TWENTY_API_TOKEN=from-dotenv\nTWENTY_BASE_URL=https://api.example.com" as never,
      );

      const env: NodeJS.ProcessEnv = {
        TWENTY_API_TOKEN: "from-shell",
      };

      loadCliEnvironment({ cwd, env });

      expect(env.TWENTY_API_TOKEN).toBe("from-shell");
      expect(env.TWENTY_BASE_URL).toBe("https://api.example.com");
    });
  });

  describe("upsertEnvValue", () => {
    beforeEach(() => {
      vi.clearAllMocks();
      vi.mocked(fs.pathExists).mockResolvedValue(false as never);
      vi.mocked(fs.readFile).mockResolvedValue("" as never);
      vi.mocked(fs.outputFile).mockResolvedValue(undefined as never);
    });

    it("creates an env file with the requested value", async () => {
      await upsertEnvValue("/workspace/.env", "TWENTY_API_TOKEN", "token-123");

      expect(fs.outputFile).toHaveBeenCalledWith(
        "/workspace/.env",
        "TWENTY_API_TOKEN=token-123\n",
        "utf-8",
      );
    });

    it("updates an existing key without rewriting comments or unrelated values", async () => {
      vi.mocked(fs.pathExists).mockResolvedValue(true as never);
      vi.mocked(fs.readFile).mockResolvedValue(
        "# local env\nTWENTY_BASE_URL=https://api.example.com\nTWENTY_API_TOKEN=old-token\n" as never,
      );

      await upsertEnvValue("/workspace/.env", "TWENTY_API_TOKEN", "new-token");

      expect(fs.outputFile).toHaveBeenCalledWith(
        "/workspace/.env",
        "# local env\nTWENTY_BASE_URL=https://api.example.com\nTWENTY_API_TOKEN=new-token\n",
        "utf-8",
      );
    });

    it("quotes values that need env escaping", async () => {
      await upsertEnvValue("/workspace/.env", "TWENTY_API_TOKEN", "token with spaces");

      expect(fs.outputFile).toHaveBeenCalledWith(
        "/workspace/.env",
        'TWENTY_API_TOKEN="token with spaces"\n',
        "utf-8",
      );
    });
  });
});
