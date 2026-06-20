import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { mockConstructor } from "../../../test-utils/mock-constructor";
import { ApiService } from "../../../utilities/api/services/api.service";
import { CliError } from "../../../utilities/errors/cli-error";
import { RecordsService } from "../../../utilities/records/services/records.service";
import { registerConnectedAccountsCommand } from "../connected-accounts.command";

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

describe("connected-accounts command", () => {
  let program: Command;
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let mockGet: ReturnType<typeof vi.fn>;
  let mockPost: ReturnType<typeof vi.fn>;
  let mockRecordsList: ReturnType<typeof vi.fn>;
  let mockRecordsGet: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    program = new Command();
    program.exitOverride();
    registerConnectedAccountsCommand(program);
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockGet = vi.fn();
    mockPost = vi.fn();
    mockRecordsList = vi.fn();
    mockRecordsGet = vi.fn();
    mockCreateCommandContext.mockReset();
    mockCreateCommandContext.mockReturnValue({
      globalOptions: {
        output: "json",
        query: undefined,
      },
      services: {
        api: {
          post: mockPost,
        },
        records: {
          list: mockRecordsList,
          get: mockRecordsGet,
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
            post: mockPost,
            put: vi.fn(),
            patch: vi.fn(),
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
          }) as unknown as RecordsService,
      ),
    );
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    vi.clearAllMocks();
  });

  describe("command registration", () => {
    it("registers connected-accounts command with correct name and description", () => {
      const cmd = program.commands.find((candidate) => candidate.name() === "connected-accounts");
      expect(cmd).toBeDefined();
      expect(cmd?.description()).toBe("Inspect connected accounts and trigger channel sync");
    });

    it("has required operation argument and optional id argument", () => {
      const cmd = program.commands.find((candidate) => candidate.name() === "connected-accounts");
      const args = cmd?.registeredArguments ?? [];

      expect(args.length).toBe(2);
      expect(args[0].name()).toBe("operation");
      expect(args[0].required).toBe(true);
      expect(args[1].name()).toBe("id");
      expect(args[1].required).toBe(false);
    });

    it("has list and masking options", () => {
      const cmd = program.commands.find((candidate) => candidate.name() === "connected-accounts");
      const opts = cmd?.options ?? [];

      expect(opts.find((option) => option.long === "--limit")).toBeDefined();
      expect(opts.find((option) => option.long === "--cursor")).toBeDefined();
      expect(opts.find((option) => option.long === "--show-secrets")).toBeDefined();
      expect(opts.find((option) => option.long === "--account-owner-id")).toBeDefined();
      expect(opts.find((option) => option.long === "--handle")).toBeDefined();
      expect(opts.find((option) => option.long === "--data")).toBeDefined();
      expect(opts.find((option) => option.long === "--file")).toBeDefined();
      expect(opts.find((option) => option.long === "--set")).toBeDefined();
    });
  });

  describe("list operation", () => {
    it("lists connected accounts and masks sensitive fields by default", async () => {
      mockRecordsList.mockResolvedValue({
        data: [
          {
            id: "ca-1",
            handle: "owner@example.com",
            provider: "google",
            accessToken: "secret-access-token",
            refreshToken: "secret-refresh-token",
            connectionParameters: { SMTP: { password: "smtp-password" } },
          },
        ],
      });

      await program.parseAsync([
        "node",
        "test",
        "connected-accounts",
        "list",
        "--limit",
        "5",
        "-o",
        "json",
        "--full",
      ]);

      expect(mockCreateCommandContext).toHaveBeenCalled();
      expect(RecordsService).not.toHaveBeenCalled();
      expect(mockRecordsList).toHaveBeenCalledWith("connectedAccounts", {
        limit: 5,
        cursor: undefined,
      });

      const output = consoleSpy.mock.calls[0][0] as string;
      expect(JSON.parse(output)).toEqual([
        {
          id: "ca-1",
          handle: "owner@example.com",
          provider: "google",
          accessToken: "[hidden]",
          refreshToken: "[hidden]",
          connectionParameters: "[hidden]",
        },
      ]);
    });

    it("shows sensitive fields when --show-secrets is enabled", async () => {
      const account = {
        id: "ca-1",
        accessToken: "secret-access-token",
        refreshToken: "secret-refresh-token",
        connectionParameters: { SMTP: { password: "smtp-password" } },
      };
      mockRecordsList.mockResolvedValue({ data: [account] });

      await program.parseAsync([
        "node",
        "test",
        "connected-accounts",
        "list",
        "--show-secrets",
        "-o",
        "json",
        "--full",
      ]);

      const output = consoleSpy.mock.calls[0][0] as string;
      expect(JSON.parse(output)).toEqual([account]);
    });
  });

  describe("get operation", () => {
    it("gets one connected account and masks secrets by default", async () => {
      mockRecordsGet.mockResolvedValue({
        id: "ca-1",
        accessToken: "secret-access-token",
        refreshToken: "secret-refresh-token",
        connectionParameters: { SMTP: { password: "smtp-password" } },
      });

      await program.parseAsync([
        "node",
        "test",
        "connected-accounts",
        "get",
        "ca-1",
        "-o",
        "json",
        "--full",
      ]);

      expect(mockCreateCommandContext).toHaveBeenCalled();
      expect(RecordsService).not.toHaveBeenCalled();
      expect(mockRecordsGet).toHaveBeenCalledWith("connectedAccounts", "ca-1");
      const output = consoleSpy.mock.calls[0][0] as string;
      expect(JSON.parse(output)).toEqual({
        id: "ca-1",
        accessToken: "[hidden]",
        refreshToken: "[hidden]",
        connectionParameters: "[hidden]",
      });
    });

    it("throws when the id is missing for get", async () => {
      await expect(
        program.parseAsync(["node", "test", "connected-accounts", "get"]),
      ).rejects.toThrow(CliError);
    });
  });

  describe("sync operation", () => {
    it("starts channel sync for a connected account", async () => {
      mockPost.mockResolvedValue({
        data: { data: { startChannelSync: { success: true } } },
      });

      await program.parseAsync([
        "node",
        "test",
        "connected-accounts",
        "sync",
        "ca-1",
        "-o",
        "json",
        "--full",
      ]);

      expect(mockPost).toHaveBeenCalledWith("/graphql", {
        query: expect.stringContaining("startChannelSync"),
        variables: { connectedAccountId: "ca-1" },
      });

      const output = consoleSpy.mock.calls[0][0] as string;
      expect(JSON.parse(output)).toEqual({ success: true, connectedAccountId: "ca-1" });
    });

    it("throws when the id is missing for sync", async () => {
      await expect(
        program.parseAsync(["node", "test", "connected-accounts", "sync"]),
      ).rejects.toThrow(CliError);
    });
  });

  describe("imap-smtp-caldav operations", () => {
    it("gets one IMAP/SMTP/CALDAV account and masks passwords by default", async () => {
      mockPost.mockResolvedValue({
        data: {
          data: {
            getConnectedImapSmtpCaldavAccount: {
              id: "ca-1",
              handle: "owner@example.com",
              provider: "IMAP_SMTP_CALDAV",
              accountOwnerId: "wm-1",
              connectionParameters: {
                IMAP: {
                  host: "imap.example.com",
                  port: 993,
                  username: "owner@example.com",
                  password: "secret",
                  secure: true,
                },
              },
            },
          },
        },
      });

      await program.parseAsync([
        "node",
        "test",
        "connected-accounts",
        "get-imap-smtp-caldav",
        "ca-1",
        "-o",
        "json",
        "--full",
      ]);

      expect(mockPost).toHaveBeenCalledWith("/graphql", {
        query: expect.stringContaining("getConnectedImapSmtpCaldavAccount"),
        variables: { id: "ca-1" },
      });

      const output = consoleSpy.mock.calls[0][0] as string;
      expect(JSON.parse(output)).toEqual({
        id: "ca-1",
        handle: "owner@example.com",
        provider: "IMAP_SMTP_CALDAV",
        accountOwnerId: "wm-1",
        connectionParameters: {
          IMAP: {
            host: "imap.example.com",
            port: 993,
            username: "owner@example.com",
            password: "[hidden]",
            secure: true,
          },
        },
      });
    });

    it("shows IMAP/SMTP/CALDAV passwords when --show-secrets is enabled", async () => {
      mockPost.mockResolvedValue({
        data: {
          data: {
            getConnectedImapSmtpCaldavAccount: {
              id: "ca-1",
              handle: "owner@example.com",
              provider: "IMAP_SMTP_CALDAV",
              accountOwnerId: "wm-1",
              connectionParameters: {
                SMTP: {
                  host: "smtp.example.com",
                  port: 587,
                  username: "owner@example.com",
                  password: "secret",
                  secure: false,
                },
              },
            },
          },
        },
      });

      await program.parseAsync([
        "node",
        "test",
        "connected-accounts",
        "get-imap-smtp-caldav",
        "ca-1",
        "--show-secrets",
        "-o",
        "json",
        "--full",
      ]);

      const output = consoleSpy.mock.calls[0][0] as string;
      expect(JSON.parse(output)).toEqual({
        id: "ca-1",
        handle: "owner@example.com",
        provider: "IMAP_SMTP_CALDAV",
        accountOwnerId: "wm-1",
        connectionParameters: {
          SMTP: {
            host: "smtp.example.com",
            port: 587,
            username: "owner@example.com",
            password: "secret",
            secure: false,
          },
        },
      });
    });

    it("saves an IMAP/SMTP/CALDAV account from nested connection parameters", async () => {
      mockPost.mockResolvedValue({
        data: {
          data: {
            saveImapSmtpCaldavAccount: {
              success: true,
              connectedAccountId: "ca-1",
            },
          },
        },
      });

      await program.parseAsync([
        "node",
        "test",
        "connected-accounts",
        "save-imap-smtp-caldav",
        "--account-owner-id",
        "wm-1",
        "--handle",
        "owner@example.com",
        "--set",
        "IMAP.host=imap.example.com",
        "--set",
        "IMAP.port=993",
        "--set",
        "IMAP.username=owner@example.com",
        "--set",
        "IMAP.password=secret",
        "--set",
        "IMAP.secure=true",
        "-o",
        "json",
        "--full",
      ]);

      expect(mockPost).toHaveBeenCalledWith("/graphql", {
        query: expect.stringContaining("saveImapSmtpCaldavAccount"),
        variables: {
          accountOwnerId: "wm-1",
          handle: "owner@example.com",
          connectionParameters: {
            IMAP: {
              host: "imap.example.com",
              port: 993,
              username: "owner@example.com",
              password: "secret",
              secure: true,
            },
          },
        },
      });

      const output = consoleSpy.mock.calls[0][0] as string;
      expect(JSON.parse(output)).toEqual({
        success: true,
        connectedAccountId: "ca-1",
      });
    });

    it("fails clearly when the workspace schema does not expose IMAP/SMTP/CALDAV operations", async () => {
      mockPost.mockResolvedValue({
        data: {
          errors: [
            {
              message: 'Cannot query field "getConnectedImapSmtpCaldavAccount" on type "Query".',
            },
          ],
        },
      });

      await expect(
        program.parseAsync([
          "node",
          "test",
          "connected-accounts",
          "get-imap-smtp-caldav",
          "ca-1",
          "-o",
          "json",
          "--full",
        ]),
      ).rejects.toThrow(
        "IMAP/SMTP/CALDAV account management is not available on this workspace because it does not expose getConnectedImapSmtpCaldavAccount.",
      );
    });
  });

  describe("unknown operations", () => {
    it("throws for unknown operations", async () => {
      await expect(
        program.parseAsync(["node", "test", "connected-accounts", "explode"]),
      ).rejects.toThrow(CliError);
    });
  });
});
