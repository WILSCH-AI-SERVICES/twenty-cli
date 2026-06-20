import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { mockConstructor } from "../../../test-utils/mock-constructor";
import { ApiService } from "../../../utilities/api/services/api.service";
import { CliError } from "../../../utilities/errors/cli-error";
import { RecordsService } from "../../../utilities/records/services/records.service";
import { registerMessageChannelsCommand } from "../message-channels.command";

const mockCreateCommandContext = vi.hoisted(() => vi.fn());

vi.mock("../../../utilities/api/services/api.service");
vi.mock("../../../utilities/records/services/records.service");
vi.mock("../../../utilities/shared/context", async () => {
  const actual = await vi.importActual<typeof import("../../../utilities/shared/context")>(
    "../../../utilities/shared/context",
  );

  return {
    ...actual,
    createCommandContext: mockCreateCommandContext,
  };
});
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

describe("message-channels command", () => {
  let program: Command;
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let mockGet: ReturnType<typeof vi.fn>;
  let mockPatch: ReturnType<typeof vi.fn>;
  let mockRecordsList: ReturnType<typeof vi.fn>;
  let mockRecordsGet: ReturnType<typeof vi.fn>;
  let mockRecordsUpdate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    program = new Command();
    program.exitOverride();
    registerMessageChannelsCommand(program);
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockGet = vi.fn();
    mockPatch = vi.fn();
    mockRecordsList = vi.fn();
    mockRecordsGet = vi.fn();
    mockRecordsUpdate = vi.fn();
    mockCreateCommandContext.mockReset();
    mockCreateCommandContext.mockReturnValue({
      globalOptions: {
        output: "json",
        query: undefined,
      },
      services: {
        records: {
          list: mockRecordsList,
          get: mockRecordsGet,
          update: mockRecordsUpdate,
        },
        output: {
          render: vi.fn(async (value: unknown) => {
            console.log(JSON.stringify(value));
          }),
        },
      },
    } as never);
    vi.mocked(ApiService).mockImplementation(
      mockConstructor(
        () =>
          ({
            get: mockGet,
            post: vi.fn(),
            put: vi.fn(),
            patch: mockPatch,
            delete: vi.fn(),
            request: vi.fn(),
          }) as unknown as ApiService,
      ),
    );
    vi.mocked(RecordsService).mockImplementation(
      mockConstructor(
        () =>
          ({
            list: mockRecordsList,
            get: mockRecordsGet,
            update: mockRecordsUpdate,
          }) as unknown as RecordsService,
      ),
    );
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    vi.clearAllMocks();
  });

  describe("command registration", () => {
    it("registers message-channels command with correct name and description", () => {
      const cmd = program.commands.find((candidate) => candidate.name() === "message-channels");
      expect(cmd).toBeDefined();
      expect(cmd?.description()).toBe("Inspect and update message channel settings");
    });

    it("has required operation argument and optional id argument", () => {
      const cmd = program.commands.find((candidate) => candidate.name() === "message-channels");
      const args = cmd?.registeredArguments ?? [];

      expect(args.length).toBe(2);
      expect(args[0].name()).toBe("operation");
      expect(args[0].required).toBe(true);
      expect(args[1].name()).toBe("id");
      expect(args[1].required).toBe(false);
    });

    it("has list and update payload options", () => {
      const cmd = program.commands.find((candidate) => candidate.name() === "message-channels");
      const opts = cmd?.options ?? [];

      expect(opts.find((option) => option.long === "--limit")).toBeDefined();
      expect(opts.find((option) => option.long === "--cursor")).toBeDefined();
      expect(opts.find((option) => option.long === "--data")).toBeDefined();
      expect(opts.find((option) => option.long === "--file")).toBeDefined();
      expect(opts.find((option) => option.long === "--set")).toBeDefined();
    });
  });

  describe("list operation", () => {
    it("lists message channels", async () => {
      mockRecordsList.mockResolvedValue({
        data: [
          {
            id: "mc-1",
            handle: "owner@example.com",
            visibility: "SHARE_EVERYTHING",
            isSyncEnabled: true,
            syncCursor: "cursor-value",
          },
        ],
      });

      await program.parseAsync([
        "node",
        "test",
        "message-channels",
        "list",
        "--limit",
        "5",
        "--cursor",
        "cursor-1",
        "-o",
        "json",
        "--full",
      ]);

      expect(mockCreateCommandContext).toHaveBeenCalled();
      expect(RecordsService).not.toHaveBeenCalled();
      expect(mockRecordsList).toHaveBeenCalledWith("messageChannels", {
        limit: 5,
        cursor: "cursor-1",
      });

      const output = consoleSpy.mock.calls[0][0] as string;
      expect(JSON.parse(output)).toEqual([
        {
          id: "mc-1",
          handle: "owner@example.com",
          visibility: "SHARE_EVERYTHING",
          isSyncEnabled: true,
          syncCursor: "[hidden]",
        },
      ]);
    });
  });

  describe("get operation", () => {
    it("gets one message channel by id", async () => {
      mockRecordsGet.mockResolvedValue({
        id: "mc-1",
        handle: "owner@example.com",
        excludeGroupEmails: false,
        syncCursor: "cursor-value",
      });

      await program.parseAsync([
        "node",
        "test",
        "message-channels",
        "get",
        "mc-1",
        "-o",
        "json",
        "--full",
      ]);

      expect(mockCreateCommandContext).toHaveBeenCalled();
      expect(RecordsService).not.toHaveBeenCalled();
      expect(mockRecordsGet).toHaveBeenCalledWith("messageChannels", "mc-1");
      const output = consoleSpy.mock.calls[0][0] as string;
      expect(JSON.parse(output)).toEqual({
        id: "mc-1",
        handle: "owner@example.com",
        excludeGroupEmails: false,
        syncCursor: "[hidden]",
      });
    });

    it("throws when the id is missing for get", async () => {
      await expect(program.parseAsync(["node", "test", "message-channels", "get"])).rejects.toThrow(
        CliError,
      );
    });
  });

  describe("update operation", () => {
    it("updates one message channel with a JSON payload", async () => {
      mockRecordsUpdate.mockResolvedValue({
        id: "mc-1",
        isSyncEnabled: false,
        excludeGroupEmails: true,
      });

      await program.parseAsync([
        "node",
        "test",
        "message-channels",
        "update",
        "mc-1",
        "-d",
        '{"isSyncEnabled":false,"excludeGroupEmails":true}',
        "-o",
        "json",
        "--full",
      ]);

      expect(mockCreateCommandContext).toHaveBeenCalled();
      expect(RecordsService).not.toHaveBeenCalled();
      expect(mockRecordsUpdate).toHaveBeenCalledWith("messageChannels", "mc-1", {
        isSyncEnabled: false,
        excludeGroupEmails: true,
      });

      const output = consoleSpy.mock.calls[0][0] as string;
      expect(JSON.parse(output)).toEqual({
        id: "mc-1",
        isSyncEnabled: false,
        excludeGroupEmails: true,
      });
    });

    it("throws when the id is missing for update", async () => {
      await expect(
        program.parseAsync([
          "node",
          "test",
          "message-channels",
          "update",
          "-d",
          '{"isSyncEnabled":false}',
        ]),
      ).rejects.toThrow(CliError);
    });
  });

  describe("unknown operations", () => {
    it("throws for unknown operations", async () => {
      await expect(
        program.parseAsync(["node", "test", "message-channels", "explode"]),
      ).rejects.toThrow(CliError);
    });
  });
});
