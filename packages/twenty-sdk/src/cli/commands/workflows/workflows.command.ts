import { Command } from "commander";

import { requireGraphqlField, type GraphQLResponse } from "../../utilities/api/graphql-response";
import { PublicHttpService } from "../../utilities/api/services/public-http.service";
import { CliError } from "../../utilities/errors/cli-error";
import { createCommandContext } from "../../utilities/shared/context";
import { applyGlobalOptions, resolveGlobalOptions } from "../../utilities/shared/global-options";
import { readJsonInput } from "../../utilities/shared/io";
import { parseKeyValuePairs } from "../../utilities/shared/parse";
import { createServices } from "../../utilities/shared/services";

interface WorkflowWebhookOptions {
  workspaceId?: string;
  method?: string;
  data?: string;
  file?: string;
  param?: string[];
}

interface WorkflowRunOptions {
  workflowRunId?: string;
  data?: string;
  file?: string;
}

const CURRENT_WORKSPACE_QUERY = `query CurrentWorkspace {
  currentWorkspace {
    id
  }
}`;

const ACTIVATE_WORKFLOW_VERSION_MUTATION = `mutation ActivateWorkflowVersion($workflowVersionId: UUID!) {
  activateWorkflowVersion(workflowVersionId: $workflowVersionId)
}`;

const DEACTIVATE_WORKFLOW_VERSION_MUTATION = `mutation DeactivateWorkflowVersion($workflowVersionId: UUID!) {
  deactivateWorkflowVersion(workflowVersionId: $workflowVersionId)
}`;

const RUN_WORKFLOW_VERSION_MUTATION = `mutation RunWorkflowVersion($input: RunWorkflowVersionInput!) {
  runWorkflowVersion(input: $input) {
    workflowRunId
  }
}`;

const STOP_WORKFLOW_RUN_MUTATION = `mutation StopWorkflowRun($workflowRunId: UUID!) {
  stopWorkflowRun(workflowRunId: $workflowRunId) {
    id
    status
  }
}`;

