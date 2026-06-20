import { Command } from "commander";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { buildProgram } from "../../../program";
import { parseBody, parseArrayPayload } from "../body";
import { createCommandContext, createOutputContext } from "../context";
import {
  applyGlobalOptions,
  GLOBAL_OPTION_NAMES,
  GLOBAL_OPTION_VALUE_TOKENS,
  GlobalOptions,
  resolveGlobalOptions,
} from "../global-options";
import { readJsonInput, safeJsonParse, readFileOrStdin } from "../io";
import { normalizeOptionAliasArgv } from "../option-aliases";
import { createServices } from "../services";

// Mock fs-extra
vi.mock("fs-extra", () => ({
  default: {
    readFile: vi.fn(),
  },
}));

// Clear fs mock between tests
beforeEach(async () => {
  const fs = await import("fs-extra");
  vi.mocked(fs.default.readFile).mockClear();
});

// Mock the service dependencies
vi.mock("../../api/services/api.service", () => ({
  ApiService: vi.fn(function MockApiService() {
    return {
      get: vi.fn(),
      post: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    };
  }),
}));

vi.mock("../../config/services/config.service", () => ({
  ConfigService: vi.fn(function MockConfigService() {
    return {
      getConfig: vi.fn(),
      resolveApiConfig: vi.fn(),
    };
  }),
}));

vi.mock("../../records/services/records.service", () => ({
  RecordsService: vi.fn(function MockRecordsService() {
    return {
      list: vi.fn(),
      get: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    };
  }),
}));

vi.mock("../../metadata/services/metadata.service", () => ({
  MetadataService: vi.fn(function MockMetadataService() {
    return {
      listObjects: vi.fn(),
      getObject: vi.fn(),
    };
  }),
}));

vi.mock("../../search/services/search.service", () => ({
  SearchService: vi.fn(function MockSearchService() {
    return {
      search: vi.fn(),
    };
  }),
}));

vi.mock("../../api/services/public-http.service", () => ({
  PublicHttpService: vi.fn(function MockPublicHttpService() {
    return {
      request: vi.fn(),
    };
  }),
}));

vi.mock("../../output/services/output.service", () => ({
  OutputService: vi.fn(function MockOutputService() {
    return {
      render: vi.fn(),
    };
  }),
}));

vi.mock("../../output/services/query.service", () => ({
  QueryService: vi.fn(function MockQueryService() {
    return {
      query: vi.fn(),
    };
  }),
}));

vi.mock("../../output/services/table.service", () => ({
  TableService: vi.fn(function MockTableService() {
    return {
      render: vi.fn(),
    };
  }),
}));

vi.mock("../../file/services/export.service", () => ({
  ExportService: vi.fn(function MockExportService() {
    return {
      export: vi.fn(),
    };
  }),
}));

vi.mock("../../file/services/import.service", () => ({
  ImportService: vi.fn(function MockImportService() {
    return {
      import: vi.fn(),
    };
  }),
}));

vi.mock("../../schema/schema-cache.service", () => ({
  SchemaCacheService: vi.fn(function MockSchemaCacheService() {
    return {
      clear: vi.fn().mockResolvedValue({ cleared: [] }),
      readFreshSchema: vi.fn().mockResolvedValue(undefined),
      writeSchema: vi.fn().mockResolvedValue(undefined),
      refresh: vi.fn(),
      status: vi.fn(),
    };
  }),
}));

