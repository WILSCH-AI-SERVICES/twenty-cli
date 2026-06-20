import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { mockConstructor } from "../../../test-utils/mock-constructor";
import { ApiService } from "../../../utilities/api/services/api.service";
import { CliError } from "../../../utilities/errors/cli-error";
import { registerWorkflowsCommand } from "../workflows.command";

const mockLoadConfigFile = vi.fn();
const mockGetConfig = vi.fn();
const mockCreateCommandContext = vi.hoisted(() => vi.fn());
const mockPublicHttpRequest = vi.hoisted(() => vi.fn());
const mockOutputRender = vi.hoisted(() => vi.fn());

vi.mock("../../../utilities/api/services/api.service");
vi.mock("../../../utilities/config/services/config.service", () => ({
  ConfigService: vi.fn(function MockConfigService() {
    return {
      loadConfigFile: mockLoadConfigFile,
      getConfig: mockGetConfig,
    };
  }),
}));
vi.mock("../../../utilities/shared/context", async () => {
  const actual = await vi.importActual<typeof import("../../../utilities/shared/context")>(
    "../../../utilities/shared/context",
  );

  return {
    ...actual,
    createCommandContext: mockCreateCommandContext,
  };
});

const defaultConfigFile = {
  defaultWorkspace: "default",
  workspaces: {
    default: {
      apiUrl: "https://api.twenty.com",
      apiKey: "test-token",
    },
  },
};

const defaultResolvedConfig = {
  apiUrl: "https://api.twenty.com",
  apiKey: "test-token",
  workspace: "default",
};

function mockSharedCommandContext() {
  mockCreateCommandContext.mockReturnValue({
    globalOptions: {
      output: "json",
      query: undefined,
      debug: false,
      noRetry: false,
      workspace: "default",
    },
    services: {
      publicHttp: {
        request: mockPublicHttpRequest,
      },
      output: {
        render: mockOutputRender,
      },
    },
  } as never);
}

