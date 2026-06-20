import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { mockConstructor } from "../../../test-utils/mock-constructor";
import { ApiService } from "../../../utilities/api/services/api.service";
import { registerDashboardsCommand } from "../dashboards.command";

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

describe("dashboards command", () => {
  let program: Command;
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let mockPost: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    program = new Command();
    program.exitOverride();
    registerDashboardsCommand(program);
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

  it("registers the dashboards command", () => {
    const dashboardsCmd = program.commands.find((cmd) => cmd.name() === "dashboards");

    expect(dashboardsCmd).toBeDefined();
    expect(dashboardsCmd?.description()).toBe("Manage dashboards");
  });

  it("duplicates a dashboard by ID", async () => {
    mockPost.mockResolvedValue({
      data: {
        id: "dashboard-copy-1",
        title: "Q1 Pipeline Copy",
        pageLayoutId: "layout-1",
        position: 2,
        createdAt: "2026-03-22T00:00:00.000Z",
        updatedAt: "2026-03-22T00:00:00.000Z",
      },
    });

    await program.parseAsync([
      "node",
      "test",
      "dashboards",
      "duplicate",
      "dashboard-1",
      "-o",
      "json",
      "--full",
    ]);

    expect(mockPost).toHaveBeenCalledWith("/rest/dashboards/dashboard-1/duplicate");
    const output = consoleSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(output);
    expect(parsed.id).toBe("dashboard-copy-1");
    expect(parsed.title).toBe("Q1 Pipeline Copy");
  });

  it("requires a dashboard ID for duplicate", async () => {
    await expect(program.parseAsync(["node", "test", "dashboards", "duplicate"])).rejects.toThrow(
      "missing required argument 'dashboardId'",
    );
  });
});