describe("body utilities", () => {
  describe("parseBody", () => {
    it("parses JSON from --data string", async () => {
      const result = await parseBody('{"name":"Test","count":42}');
      expect(result).toEqual({ name: "Test", count: 42 });
    });

    it("parses JSON from --file path", async () => {
      const fs = await import("fs-extra");
      vi.mocked(fs.default.readFile).mockResolvedValue('{"key":"value"}');

      const result = await parseBody(undefined, "/path/to/file.json");
      expect(result).toEqual({ key: "value" });
      expect(fs.default.readFile).toHaveBeenCalledWith("/path/to/file.json", "utf-8");
    });

    it("merges --set values into JSON payload", async () => {
      const result = await parseBody('{"existing":"value"}', undefined, ["name=Test", "count=42"]);
      expect(result).toEqual({ existing: "value", name: "Test", count: 42 });
    });

    it("creates object from --set values alone", async () => {
      const result = await parseBody(undefined, undefined, ["name=Test", "count=42"]);
      expect(result).toEqual({ name: "Test", count: 42 });
    });

    it("handles nested --set values", async () => {
      const result = await parseBody(undefined, undefined, ["user.name=John", "user.age=30"]);
      expect(result).toEqual({ user: { name: "John", age: 30 } });
    });

    it("throws error when payload is not an object", async () => {
      await expect(parseBody('["array"]')).rejects.toThrow("Payload must be a JSON object");
    });

    it("throws error when payload is a primitive", async () => {
      await expect(parseBody('"string"')).rejects.toThrow("Payload must be a JSON object");
    });

    it("throws error when no input is provided", async () => {
      await expect(parseBody()).rejects.toThrow(
        "Missing JSON payload; use --data, --file, or --set",
      );
    });

    it("throws error when data is empty string and no sets", async () => {
      await expect(parseBody("", undefined, [])).rejects.toThrow(
        "Missing JSON payload; use --data, --file, or --set",
      );
    });

    it("throws error when data is whitespace only", async () => {
      await expect(parseBody("   ", undefined, [])).rejects.toThrow(
        "Missing JSON payload; use --data, --file, or --set",
      );
    });

    it("prefers --data over --file when both provided", async () => {
      const fs = await import("fs-extra");
      vi.mocked(fs.default.readFile).mockResolvedValue('{"from":"file"}');

      const result = await parseBody('{"from":"data"}', "/path/to/file.json");
      expect(result).toEqual({ from: "data" });
      expect(fs.default.readFile).not.toHaveBeenCalled();
    });
  });

  describe("parseArrayPayload", () => {
    it("parses JSON array from --data string", async () => {
      const result = await parseArrayPayload('[{"id":1},{"id":2}]');
      expect(result).toEqual([{ id: 1 }, { id: 2 }]);
    });

    it("parses JSON array from --file path", async () => {
      const fs = await import("fs-extra");
      vi.mocked(fs.default.readFile).mockResolvedValue("[1, 2, 3]");

      const result = await parseArrayPayload(undefined, "/path/to/file.json");
      expect(result).toEqual([1, 2, 3]);
    });

    it("throws error when payload is not an array", async () => {
      await expect(parseArrayPayload('{"not":"array"}')).rejects.toThrow(
        "Batch payload must be a JSON array",
      );
    });

    it("throws error when no input is provided", async () => {
      await expect(parseArrayPayload()).rejects.toThrow(
        "Missing JSON payload; use --data or --file",
      );
    });

    it("throws error when data is empty string", async () => {
      await expect(parseArrayPayload("")).rejects.toThrow(
        "Missing JSON payload; use --data or --file",
      );
    });
  });
});