export function registerWorkflowsCommand(program: Command): void {
  const workflowsCmd = program
    .command("workflows")
    .description("Invoke workflow triggers and manage workflow runs");

  const invokeWebhookCmd = workflowsCmd
    .command("invoke-webhook")
    .description("Invoke a public workflow webhook endpoint")
    .argument("<workflowId>", "Workflow ID")
    .option("--workspace-id <id>", "Workspace ID for the public webhook path")
    .option("--method <method>", "Webhook method: get or post", "post")
    .option("-d, --data <json>", "JSON payload for POST requests")
    .option("-f, --file <path>", "JSON payload file for POST requests")
    .option("--param <key=value>", "Query parameter", collect);

  applyGlobalOptions(invokeWebhookCmd);

  invokeWebhookCmd.action(
    async (workflowId: string, options: WorkflowWebhookOptions, command: Command) => {
      const { globalOptions, services } = await createCommandContext(command);
      const method = normalizeMethod(options.method);
      const workspaceId = await resolveWorkspaceId(options.workspaceId, services.publicHttp);
      const payload = await readPayload(method, options);
      const params = normalizeQueryParams(parseKeyValuePairs(options.param));

      const response = await services.publicHttp.request({
        authMode: "optional",
        method,
        path: `/webhooks/workflows/${workspaceId}/${workflowId}`,
        data: method === "post" ? payload : undefined,
        params: Object.keys(params).length > 0 ? params : undefined,
      });

      await services.output.render(response.data, {
        format: globalOptions.output,
        query: globalOptions.query,
      });
    },
  );

  const activateCmd = workflowsCmd
    .command("activate")
    .description("Activate a workflow version")
    .argument("<workflowVersionId>", "Workflow version ID");
  applyGlobalOptions(activateCmd);
  activateCmd.action(
    async (workflowVersionId: string, _options: Record<string, unknown>, command: Command) => {
      const globalOptions = resolveGlobalOptions(command);
      const services = await createServices(globalOptions);
      const response = await services.api.post<
        GraphQLResponse<{ activateWorkflowVersion?: boolean }>
      >("/graphql", {
        query: ACTIVATE_WORKFLOW_VERSION_MUTATION,
        variables: { workflowVersionId },
      });

      await services.output.render(
        {
          success: resolveWorkflowBooleanResult(response.data, "activateWorkflowVersion"),
          workflowVersionId,
        },
        {
          format: globalOptions.output,
          query: globalOptions.query,
        },
      );
    },
  );

  const deactivateCmd = workflowsCmd
    .command("deactivate")
    .description("Deactivate a workflow version")
    .argument("<workflowVersionId>", "Workflow version ID");
  applyGlobalOptions(deactivateCmd);
  deactivateCmd.action(
    async (workflowVersionId: string, _options: Record<string, unknown>, command: Command) => {
      const globalOptions = resolveGlobalOptions(command);
      const services = await createServices(globalOptions);
      const response = await services.api.post<
        GraphQLResponse<{ deactivateWorkflowVersion?: boolean }>
      >("/graphql", {
        query: DEACTIVATE_WORKFLOW_VERSION_MUTATION,
        variables: { workflowVersionId },
      });

      await services.output.render(
        {
          success: resolveWorkflowBooleanResult(response.data, "deactivateWorkflowVersion"),
          workflowVersionId,
        },
        {
          format: globalOptions.output,
          query: globalOptions.query,
        },
      );
    },
  );

  const runCmd = workflowsCmd
    .command("run")
    .description("Run a workflow version")
    .argument("<workflowVersionId>", "Workflow version ID")
    .option("--workflow-run-id <id>", "Existing workflow run ID to continue")
    .option("-d, --data <json>", "JSON workflow payload")
    .option("-f, --file <path>", "JSON workflow payload file");
  applyGlobalOptions(runCmd);
  runCmd.action(
    async (workflowVersionId: string, options: WorkflowRunOptions, command: Command) => {
      const globalOptions = resolveGlobalOptions(command);
      const services = await createServices(globalOptions);
      const payload = await readJsonInput(options.data, options.file);
      const input: Record<string, unknown> = { workflowVersionId };

      if (options.workflowRunId) {
        input.workflowRunId = options.workflowRunId;
      }
      if (payload !== undefined && payload !== null) {
        input.payload = payload;
      }

      const response = await services.api.post<GraphQLResponse<{ runWorkflowVersion?: unknown }>>(
        "/graphql",
        {
          query: RUN_WORKFLOW_VERSION_MUTATION,
          variables: { input },
        },
      );

      await services.output.render(
        resolveWorkflowObjectResult(response.data, "runWorkflowVersion"),
        {
          format: globalOptions.output,
          query: globalOptions.query,
        },
      );
    },
  );

  const stopRunCmd = workflowsCmd
    .command("stop-run")
    .description("Stop a workflow run")
    .argument("<workflowRunId>", "Workflow run ID");
  applyGlobalOptions(stopRunCmd);
  stopRunCmd.action(
    async (workflowRunId: string, _options: Record<string, unknown>, command: Command) => {
      const globalOptions = resolveGlobalOptions(command);
      const services = await createServices(globalOptions);
      const response = await services.api.post<GraphQLResponse<{ stopWorkflowRun?: unknown }>>(
        "/graphql",
        {
          query: STOP_WORKFLOW_RUN_MUTATION,
          variables: { workflowRunId },
        },
      );

      await services.output.render(resolveWorkflowObjectResult(response.data, "stopWorkflowRun"), {
        format: globalOptions.output,
        query: globalOptions.query,
      });
    },
  );
}

function normalizeQueryParams(params: Record<string, string[]>): Record<string, string | string[]> {
  return Object.fromEntries(
    Object.entries(params)
      .filter(([, values]) => values.length > 0)
      .map(([key, values]) => [key, values.length === 1 ? values[0]! : values]),
  );
}