describe("workflows command", () => {
  let program: Command;
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let mockGraphqlPost: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    program = new Command();
    program.exitOverride();
    registerWorkflowsCommand(program);
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockGraphqlPost = vi.fn();
    vi.mocked(ApiService).mockImplementation(
      mockConstructor(
        () =>
          ({
            post: mockGraphqlPost,
            get: vi.fn(),
            put: vi.fn(),
            patch: vi.fn(),
            delete: vi.fn(),
            request: vi.fn(),
          }) as unknown as ApiService,
      ),
    );
    mockLoadConfigFile.mockResolvedValue(defaultConfigFile);
    mockGetConfig.mockResolvedValue(defaultResolvedConfig);
    mockCreateCommandContext.mockReset();
    mockPublicHttpRequest.mockReset();
    mockOutputRender.mockReset();
    mockSharedCommandContext();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    vi.clearAllMocks();
  });

  describe("command registration", () => {
    it("registers workflows root command", () => {
      const workflowsCmd = program.commands.find((candidate) => candidate.name() === "workflows");

      expect(workflowsCmd).toBeDefined();
      expect(workflowsCmd?.description()).toBe("Invoke workflow triggers and manage workflow runs");
    });

    it("registers invoke-webhook subcommand with required workflow id", () => {
      const workflowsCmd = program.commands.find((candidate) => candidate.name() === "workflows");
      const invokeCmd = workflowsCmd?.commands.find(
        (candidate) => candidate.name() === "invoke-webhook",
      );
      const args = invokeCmd?.registeredArguments ?? [];

      expect(invokeCmd).toBeDefined();
      expect(invokeCmd?.description()).toBe("Invoke a public workflow webhook endpoint");
      expect(args.length).toBe(1);
      expect(args[0].name()).toBe("workflowId");
      expect(args[0].required).toBe(true);
    });

    it("registers workflow invocation options and global options", () => {
      const workflowsCmd = program.commands.find((candidate) => candidate.name() === "workflows");
      const invokeCmd = workflowsCmd?.commands.find(
        (candidate) => candidate.name() === "invoke-webhook",
      );
      const options = invokeCmd?.options ?? [];

      expect(options.find((option) => option.long === "--workspace-id")).toBeDefined();
      expect(options.find((option) => option.long === "--method")).toBeDefined();
      expect(options.find((option) => option.long === "--data")).toBeDefined();
      expect(options.find((option) => option.long === "--file")).toBeDefined();
      expect(options.find((option) => option.long === "--param")).toBeDefined();
      expect(options.find((option) => option.long === "--output")).toBeDefined();
      expect(options.find((option) => option.long === "--query")).toBeDefined();
      expect(options.find((option) => option.long === "--workspace")).toBeDefined();
    });

    it("registers workflow control subcommands", () => {
      const workflowsCmd = program.commands.find((candidate) => candidate.name() === "workflows");
      const activateCmd = workflowsCmd?.commands.find(
        (candidate) => candidate.name() === "activate",
      );
      const deactivateCmd = workflowsCmd?.commands.find(
        (candidate) => candidate.name() === "deactivate",
      );
      const runCmd = workflowsCmd?.commands.find((candidate) => candidate.name() === "run");
      const stopRunCmd = workflowsCmd?.commands.find(
        (candidate) => candidate.name() === "stop-run",
      );

      expect(activateCmd?.description()).toBe("Activate a workflow version");
      expect(deactivateCmd?.description()).toBe("Deactivate a workflow version");
      expect(runCmd?.description()).toBe("Run a workflow version");
      expect(stopRunCmd?.description()).toBe("Stop a workflow run");
      expect(runCmd?.options.find((option) => option.long === "--workflow-run-id")).toBeDefined();
      expect(runCmd?.options.find((option) => option.long === "--data")).toBeDefined();
      expect(runCmd?.options.find((option) => option.long === "--file")).toBeDefined();
    });
  });

  describe("invoke-webhook", () => {
    it("invokes a workflow webhook through shared public transport with POST and explicit workspace id", async () => {
      mockPublicHttpRequest.mockResolvedValue({
        data: {
          success: true,
          workflowName: "Sync Contacts",
          workflowRunId: "run-1",
        },
      } as never);

      await program.parseAsync([
        "node",
        "test",
        "workflows",
        "invoke-webhook",
        "workflow-1",
        "--workspace-id",
        "workspace-1",
        "-d",
        '{"hello":"world"}',
        "-o",
        "json",
        "--full",
      ]);

      expect(mockCreateCommandContext).toHaveBeenCalled();
      expect(mockPublicHttpRequest).toHaveBeenCalledWith({
        authMode: "optional",
        method: "post",
        path: "/webhooks/workflows/workspace-1/workflow-1",
        data: { hello: "world" },
        params: undefined,
      });

      expect(mockOutputRender).toHaveBeenCalledWith(
        {
          success: true,
          workflowName: "Sync Contacts",
          workflowRunId: "run-1",
        },
        {
          format: "json",
          query: undefined,
        },
      );
    });

    it("passes debug and no-retry through shared transport context", async () => {
      mockPublicHttpRequest.mockResolvedValue({
        data: {
          success: true,
        },
      } as never);

      await program.parseAsync([
        "node",
        "test",
        "workflows",
        "invoke-webhook",
        "workflow-1",
        "--workspace-id",
        "workspace-1",
        "--debug",
        "--no-retry",
        "-o",
        "json",
        "--full",
      ]);

      expect(mockCreateCommandContext).toHaveBeenCalledTimes(1);
      expect(mockCreateCommandContext.mock.calls[0][0].opts()).toMatchObject({
        debug: true,
        retry: false,
      });
    });

    it("invokes a workflow webhook with GET and query params through shared transport", async () => {
      mockPublicHttpRequest.mockResolvedValue({
        data: {
          success: true,
          workflowName: "Webhook Workflow",
          workflowRunId: "run-2",
        },
      } as never);

      await program.parseAsync([
        "node",
        "test",
        "workflows",
        "invoke-webhook",
        "workflow-2",
        "--workspace-id",
        "workspace-2",
        "--method",
        "get",
        "--param",
        "source=cli",
        "--param",
        "dryRun=true",
        "-o",
        "json",
        "--full",
      ]);

      expect(mockPublicHttpRequest).toHaveBeenCalledWith({
        authMode: "optional",
        method: "get",
        path: "/webhooks/workflows/workspace-2/workflow-2",
        data: undefined,
        params: {
          source: "cli",
          dryRun: "true",
        },
      });
    });

    it("discovers the current workspace id with required auth when omitted", async () => {
      mockPublicHttpRequest
        .mockResolvedValueOnce({
          data: {
            data: {
              currentWorkspace: {
                id: "workspace-lookup",
              },
            },
          },
        } as never)
        .mockResolvedValueOnce({
          data: {
            success: true,
            workflowName: "Lookup Workflow",
            workflowRunId: "run-3",
          },
        } as never);

      await program.parseAsync([
        "node",
        "test",
        "workflows",
        "invoke-webhook",
        "workflow-3",
        "-o",
        "json",
        "--full",
      ]);

      expect(mockPublicHttpRequest).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          authMode: "required",
          method: "post",
          path: "/graphql",
          data: {
            query: expect.stringContaining("currentWorkspace"),
          },
        }),
      );
      expect(mockPublicHttpRequest).toHaveBeenNthCalledWith(2, {
        authMode: "optional",
        method: "post",
        path: "/webhooks/workflows/workspace-lookup/workflow-3",
        data: {},
        params: undefined,
      });
    });

    it("throws when GET is used with a request body", async () => {
      await expect(
        program.parseAsync([
          "node",
          "test",
          "workflows",
          "invoke-webhook",
          "workflow-1",
          "--workspace-id",
          "workspace-1",
          "--method",
          "get",
          "-d",
          '{"hello":"world"}',
        ]),
      ).rejects.toThrow(CliError);
    });

    it("throws when workspace discovery is needed but no token is configured", async () => {
      mockPublicHttpRequest.mockRejectedValueOnce(
        new CliError(
          "Missing API token.",
          "AUTH",
          "Set TWENTY_API_TOKEN or configure an API key for the selected workspace.",
        ),
      );

      await expect(
        program.parseAsync(["node", "test", "workflows", "invoke-webhook", "workflow-1"]),
      ).rejects.toThrow(CliError);

      expect(mockPublicHttpRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          authMode: "required",
        }),
      );
    });

    it("throws for unsupported methods", async () => {
      await expect(
        program.parseAsync([
          "node",
          "test",
          "workflows",
          "invoke-webhook",
          "workflow-1",
          "--workspace-id",
          "workspace-1",
          "--method",
          "patch",
        ]),
      ).rejects.toThrow(CliError);
    });
  });

  describe("workflow controls", () => {
    it("activates a workflow version", async () => {
      mockGraphqlPost.mockResolvedValue({
        data: {
          data: {
            activateWorkflowVersion: true,
          },
        },
      });

      await program.parseAsync([
        "node",
        "test",
        "workflows",
        "activate",
        "workflow-version-1",
        "-o",
        "json",
        "--full",
      ]);

      expect(mockGraphqlPost).toHaveBeenCalledWith("/graphql", {
        query: expect.stringContaining("activateWorkflowVersion"),
        variables: {
          workflowVersionId: "workflow-version-1",
        },
      });
      expect(JSON.parse(consoleSpy.mock.calls[0][0] as string)).toEqual({
        success: true,
        workflowVersionId: "workflow-version-1",
      });
    });

    it("deactivates a workflow version", async () => {
      mockGraphqlPost.mockResolvedValue({
        data: {
          data: {
            deactivateWorkflowVersion: true,
          },
        },
      });

      await program.parseAsync([
        "node",
        "test",
        "workflows",
        "deactivate",
        "workflow-version-2",
        "-o",
        "json",
        "--full",
      ]);

      expect(mockGraphqlPost).toHaveBeenCalledWith("/graphql", {
        query: expect.stringContaining("deactivateWorkflowVersion"),
        variables: {
          workflowVersionId: "workflow-version-2",
        },
      });
      expect(JSON.parse(consoleSpy.mock.calls[0][0] as string)).toEqual({
        success: true,
        workflowVersionId: "workflow-version-2",
      });
    });

    it("runs a workflow version with optional payload and workflow run id", async () => {
      mockGraphqlPost.mockResolvedValue({
        data: {
          data: {
            runWorkflowVersion: {
              workflowRunId: "run-123",
            },
          },
        },
      });

      await program.parseAsync([
        "node",
        "test",
        "workflows",
        "run",
        "workflow-version-3",
        "--workflow-run-id",
        "run-existing",
        "-d",
        '{"source":"cli"}',
        "-o",
        "json",
        "--full",
      ]);

      expect(mockGraphqlPost).toHaveBeenCalledWith("/graphql", {
        query: expect.stringContaining("runWorkflowVersion"),
        variables: {
          input: {
            workflowVersionId: "workflow-version-3",
            workflowRunId: "run-existing",
            payload: {
              source: "cli",
            },
          },
        },
      });
      expect(JSON.parse(consoleSpy.mock.calls[0][0] as string)).toEqual({
        workflowRunId: "run-123",
      });
    });

    it("stops a workflow run", async () => {
      mockGraphqlPost.mockResolvedValue({
        data: {
          data: {
            stopWorkflowRun: {
              id: "run-456",
              status: "FAILED",
            },
          },
        },
      });

      await program.parseAsync([
        "node",
        "test",
        "workflows",
        "stop-run",
        "run-456",
        "-o",
        "json",
        "--full",
      ]);

      expect(mockGraphqlPost).toHaveBeenCalledWith("/graphql", {
        query: expect.stringContaining("stopWorkflowRun"),
        variables: {
          workflowRunId: "run-456",
        },
      });
      expect(JSON.parse(consoleSpy.mock.calls[0][0] as string)).toEqual({
        id: "run-456",
        status: "FAILED",
      });
    });
  });
});