describe("global-options utilities", () => {
  describe("shared metadata", () => {
    it("exports the canonical global option names", () => {
      expect(GLOBAL_OPTION_NAMES).toEqual(
        new Set([
          "output",
          "query",
          "workspace",
          "env-file",
          "debug",
          "no-retry",
          "light",
          "full",
          "agent-mode",
          "read-source",
          "invalidate-metadata-cache",
        ]),
      );
    });

    it("exports the global flags that consume values", () => {
      expect(GLOBAL_OPTION_VALUE_TOKENS).toEqual(
        new Set(["-o", "--output", "--query", "--workspace", "--env-file", "--read-source"]),
      );
    });
  });

  describe("applyGlobalOptions", () => {
    it("adds output flag to command", () => {
      const command = new Command("test");
      applyGlobalOptions(command);

      const outputOption = command.options.find((opt) => opt.long === "--output");
      expect(outputOption).toBeDefined();
      expect(outputOption?.short).toBe("-o");
    });

    it("adds query flag by default", () => {
      const command = new Command("test");
      applyGlobalOptions(command);

      const queryOption = command.options.find((opt) => opt.long === "--query");
      expect(queryOption).toBeDefined();
    });

    it("excludes query flag when includeQuery is false", () => {
      const command = new Command("test");
      applyGlobalOptions(command, { includeQuery: false });

      const queryOption = command.options.find((opt) => opt.long === "--query");
      expect(queryOption).toBeUndefined();
    });

    it("adds workspace flag to command", () => {
      const command = new Command("test");
      applyGlobalOptions(command);

      const workspaceOption = command.options.find((opt) => opt.long === "--workspace");
      expect(workspaceOption).toBeDefined();
    });

    it("adds debug flag to command", () => {
      const command = new Command("test");
      applyGlobalOptions(command);

      const debugOption = command.options.find((opt) => opt.long === "--debug");
      expect(debugOption).toBeDefined();
    });

    it("adds no-retry flag to command", () => {
      const command = new Command("test");
      applyGlobalOptions(command);

      const noRetryOption = command.options.find((opt) => opt.long === "--no-retry");
      expect(noRetryOption).toBeDefined();
    });

    it("adds agent-light mode flags to command", () => {
      const command = new Command("test");
      applyGlobalOptions(command);

      expect(command.options.find((opt) => opt.long === "--light")).toBeDefined();
      expect(command.options.find((opt) => opt.long === "--full")).toBeDefined();
      expect(command.options.find((opt) => opt.long === "--agent-mode")).toBeDefined();
      expect(command.options.find((opt) => opt.long === "--li")).toBeUndefined();
      expect(command.options.find((opt) => opt.long === "--ai")).toBeUndefined();
    });

    it("adds read source flags to command", () => {
      const command = new Command("test");
      applyGlobalOptions(command);

      expect(command.options.find((opt) => opt.long === "--read-source")).toBeDefined();
      expect(command.options.find((opt) => opt.long === "--rs")).toBeUndefined();
    });

    it("registers global options on the root program and subcommands", () => {
      const program = buildProgram();
      const auth = program.commands.find((command) => command.name() === "auth");
      const status = auth?.commands.find((command) => command.name() === "status");

      expect(program.options.some((option) => option.long === "--agent-mode")).toBe(true);
      expect(program.options.some((option) => option.long === "--read-source")).toBe(true);
      expect(status?.options.some((option) => option.long === "--agent-mode")).toBe(true);
      expect(status?.options.some((option) => option.long === "--read-source")).toBe(true);
    });
  });

  describe("resolveGlobalOptions", () => {
    let originalEnv: NodeJS.ProcessEnv;

    beforeEach(() => {
      originalEnv = { ...process.env };
      // Clear relevant env vars
      delete process.env.TWENTY_OUTPUT;
      delete process.env.TWENTY_QUERY;
      delete process.env.TWENTY_PROFILE;
      delete process.env.TWENTY_DEBUG;
      delete process.env.TWENTY_NO_RETRY;
      delete process.env.TWENTY_AGENT;
      delete process.env.TWENTY_AGENT_MODE;
      delete process.env.TWENTY_INVALIDATE_METADATA_CACHE;
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it("returns default output format as light compact JSON", () => {
      const command = new Command("test");
      applyGlobalOptions(command);
      command.parse(["node", "test"]);

      const options = resolveGlobalOptions(command);
      expect(options.output).toBe("json");
      expect(options.light).toBe(true);
      expect(options.full).toBe(false);
      expect(options.agentMode).toBe(false);
    });

    it("keeps explicit text output out of light mode unless requested", () => {
      const command = new Command("test");
      applyGlobalOptions(command);
      command.parse(["node", "test", "--output", "text"]);

      expect(resolveGlobalOptions(command)).toMatchObject({
        output: "text",
        light: false,
      });

      const lightCommand = new Command("light");
      applyGlobalOptions(lightCommand);
      lightCommand.parse(
        normalizeOptionAliasArgv(["node", "light", "--output", "text", "--li"], lightCommand),
      );

      expect(resolveGlobalOptions(lightCommand)).toMatchObject({
        output: "text",
        light: true,
      });
    });

    it("reads output from command option", () => {
      const command = new Command("test");
      applyGlobalOptions(command);
      command.parse(["node", "test", "--output", "json"]);

      const options = resolveGlobalOptions(command);
      expect(options.output).toBe("json");
    });

    it("reads output from TWENTY_OUTPUT env var", () => {
      process.env.TWENTY_OUTPUT = "csv";

      const command = new Command("test");
      applyGlobalOptions(command);
      command.parse(["node", "test"]);

      const options = resolveGlobalOptions(command);
      expect(options.output).toBe("csv");
    });

    it("accepts jsonl output format", () => {
      const command = new Command("test");
      applyGlobalOptions(command);
      command.parse(["node", "test", "--output", "jsonl"]);

      const options = resolveGlobalOptions(command);
      expect(options.output).toBe("jsonl");
    });

    it("accepts markdown output format", () => {
      const command = new Command("test");
      applyGlobalOptions(command);
      command.parse(["node", "test", "--output", "markdown"]);

      const options = resolveGlobalOptions(command);
      expect(options.output).toBe("markdown");
    });

    it("rejects agent output format", () => {
      process.env.TWENTY_OUTPUT = "agent";

      const command = new Command("test");
      applyGlobalOptions(command);
      command.parse(["node", "test"]);

      expect(() => resolveGlobalOptions(command)).toThrow(
        'Output format "agent" has been removed; use --agent-mode and optionally --li or --full.',
      );
    });

    it("prefers command option over env var for output", () => {
      process.env.TWENTY_OUTPUT = "csv";

      const command = new Command("test");
      applyGlobalOptions(command);
      command.parse(["node", "test", "--output", "json"]);

      const options = resolveGlobalOptions(command);
      expect(options.output).toBe("json");
    });

    it("rejects invalid output format", () => {
      process.env.TWENTY_OUTPUT = "invalid";

      const command = new Command("test");
      applyGlobalOptions(command);
      command.parse(["node", "test"]);

      expect(() => resolveGlobalOptions(command)).toThrow(
        'Unsupported output format "invalid". Valid formats: json, jsonl, csv, text, markdown.',
      );
    });

    it("resolves light mode from --light and --li", () => {
      const longCommand = new Command("long");
      applyGlobalOptions(longCommand);
      longCommand.parse(["node", "long", "--light"]);

      const aliasCommand = new Command("alias");
      applyGlobalOptions(aliasCommand);
      aliasCommand.parse(normalizeOptionAliasArgv(["node", "alias", "--li"], aliasCommand));

      expect(resolveGlobalOptions(longCommand)).toMatchObject({
        output: "json",
        light: true,
        full: false,
      });
      expect(resolveGlobalOptions(aliasCommand)).toMatchObject({
        output: "json",
        light: true,
        full: false,
      });
    });

    it("resolves full mode from --full", () => {
      const command = new Command("test");
      applyGlobalOptions(command);
      command.parse(["node", "test", "--full"]);

      expect(resolveGlobalOptions(command)).toMatchObject({
        output: "json",
        light: false,
        full: true,
      });
    });

    it("rejects light and full together", () => {
      const command = new Command("test");
      applyGlobalOptions(command);
      command.parse(normalizeOptionAliasArgv(["node", "test", "--li", "--full"], command));

      expect(() => resolveGlobalOptions(command)).toThrow(
        "--light and --full cannot be used together.",
      );
    });

    it("resolves agent mode as JSON light output unless full is explicit", () => {
      const lightCommand = new Command("light");
      applyGlobalOptions(lightCommand);
      lightCommand.parse(["node", "light", "--agent-mode"]);

      const aliasCommand = new Command("alias");
      applyGlobalOptions(aliasCommand);
      aliasCommand.parse(
        normalizeOptionAliasArgv(["node", "alias", "--ai", "--full"], aliasCommand),
      );

      expect(resolveGlobalOptions(lightCommand)).toMatchObject({
        output: "json",
        agentMode: true,
        light: true,
        full: false,
      });
      expect(resolveGlobalOptions(aliasCommand)).toMatchObject({
        output: "json",
        agentMode: true,
        light: false,
        full: true,
      });
    });

    it("resolves agent mode from TWENTY_AGENT_MODE", () => {
      process.env.TWENTY_AGENT_MODE = "true";

      const command = new Command("test");
      applyGlobalOptions(command);
      command.parse(["node", "test"]);

      expect(resolveGlobalOptions(command)).toMatchObject({
        output: "json",
        agentMode: true,
        light: true,
      });
    });

    it("does not enable agent mode from legacy TWENTY_AGENT", () => {
      process.env.TWENTY_AGENT = "true";

      const command = new Command("test");
      applyGlobalOptions(command);
      command.parse(["node", "test"]);

      expect(resolveGlobalOptions(command)).toMatchObject({
        output: "json",
        agentMode: false,
        light: true,
      });
    });

    it("resolves read source from --read-source and --rs", () => {
      const longCommand = new Command("long");
      applyGlobalOptions(longCommand);
      longCommand.parse(["node", "long", "--read-source", "api"]);

      const aliasCommand = new Command("alias");
      applyGlobalOptions(aliasCommand);
      aliasCommand.parse(normalizeOptionAliasArgv(["node", "alias", "--rs", "db"], aliasCommand));

      expect(resolveGlobalOptions(longCommand).readSource).toBe("api");
      expect(resolveGlobalOptions(aliasCommand).readSource).toBe("db");
    });

    it("rejects invalid read source values", () => {
      const command = new Command("test");
      applyGlobalOptions(command);
      command.parse(normalizeOptionAliasArgv(["node", "test", "--rs", "dashboard"], command));

      expect(() => resolveGlobalOptions(command)).toThrow(
        'Unsupported read source "dashboard". Valid sources: auto, api, db.',
      );
    });

    it("resolves root global options from the command path", () => {
      const root = new Command("twenty");
      applyGlobalOptions(root);
      const auth = root.command("auth");
      const status = auth.command("status");
      applyGlobalOptions(status);

      root.parse([
        "node",
        "twenty",
        "--agent-mode",
        "--read-source",
        "api",
        "auth",
        "status",
        "--full",
      ]);

      expect(resolveGlobalOptions(status)).toMatchObject({
        output: "json",
        agentMode: true,
        light: false,
        full: true,
        readSource: "api",
      });
    });

    it("reads query from command option", () => {
      const command = new Command("test");
      applyGlobalOptions(command);
      command.parse(["node", "test", "--query", "[0].name"]);

      const options = resolveGlobalOptions(command);
      expect(options.query).toBe("[0].name");
    });

    it("reads query from TWENTY_QUERY env var", () => {
      process.env.TWENTY_QUERY = "[0].id";

      const command = new Command("test");
      applyGlobalOptions(command);
      command.parse(["node", "test"]);

      const options = resolveGlobalOptions(command);
      expect(options.query).toBe("[0].id");
    });

    it("uses outputQuery override when provided", () => {
      process.env.TWENTY_QUERY = "env-query";

      const command = new Command("test");
      applyGlobalOptions(command);
      command.parse(["node", "test", "--query", "cmd-query"]);

      const options = resolveGlobalOptions(command, { outputQuery: "override-query" });
      expect(options.query).toBe("override-query");
    });

    it("reads workspace from command option", () => {
      const command = new Command("test");
      applyGlobalOptions(command);
      command.parse(["node", "test", "--workspace", "prod"]);

      const options = resolveGlobalOptions(command);
      expect(options.workspace).toBe("prod");
    });

    it("reads workspace from TWENTY_PROFILE env var", () => {
      process.env.TWENTY_PROFILE = "staging";

      const command = new Command("test");
      applyGlobalOptions(command);
      command.parse(["node", "test"]);

      const options = resolveGlobalOptions(command);
      expect(options.workspace).toBe("staging");
    });

    it("reads debug from command option", () => {
      const command = new Command("test");
      applyGlobalOptions(command);
      command.parse(["node", "test", "--debug"]);

      const options = resolveGlobalOptions(command);
      expect(options.debug).toBe(true);
    });

    it("reads debug from TWENTY_DEBUG env var", () => {
      process.env.TWENTY_DEBUG = "true";

      const command = new Command("test");
      applyGlobalOptions(command);
      command.parse(["node", "test"]);

      const options = resolveGlobalOptions(command);
      expect(options.debug).toBe(true);
    });

    it("defaults debug to false", () => {
      const command = new Command("test");
      applyGlobalOptions(command);
      command.parse(["node", "test"]);

      const options = resolveGlobalOptions(command);
      expect(options.debug).toBe(false);
    });

    it("reads noRetry from TWENTY_NO_RETRY env var", () => {
      process.env.TWENTY_NO_RETRY = "true";

      const command = new Command("test");
      applyGlobalOptions(command);
      command.parse(["node", "test"]);

      const options = resolveGlobalOptions(command);
      expect(options.noRetry).toBe(true);
    });

    it("reads noRetry from --no-retry flag", () => {
      const command = new Command("test");
      applyGlobalOptions(command);
      command.parse(["node", "test", "--no-retry"]);

      const options = resolveGlobalOptions(command);
      expect(options.noRetry).toBe(true);
    });

    it("defaults noRetry to false", () => {
      const command = new Command("test");
      applyGlobalOptions(command);
      command.parse(["node", "test"]);

      const options = resolveGlobalOptions(command);
      expect(options.noRetry).toBe(false);
    });

    it("derives an output kind from the command path", () => {
      const root = new Command("twenty");
      const auth = root.command("auth");
      const workspace = auth.command("workspace");
      applyGlobalOptions(workspace);
      root.parse(["node", "twenty", "auth", "workspace"]);

      const options = resolveGlobalOptions(workspace);
      expect(options.outputKind).toBe("twenty.auth.workspace");
    });

    it("derives output kind for mcp search from the full command path", () => {
      const root = new Command("twenty");
      const mcp = root.command("mcp");
      const search = mcp.command("search");
      applyGlobalOptions(search);
      root.parse(["node", "twenty", "mcp", "search", "--agent-mode"]);

      const options = resolveGlobalOptions(search);
      expect(options.outputKind).toBe("twenty.mcp.search");
    });

    it("reads invalidateMetadataCache from --invalidate-metadata-cache flag", () => {
      const command = new Command("test");
      applyGlobalOptions(command);
      command.parse(["node", "test", "--invalidate-metadata-cache"]);

      const options = resolveGlobalOptions(command);
      expect(options.invalidateMetadataCache).toBe(true);
    });

    it("reads invalidateMetadataCache from TWENTY_INVALIDATE_METADATA_CACHE env var", () => {
      process.env.TWENTY_INVALIDATE_METADATA_CACHE = "true";

      const command = new Command("test");
      applyGlobalOptions(command);
      command.parse(["node", "test"]);

      const options = resolveGlobalOptions(command);
      expect(options.invalidateMetadataCache).toBe(true);
    });

    it("defaults invalidateMetadataCache to false", () => {
      const command = new Command("test");
      applyGlobalOptions(command);
      command.parse(["node", "test"]);

      const options = resolveGlobalOptions(command);
      expect(options.invalidateMetadataCache).toBe(false);
    });
  });
});

describe("io utilities", () => {
  describe("safeJsonParse", () => {
    it("parses valid JSON object", () => {
      const result = safeJsonParse('{"key":"value"}');
      expect(result).toEqual({ key: "value" });
    });

    it("parses valid JSON array", () => {
      const result = safeJsonParse("[1, 2, 3]");
      expect(result).toEqual([1, 2, 3]);
    });

    it("parses JSON primitives", () => {
      expect(safeJsonParse('"string"')).toBe("string");
      expect(safeJsonParse("42")).toBe(42);
      expect(safeJsonParse("true")).toBe(true);
      expect(safeJsonParse("null")).toBe(null);
    });

    it("throws on invalid JSON", () => {
      expect(() => safeJsonParse("{invalid}")).toThrow();
      expect(() => safeJsonParse("undefined")).toThrow();
    });
  });

  describe("readFileOrStdin", () => {
    it("reads from file path", async () => {
      const fs = await import("fs-extra");
      vi.mocked(fs.default.readFile).mockResolvedValue("file content");

      const result = await readFileOrStdin("/path/to/file.txt");
      expect(result).toBe("file content");
      expect(fs.default.readFile).toHaveBeenCalledWith("/path/to/file.txt", "utf-8");
    });

    // Note: Testing stdin with path='-' requires mocking process.stdin
    // which is complex. The function delegates to readStdin() for that case.
  });

  describe("readJsonInput", () => {
    it("parses data string when provided", async () => {
      const result = await readJsonInput('{"key":"value"}');
      expect(result).toEqual({ key: "value" });
    });

    it("reads and parses file when filePath provided", async () => {
      const fs = await import("fs-extra");
      vi.mocked(fs.default.readFile).mockResolvedValue('{"from":"file"}');

      const result = await readJsonInput(undefined, "/path/to/file.json");
      expect(result).toEqual({ from: "file" });
    });

    it("returns undefined when no input provided", async () => {
      const result = await readJsonInput();
      expect(result).toBeUndefined();
    });

    it("returns undefined when data is empty string", async () => {
      const result = await readJsonInput("");
      expect(result).toBeUndefined();
    });

    it("returns undefined when data is whitespace only", async () => {
      const result = await readJsonInput("   ");
      expect(result).toBeUndefined();
    });

    it("returns undefined when file content is empty", async () => {
      const fs = await import("fs-extra");
      vi.mocked(fs.default.readFile).mockResolvedValue("");

      const result = await readJsonInput(undefined, "/path/to/empty.json");
      expect(result).toBeUndefined();
    });

    it("returns undefined when file content is whitespace only", async () => {
      const fs = await import("fs-extra");
      vi.mocked(fs.default.readFile).mockResolvedValue("   \n   ");

      const result = await readJsonInput(undefined, "/path/to/empty.json");
      expect(result).toBeUndefined();
    });

    it("prefers data over filePath when both provided", async () => {
      const fs = await import("fs-extra");
      vi.mocked(fs.default.readFile).mockResolvedValue('{"from":"file"}');

      const result = await readJsonInput('{"from":"data"}', "/path/to/file.json");
      expect(result).toEqual({ from: "data" });
      expect(fs.default.readFile).not.toHaveBeenCalled();
    });

    it("throws on invalid JSON in data", async () => {
      await expect(readJsonInput("{invalid}")).rejects.toThrow();
    });

    it("throws on invalid JSON in file", async () => {
      const fs = await import("fs-extra");
      vi.mocked(fs.default.readFile).mockResolvedValue("{invalid json}");

      await expect(readJsonInput(undefined, "/path/to/file.json")).rejects.toThrow();
    });

    it("trims filePath before use", async () => {
      const fs = await import("fs-extra");
      vi.mocked(fs.default.readFile).mockResolvedValue('{"key":"value"}');

      const result = await readJsonInput(undefined, "  /path/to/file.json  ");
      expect(result).toEqual({ key: "value" });
      expect(fs.default.readFile).toHaveBeenCalledWith("/path/to/file.json", "utf-8");
    });
  });
});

describe("services factory", () => {
  describe("command context helpers", () => {
    it("creates a command context with resolved global options and services", async () => {
      const command = new Command("list");
      const root = new Command("twenty");
      root.exitOverride();
      root.addCommand(command);
      applyGlobalOptions(command);
      root.parse(["node", "twenty", "list", "--output", "json", "--workspace", "prod"]);

      const context = await createCommandContext(command);

      expect(context.globalOptions.output).toBe("json");
      expect(context.globalOptions.workspace).toBe("prod");
      expect(context.services).toHaveProperty("config");
      expect(context.services).toHaveProperty("api");
      expect(context.services).toHaveProperty("publicHttp");
      expect(context.services).toHaveProperty("search");
      expect(context.services).toHaveProperty("records");
      expect(context.services).toHaveProperty("metadata");
      expect(context.services).toHaveProperty("mcp");
      expect(context.services).toHaveProperty("output");
      expect(context.services).toHaveProperty("importer");
      expect(context.services).toHaveProperty("exporter");
    });

    it("creates an output context with derived output kind", async () => {
      const { OutputService } = await import("../../output/services/output.service");
      const command = new Command("status");
      const auth = new Command("auth");
      const root = new Command("twenty");
      root.exitOverride();
      auth.addCommand(command);
      root.addCommand(auth);
      applyGlobalOptions(command);
      root.parse(["node", "twenty", "auth", "status", "--agent-mode"]);

      const context = createOutputContext(command);

      expect(context.globalOptions.output).toBe("json");
      expect(context.globalOptions.agentMode).toBe(true);
      expect(context.globalOptions.light).toBe(true);
      expect(context.globalOptions.outputKind).toBe("twenty.auth.status");
      expect(OutputService).toHaveBeenCalled();
      expect(context.output).toHaveProperty("render");
    });
  });

  describe("createServices", () => {
    it("returns CliServices object with all required services", async () => {
      const globalOptions: GlobalOptions = {
        output: "json",
        debug: false,
        noRetry: false,
      };

      const services = await createServices(globalOptions);

      expect(services).toHaveProperty("config");
      expect(services).toHaveProperty("api");
      expect(services).toHaveProperty("publicHttp");
      expect(services).toHaveProperty("search");
      expect(services).toHaveProperty("records");
      expect(services).toHaveProperty("metadata");
      expect(services).toHaveProperty("mcp");
      expect(services).toHaveProperty("output");
      expect(services).toHaveProperty("importer");
      expect(services).toHaveProperty("exporter");
    });

    it("passes workspace option to ApiService", async () => {
      const { ApiService } = await import("../../api/services/api.service");

      const globalOptions: GlobalOptions = {
        workspace: "production",
        debug: false,
        noRetry: false,
      };

      await createServices(globalOptions);

      expect(ApiService).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ workspace: "production" }),
      );
    });

    it("passes debug option to ApiService", async () => {
      const { ApiService } = await import("../../api/services/api.service");

      const globalOptions: GlobalOptions = {
        debug: true,
        noRetry: false,
      };

      await createServices(globalOptions);

      expect(ApiService).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ debug: true }),
      );
    });

    it("passes noRetry option to ApiService", async () => {
      const { ApiService } = await import("../../api/services/api.service");

      const globalOptions: GlobalOptions = {
        debug: false,
        noRetry: true,
      };

      await createServices(globalOptions);

      expect(ApiService).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ noRetry: true }),
      );
    });

    it("creates services with default options", async () => {
      const globalOptions: GlobalOptions = {};

      const services = await createServices(globalOptions);

      expect(services.config).toBeDefined();
      expect(services.api).toBeDefined();
      expect(services.publicHttp).toBeDefined();
      expect(services.search).toBeDefined();
      expect(services.records).toBeDefined();
      expect(services.metadata).toBeDefined();
      expect(services.mcp).toBeDefined();
      expect(services.output).toBeDefined();
      expect(services.importer).toBeDefined();
      expect(services.exporter).toBeDefined();
    });

    it("creates new service instances on each call", async () => {
      const globalOptions: GlobalOptions = {};

      const services1 = await createServices(globalOptions);
      const services2 = await createServices(globalOptions);

      // Each call should create new instances
      expect(services1.api).not.toBe(services2.api);
      expect(services1.records).not.toBe(services2.records);
    });

    it("clears the metadata-objects schema cache when invalidateMetadataCache is true", async () => {
      const globalOptions: GlobalOptions = {
        invalidateMetadataCache: true,
      };

      const services = await createServices(globalOptions);

      expect(services.schemaCache.clear).toHaveBeenCalledWith({ kind: "metadata-objects" });
    });

    it("does not clear the schema cache when invalidateMetadataCache is unset", async () => {
      const globalOptions: GlobalOptions = {};

      const services = await createServices(globalOptions);

      expect(services.schemaCache.clear).not.toHaveBeenCalled();
    });
  });
});
