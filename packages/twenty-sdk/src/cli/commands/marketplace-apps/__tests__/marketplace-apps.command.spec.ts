import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { mockConstructor } from "../../../test-utils/mock-constructor";
import { ApiService } from "../../../utilities/api/services/api.service";
import { CliError } from "../../../utilities/errors/cli-error";
import { registerMarketplaceAppsCommand } from "../marketplace-apps.command";

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

describe("marketplace-apps command", () => {
  let program: Command;
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let mockPost: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    program = new Command();
    program.exitOverride();
    registerMarketplaceAppsCommand(program);
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

  it("registers the command with install options", () => {
    const cmd = program.commands.find((candidate) => candidate.name() === "marketplace-apps");
    const help = cmd?.helpInformation() ?? "";

    expect(cmd).toBeDefined();
    expect(cmd?.description()).toBe("Manage marketplace apps");
    expect(cmd?.commands.map((candidate) => candidate.name())).toEqual(
      expect.arrayContaining(["list", "get", "install"]),
    );
    expect(help).toContain("Commands:");
    expect(help).toContain("list");
    expect(help).toContain("get");
    expect(help).toContain("install");
    expect(
      cmd?.commands
        .find((candidate) => candidate.name() === "install")
        ?.options.find((option) => option.long === "--version"),
    ).toBeDefined();
  });

  it("lists marketplace apps", async () => {
    const apps = [{ id: "app-1", name: "Inbox", version: "1.0.0" }];
    mockPost.mockResolvedValue({ data: { data: { findManyMarketplaceApps: apps } } });

    await program.parseAsync(["node", "test", "marketplace-apps", "-o", "json", "--full", "list"]);

    expect(mockPost).toHaveBeenCalledWith("/metadata", {
      query: expect.stringContaining("findManyMarketplaceApps"),
    });
    expect(JSON.parse(consoleSpy.mock.calls[0][0] as string)).toEqual(apps);
  });

  it("gets one marketplace app by universal identifier", async () => {
    const app = { id: "app-1", name: "Inbox", version: "1.0.0" };
    mockPost.mockResolvedValue({ data: { data: { findOneMarketplaceApp: app } } });

    await program.parseAsync([
      "node",
      "test",
      "marketplace-apps",
      "get",
      "com.example.inbox",
      "-o",
      "json",
      "--full",
    ]);

    expect(mockPost).toHaveBeenCalledWith("/metadata", {
      query: expect.stringContaining("findOneMarketplaceApp"),
      variables: { universalIdentifier: "com.example.inbox" },
    });
    expect(JSON.parse(consoleSpy.mock.calls[0][0] as string)).toEqual(app);
  });

  it("installs a marketplace app", async () => {
    mockPost.mockResolvedValue({ data: { data: { installMarketplaceApp: true } } });

    await program.parseAsync([
      "node",
      "test",
      "marketplace-apps",
      "install",
      "com.example.inbox",
      "--version",
      "1.2.0",
      "-o",
      "json",
      "--full",
    ]);

    expect(mockPost).toHaveBeenCalledWith("/metadata", {
      query: expect.stringContaining("installMarketplaceApp"),
      variables: {
        universalIdentifier: "com.example.inbox",
        version: "1.2.0",
      },
    });
    expect(JSON.parse(consoleSpy.mock.calls[0][0] as string)).toEqual({
      success: true,
      universalIdentifier: "com.example.inbox",
      version: "1.2.0",
    });
  });

  it("rejects get without a universal identifier", async () => {
    await expect(program.parseAsync(["node", "test", "marketplace-apps", "get"])).rejects.toThrow(
      CliError,
    );
  });

  it("rejects install without a universal identifier", async () => {
    await expect(
      program.parseAsync(["node", "test", "marketplace-apps", "install"]),
    ).rejects.toThrow(CliError);
  });
});
