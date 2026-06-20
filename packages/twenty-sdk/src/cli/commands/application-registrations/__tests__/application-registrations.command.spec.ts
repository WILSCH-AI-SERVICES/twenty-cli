import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { mockConstructor } from "../../../test-utils/mock-constructor";
import { ApiService } from "../../../utilities/api/services/api.service";
import { CliError } from "../../../utilities/errors/cli-error";
import { registerApplicationRegistrationsCommand } from "../application-registrations.command";

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

describe("application-registrations command", () => {
  let program: Command;
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let mockPost: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    program = new Command();
    program.exitOverride();
    registerApplicationRegistrationsCommand(program);
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

  it("registers the command with payload and transfer options", () => {
    const cmd = program.commands.find(
      (candidate) => candidate.name() === "application-registrations",
    );

    expect(cmd).toBeDefined();
    expect(cmd?.description()).toBe("Manage application registrations");
    expect(cmd?.options.find((option) => option.long === "--data")).toBeDefined();
    expect(cmd?.options.find((option) => option.long === "--file")).toBeDefined();
    expect(cmd?.options.find((option) => option.long === "--set")).toBeDefined();
    expect(
      cmd?.options.find((option) => option.long === "--target-workspace-subdomain"),
    ).toBeDefined();
  });

  it("lists application registrations", async () => {
    const registrations = [
      {
        id: "reg-1",
        name: "Widget App",
        universalIdentifier: "com.example.widget",
      },
    ];
    mockPost.mockResolvedValue({
      data: { data: { findManyApplicationRegistrations: registrations } },
    });

    await program.parseAsync([
      "node",
      "test",
      "application-registrations",
      "list",
      "-o",
      "json",
      "--full",
    ]);

    expect(mockPost).toHaveBeenCalledWith("/metadata", {
      query: expect.stringContaining("findManyApplicationRegistrations"),
    });
    expect(JSON.parse(consoleSpy.mock.calls[0][0] as string)).toEqual(registrations);
  });

  it("gets one application registration", async () => {
    const registration = { id: "reg-1", name: "Widget App" };
    mockPost.mockResolvedValue({
      data: { data: { findOneApplicationRegistration: registration } },
    });

    await program.parseAsync([
      "node",
      "test",
      "application-registrations",
      "get",
      "reg-1",
      "-o",
      "json",
      "--full",
    ]);

    expect(mockPost).toHaveBeenCalledWith("/metadata", {
      query: expect.stringContaining("findOneApplicationRegistration"),
      variables: { id: "reg-1" },
    });
    expect(JSON.parse(consoleSpy.mock.calls[0][0] as string)).toEqual(registration);
  });

  it("gets application registration stats", async () => {
    const stats = {
      activeInstalls: 3,
      mostInstalledVersion: "1.2.0",
      versionDistribution: [{ version: "1.2.0", count: 3 }],
    };
    mockPost.mockResolvedValue({ data: { data: { findApplicationRegistrationStats: stats } } });

    await program.parseAsync([
      "node",
      "test",
      "application-registrations",
      "stats",
      "reg-1",
      "-o",
      "json",
      "--full",
    ]);

    expect(mockPost).toHaveBeenCalledWith("/metadata", {
      query: expect.stringContaining("findApplicationRegistrationStats"),
      variables: { id: "reg-1" },
    });
    expect(JSON.parse(consoleSpy.mock.calls[0][0] as string)).toEqual(stats);
  });

  it("gets a signed tarball URL for an application registration", async () => {
    mockPost.mockResolvedValue({
      data: {
        data: {
          applicationRegistrationTarballUrl:
            "https://api.twenty.com/file/app-tarball/file-123?token=signed",
        },
      },
    });

    await program.parseAsync([
      "node",
      "test",
      "application-registrations",
      "tarball-url",
      "reg-1",
      "-o",
      "json",
      "--full",
    ]);

    expect(mockPost).toHaveBeenCalledWith("/metadata", {
      query: expect.stringContaining("applicationRegistrationTarballUrl"),
      variables: { id: "reg-1" },
    });
    expect(JSON.parse(consoleSpy.mock.calls[0][0] as string)).toEqual({
      id: "reg-1",
      url: "https://api.twenty.com/file/app-tarball/file-123?token=signed",
    });
  });

  it("lists application registration variables", async () => {
    const variables = [{ id: "var-1", key: "API_TOKEN", isSecret: true }];
    mockPost.mockResolvedValue({
      data: { data: { findApplicationRegistrationVariables: variables } },
    });

    await program.parseAsync([
      "node",
      "test",
      "application-registrations",
      "list-variables",
      "reg-1",
      "-o",
      "json",
      "--full",
    ]);

    expect(mockPost).toHaveBeenCalledWith("/metadata", {
      query: expect.stringContaining("findApplicationRegistrationVariables"),
      variables: { applicationRegistrationId: "reg-1" },
    });
    expect(JSON.parse(consoleSpy.mock.calls[0][0] as string)).toEqual(variables);
  });

  it("creates an application registration from JSON payload", async () => {
    mockPost.mockResolvedValue({
      data: {
        data: {
          createApplicationRegistration: {
            applicationRegistration: {
              id: "reg-1",
              name: "Widget App",
            },
            clientSecret: "secret-1",
          },
        },
      },
    });

    await program.parseAsync([
      "node",
      "test",
      "application-registrations",
      "create",
      "-d",
      '{"name":"Widget App","websiteUrl":"https://example.com"}',
      "-o",
      "json",
      "--full",
    ]);

    expect(mockPost).toHaveBeenCalledWith("/metadata", {
      query: expect.stringContaining("createApplicationRegistration"),
      variables: {
        input: {
          name: "Widget App",
          websiteUrl: "https://example.com",
        },
      },
    });
  });

  it("updates an application registration with wrapped update payload", async () => {
    mockPost.mockResolvedValue({
      data: {
        data: {
          updateApplicationRegistration: {
            id: "reg-1",
            name: "Updated Widget App",
          },
        },
      },
    });

    await program.parseAsync([
      "node",
      "test",
      "application-registrations",
      "update",
      "reg-1",
      "-d",
      '{"name":"Updated Widget App"}',
      "-o",
      "json",
      "--full",
    ]);

    expect(mockPost).toHaveBeenCalledWith("/metadata", {
      query: expect.stringContaining("updateApplicationRegistration"),
      variables: {
        input: {
          id: "reg-1",
          update: {
            name: "Updated Widget App",
          },
        },
      },
    });
  });

  it("deletes an application registration", async () => {
    mockPost.mockResolvedValue({ data: { data: { deleteApplicationRegistration: true } } });

    await program.parseAsync([
      "node",
      "test",
      "application-registrations",
      "delete",
      "reg-1",
      "-o",
      "json",
      "--full",
    ]);

    expect(mockPost).toHaveBeenCalledWith("/metadata", {
      query: expect.stringContaining("deleteApplicationRegistration"),
      variables: { id: "reg-1" },
    });
    expect(JSON.parse(consoleSpy.mock.calls[0][0] as string)).toEqual({
      success: true,
      id: "reg-1",
    });
  });

  it("creates an application registration variable", async () => {
    const variable = { id: "var-1", key: "API_TOKEN", isSecret: true };
    mockPost.mockResolvedValue({
      data: {
        data: {
          createApplicationRegistrationVariable: variable,
        },
      },
    });

    await program.parseAsync([
      "node",
      "test",
      "application-registrations",
      "create-variable",
      "-d",
      '{"applicationRegistrationId":"reg-1","key":"API_TOKEN","value":"secret"}',
      "-o",
      "json",
      "--full",
    ]);

    expect(mockPost).toHaveBeenCalledWith("/metadata", {
      query: expect.stringContaining("createApplicationRegistrationVariable"),
      variables: {
        input: {
          applicationRegistrationId: "reg-1",
          key: "API_TOKEN",
          value: "secret",
        },
      },
    });
    expect(JSON.parse(consoleSpy.mock.calls[0][0] as string)).toEqual(variable);
  });

  it("updates an application registration variable with wrapped update payload", async () => {
    const variable = { id: "var-1", key: "API_TOKEN", description: "Updated" };
    mockPost.mockResolvedValue({
      data: {
        data: {
          updateApplicationRegistrationVariable: variable,
        },
      },
    });

    await program.parseAsync([
      "node",
      "test",
      "application-registrations",
      "update-variable",
      "var-1",
      "-d",
      '{"description":"Updated"}',
      "-o",
      "json",
      "--full",
    ]);

    expect(mockPost).toHaveBeenCalledWith("/metadata", {
      query: expect.stringContaining("updateApplicationRegistrationVariable"),
      variables: {
        input: {
          id: "var-1",
          update: {
            description: "Updated",
          },
        },
      },
    });
    expect(JSON.parse(consoleSpy.mock.calls[0][0] as string)).toEqual(variable);
  });

  it("deletes an application registration variable", async () => {
    mockPost.mockResolvedValue({ data: { data: { deleteApplicationRegistrationVariable: true } } });

    await program.parseAsync([
      "node",
      "test",
      "application-registrations",
      "delete-variable",
      "var-1",
      "-o",
      "json",
      "--full",
    ]);

    expect(mockPost).toHaveBeenCalledWith("/metadata", {
      query: expect.stringContaining("deleteApplicationRegistrationVariable"),
      variables: { id: "var-1" },
    });
    expect(JSON.parse(consoleSpy.mock.calls[0][0] as string)).toEqual({
      success: true,
      id: "var-1",
    });
  });

  it("rotates an application registration client secret", async () => {
    mockPost.mockResolvedValue({
      data: {
        data: {
          rotateApplicationRegistrationClientSecret: {
            clientSecret: "secret-2",
          },
        },
      },
    });

    await program.parseAsync([
      "node",
      "test",
      "application-registrations",
      "rotate-secret",
      "reg-1",
      "-o",
      "json",
      "--full",
    ]);

    expect(mockPost).toHaveBeenCalledWith("/metadata", {
      query: expect.stringContaining("rotateApplicationRegistrationClientSecret"),
      variables: { id: "reg-1" },
    });
    expect(JSON.parse(consoleSpy.mock.calls[0][0] as string)).toEqual({
      id: "reg-1",
      clientSecret: "secret-2",
    });
  });

  it("transfers application registration ownership", async () => {
    const registration = { id: "reg-1", ownerWorkspaceId: "ws-2" };
    mockPost.mockResolvedValue({
      data: {
        data: {
          transferApplicationRegistrationOwnership: registration,
        },
      },
    });

    await program.parseAsync([
      "node",
      "test",
      "application-registrations",
      "transfer-ownership",
      "reg-1",
      "--target-workspace-subdomain",
      "other-workspace",
      "-o",
      "json",
      "--full",
    ]);

    expect(mockPost).toHaveBeenCalledWith("/metadata", {
      query: expect.stringContaining("transferApplicationRegistrationOwnership"),
      variables: {
        applicationRegistrationId: "reg-1",
        targetWorkspaceSubdomain: "other-workspace",
      },
    });
    expect(JSON.parse(consoleSpy.mock.calls[0][0] as string)).toEqual(registration);
  });

  it("rejects transfer-ownership without a target workspace subdomain", async () => {
    await expect(
      program.parseAsync([
        "node",
        "test",
        "application-registrations",
        "transfer-ownership",
        "reg-1",
      ]),
    ).rejects.toThrow(CliError);
  });

  it("rejects unknown operations", async () => {
    await expect(
      program.parseAsync(["node", "test", "application-registrations", "explode"]),
    ).rejects.toThrow(CliError);
  });
});
