import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { mockConstructor } from "../../../test-utils/mock-constructor";
import { ApiService } from "../../../utilities/api/services/api.service";
import { CliError } from "../../../utilities/errors/cli-error";
import { registerEventLogsCommand } from "../event-logs.command";

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

describe("event logs command", () => {
  let program: Command;
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let mockPost: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    program = new Command();
    program.exitOverride();
    registerEventLogsCommand(program);
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

  it("registers the event-logs command", () => {
    const cmd = program.commands.find((candidate) => candidate.name() === "event-logs");
    const listCmd = cmd?.commands[0];

    expect(cmd).toBeDefined();
    expect(cmd?.description()).toBe("Query enterprise event logs");
    expect(cmd?.registeredArguments ?? []).toHaveLength(0);
    expect(cmd?.commands.map((candidate) => candidate.name())).toEqual(["list"]);
    expect(listCmd?.options.find((option) => option.long === "--table")).toBeDefined();
    expect(listCmd?.options.find((option) => option.long === "--limit")).toBeDefined();
    expect(listCmd?.options.find((option) => option.long === "--cursor")).toBeDefined();
    expect(listCmd?.options.find((option) => option.long === "--first")).toBeUndefined();
    expect(listCmd?.options.find((option) => option.long === "--after")).toBeUndefined();
  });

  it("queries event logs with normalized table and filters", async () => {
    mockPost.mockResolvedValue({
      data: {
        data: {
          eventLogs: {
            records: [
              {
                event: "workspace.member.created",
                timestamp: "2026-03-23T00:00:00.000Z",
                userId: "usr_123",
              },
            ],
            totalCount: 1,
            pageInfo: {
              endCursor: "cursor-1",
              hasNextPage: false,
            },
          },
        },
      },
    });

    await program.parseAsync([
      "node",
      "test",
      "event-logs",
      "list",
      "--table",
      "workspace-event",
      "--limit",
      "25",
      "--cursor",
      "cursor-1",
      "--event-type",
      "workspace.member.created",
      "--start",
      "2026-03-01T00:00:00.000Z",
      "-o",
      "json",
      "--full",
    ]);

    expect(mockPost).toHaveBeenCalledWith("/metadata", {
      query: expect.stringContaining("eventLogs"),
      variables: {
        input: {
          table: "WORKSPACE_EVENT",
          first: 25,
          after: "cursor-1",
          filters: {
            eventType: "workspace.member.created",
            dateRange: {
              start: "2026-03-01T00:00:00.000Z",
            },
          },
        },
      },
    });

    expect(JSON.parse(consoleSpy.mock.calls[0][0] as string)).toEqual([
      {
        event: "workspace.member.created",
        timestamp: "2026-03-23T00:00:00.000Z",
        userId: "usr_123",
      },
    ]);
  });

  it("returns the full result when include-page-info is set", async () => {
    mockPost.mockResolvedValue({
      data: {
        data: {
          eventLogs: {
            records: [],
            totalCount: 0,
            pageInfo: {
              endCursor: null,
              hasNextPage: false,
            },
          },
        },
      },
    });

    await program.parseAsync([
      "node",
      "test",
      "event-logs",
      "list",
      "--table",
      "pageview",
      "--include-page-info",
      "-o",
      "json",
      "--full",
    ]);

    expect(JSON.parse(consoleSpy.mock.calls[0][0] as string)).toEqual({
      records: [],
      totalCount: 0,
      pageInfo: {
        endCursor: null,
        hasNextPage: false,
      },
    });
  });

  it("throws for unsupported subcommands", async () => {
    await expect(
      program.parseAsync(["node", "test", "event-logs", "explode", "--table", "workspace-event"]),
    ).rejects.toMatchObject({
      code: "commander.unknownCommand",
    });
  });

  it("throws for invalid table names", async () => {
    await expect(
      program.parseAsync(["node", "test", "event-logs", "list", "--table", "unknown"]),
    ).rejects.toThrow(CliError);
  });

  it("throws for invalid limit values", async () => {
    await expect(
      program.parseAsync([
        "node",
        "test",
        "event-logs",
        "list",
        "--table",
        "usage-event",
        "--limit",
        "0",
      ]),
    ).rejects.toThrow(CliError);
  });
});