function collect(value: string, previous: string[] = []): string[] {
  return previous.concat([value]);
}

function normalizeMethod(rawMethod: string | undefined): "get" | "post" {
  const method = rawMethod?.toLowerCase() ?? "post";

  if (method !== "get" && method !== "post") {
    throw new CliError(
      "Unsupported workflow webhook method. Use GET or POST.",
      "INVALID_ARGUMENTS",
    );
  }

  return method;
}

async function resolveWorkspaceId(
  explicitWorkspaceId: string | undefined,
  publicHttp: Pick<PublicHttpService, "request">,
): Promise<string> {
  if (explicitWorkspaceId) {
    return explicitWorkspaceId;
  }

  const response = await publicHttp.request<
    GraphQLResponse<{ currentWorkspace?: { id?: string } | null }>
  >({
    authMode: "required",
    method: "post",
    path: "/graphql",
    data: {
      query: CURRENT_WORKSPACE_QUERY,
    },
  });

  const currentWorkspace = requireGraphqlField(
    response.data ?? {},
    "currentWorkspace",
    "Failed to discover the current workspace ID. Provide --workspace-id explicitly.",
  );
  const workspaceId = currentWorkspace?.id;
  if (!workspaceId) {
    throw new CliError(
      "Failed to discover the current workspace ID. Provide --workspace-id explicitly.",
      "INVALID_ARGUMENTS",
    );
  }

  return workspaceId;
}

async function readPayload(
  method: "get" | "post",
  options: WorkflowWebhookOptions,
): Promise<Record<string, unknown>> {
  if (method === "get") {
    if (options.data || options.file) {
      throw new CliError(
        "GET workflow webhook invocations do not accept --data or --file. Use --param or POST instead.",
        "INVALID_ARGUMENTS",
      );
    }

    return {};
  }

  const payload = await readJsonInput(options.data, options.file);
  if (payload == null) {
    return {};
  }

  if (typeof payload !== "object" || Array.isArray(payload)) {
    throw new CliError("Workflow webhook payload must be a JSON object.", "INVALID_ARGUMENTS");
  }

  return payload as Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function resolveWorkflowBooleanResult<T extends string>(
  response: GraphQLResponse<Partial<Record<T, boolean | null>>> | undefined,
  key: T,
): boolean {
  const value = resolveWorkflowResult(response, key);

  if (typeof value !== "boolean") {
    throw new CliError(`Workflow control ${key} returned an unexpected response.`, "API_ERROR");
  }

  return value;
}

function resolveWorkflowObjectResult<T extends string>(
  response: GraphQLResponse<Partial<Record<T, unknown>>> | undefined,
  key: T,
): Record<string, unknown> {
  const value = resolveWorkflowResult(response, key);

  if (!isRecord(value)) {
    throw new CliError(`Workflow control ${key} returned an unexpected response.`, "API_ERROR");
  }

  return value;
}

function resolveWorkflowResult<T extends string>(
  response: GraphQLResponse<Partial<Record<T, unknown>>> | undefined,
  key: T,
): unknown {
  if (Array.isArray(response?.errors) && response.errors.length > 0) {
    if (response.errors.some((error) => error.message?.includes(`Cannot query field "${key}"`))) {
      throw new CliError(
        `Workflow controls are not available on this workspace because it does not expose ${key}.`,
        "API_ERROR",
      );
    }

    throw new CliError(
      response.errors
        .map((error) => error.message?.trim())
        .filter((message): message is string => Boolean(message))
        .join("\n") || "Workflow control request failed.",
      "API_ERROR",
    );
  }

  const data = response?.data;
  if (!isRecord(data) || !Object.prototype.hasOwnProperty.call(data, key)) {
    throw new CliError("Workflow control request returned an unexpected response.", "API_ERROR");
  }

  return data[key];
}
