import { Command } from "commander";

import {
  formatGraphqlErrors,
  getGraphqlField,
  hasGraphqlField,
  hasSchemaErrorSymbol,
} from "../../utilities/api/graphql-response";
import { MetadataSubscriptionService } from "../../utilities/api/services/metadata-subscription.service";
import { CliError } from "../../utilities/errors/cli-error";
import { parseBody } from "../../utilities/shared/body";
import { createCommandContext } from "../../utilities/shared/context";
import { readFileOrStdin, readJsonInput } from "../../utilities/shared/io";
import {
  CompatibleOperation,
  OperationRequest,
  ServerlessGraphQLResponse,
  ServerlessOperationContext,
  ServerlessOptions,
} from "./serverless.types";

const endpoint = "/metadata";

export const SERVERLESS_FUNCTION_FIELDS = `
  id
  name
  description
  runtime
  timeoutSeconds
  latestVersion
  publishedVersions
  handlerPath
  handlerName
  toolInputSchema
  isTool
  applicationId
  createdAt
  updatedAt
  cronTriggers {
    id
    settings
    createdAt
    updatedAt
  }
  databaseEventTriggers {
    id
    settings
    createdAt
    updatedAt
  }
  routeTriggers {
    id
    path
    isAuthRequired
    httpMethod
    createdAt
    updatedAt
  }
`;

export const LEGACY_LOGIC_FUNCTION_FIELDS = `
  id
  name
  description
  runtime
  timeoutSeconds
  sourceHandlerPath
  handlerName
  toolInputSchema
  isTool
  cronTriggerSettings
  databaseEventTriggerSettings
  httpRouteTriggerSettings
  applicationId
  universalIdentifier
  createdAt
  updatedAt
`;

export function collect(value: string, previous: string[] = []): string[] {
  return previous.concat([value]);
}

export async function createServerlessOperationContext(
  command: Command,
): Promise<ServerlessOperationContext> {
  const { globalOptions, services } = await createCommandContext(command);

  return {
    globalOptions,
    services,
    options: command.opts() as ServerlessOptions,
  };
}

export function renderServerlessFunction(
  value: unknown,
  context: Pick<ServerlessOperationContext, "globalOptions" | "services">,
): Promise<void> {
  return context.services.output.render(value, {
    format: context.globalOptions.output,
    query: context.globalOptions.query,
  });
}

export async function executeCompatibleOperation<T>(
  services: ServerlessOperationContext["services"],
  operation: CompatibleOperation,
): Promise<T> {
  const currentResponse = await postMetadataOperation<T>(services, operation.current);

  if (hasGraphqlField(currentResponse, operation.current.resultKey)) {
    return getGraphqlField(currentResponse, operation.current.resultKey) as T;
  }

  if (operation.legacy) {
    if (
      shouldFallbackToLegacy(currentResponse, operation.current) ||
      !formatGraphqlErrors(currentResponse)
    ) {
      const legacyResponse = await postMetadataOperation<T>(services, operation.legacy);

      if (hasGraphqlField(legacyResponse, operation.legacy.resultKey)) {
        return getGraphqlField(legacyResponse, operation.legacy.resultKey) as T;
      }

      throwGraphqlError(
        legacyResponse,
        `Unexpected GraphQL response missing ${operation.legacy.resultKey}.`,
      );
    }
  }

  if (
    operation.unavailableOnLegacyMessage &&
    shouldFallbackToLegacy(currentResponse, operation.current)
  ) {
    throw new CliError(operation.unavailableOnLegacyMessage, "INVALID_ARGUMENTS");
  }

  throwGraphqlError(
    currentResponse,
    `Unexpected GraphQL response missing ${operation.current.resultKey}.`,
  );
}

export async function buildCreateInput(
  options: ServerlessOptions,
  mode: "current" | "legacy",
): Promise<Record<string, unknown>> {
  const payload = hasPayloadInput(options)
    ? await parseBody(options.data, options.file, options.set)
    : {};
  const input = { ...payload, ...buildOptionInput(options) };

  if (typeof input.name !== "string" || input.name.trim() === "") {
    throw new CliError(
      "Missing serverless function name. Provide --name or include `name` in --data/--file.",
      "INVALID_ARGUMENTS",
    );
  }

  return mode === "current" ? normalizeCurrentServerlessInput(input) : input;
}

export async function buildUpdateInput(
  id: string,
  options: ServerlessOptions,
  mode: "current" | "legacy",
): Promise<Record<string, unknown>> {
  const payload = hasPayloadInput(options)
    ? await parseBody(options.data, options.file, options.set)
    : {};
  const update = { ...payload, ...buildOptionInput(options) };

  if (Object.keys(update).length === 0) {
    throw new CliError(
      "Provide at least one field to update via --name, --description, --timeout-seconds, --data, --file, or --set.",
      "INVALID_ARGUMENTS",
    );
  }

  return { id, update: mode === "current" ? normalizeCurrentServerlessInput(update) : update };
}

export async function buildExecutePayload(
  options: ServerlessOptions,
): Promise<Record<string, unknown>> {
  if (!hasPayloadInput(options)) {
    return {};
  }

  return parseBody(options.data, options.file, options.set);
}

export async function buildCreateLayerInput(
  options: ServerlessOptions,
): Promise<{ packageJson: Record<string, unknown>; yarnLock: string }> {
  const packageJson = await readJsonInput(options.packageJson, options.packageJsonFile);

  if (packageJson == null) {
    throw new CliError(
      "Missing package.json input; provide --package-json or --package-json-file.",
      "INVALID_ARGUMENTS",
    );
  }

  if (typeof packageJson !== "object" || Array.isArray(packageJson)) {
    throw new CliError("package.json input must be a JSON object.", "INVALID_ARGUMENTS");
  }

  const yarnLock = await readLayerTextInput(options.yarnLock, options.yarnLockFile);
  if (!yarnLock) {
    throw new CliError(
      "Missing yarn.lock input; provide --yarn-lock or --yarn-lock-file.",
      "INVALID_ARGUMENTS",
    );
  }

  return {
    packageJson: packageJson as Record<string, unknown>,
    yarnLock,
  };
}

export async function streamLogicFunctionLogs(
  id: string | undefined,
  options: ServerlessOptions,
  context: Pick<ServerlessOperationContext, "globalOptions" | "services">,
): Promise<void> {
  const maxEvents =
    typeof options.maxEvents === "number" && Number.isFinite(options.maxEvents)
      ? options.maxEvents
      : undefined;
  const waitSeconds =
    typeof options.waitSeconds === "number" && Number.isFinite(options.waitSeconds)
      ? options.waitSeconds
      : undefined;
  const format = context.globalOptions.output ?? "text";

  if (shouldCollectStreamOutput(format) && maxEvents === undefined && waitSeconds === undefined) {
    throw new CliError(
      "Streaming JSON output requires --max-events or --wait-seconds so the command can terminate with a complete array.",
      "INVALID_ARGUMENTS",
    );
  }

  const subscription = new MetadataSubscriptionService(undefined, {
    workspace: context.globalOptions.workspace,
    debug: context.globalOptions.debug,
  });
  const controller = new AbortController();
  const collected: unknown[] = [];
  let stopRequested = false;
  let seen = 0;
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

  if (waitSeconds !== undefined && waitSeconds > 0) {
    timeoutHandle = setTimeout(() => {
      stopRequested = true;
      controller.abort();
    }, waitSeconds * 1000);
  }

  try {
    for await (const payload of subscription.subscribe<{ logicFunctionLogs?: unknown }>({
      query: `subscription LogicFunctionLogs($input: LogicFunctionLogsInput!) {
        logicFunctionLogs(input: $input) {
          logs
        }
      }`,
      variables: {
        input: buildLogsInput(id, options),
      },
      signal: controller.signal,
    })) {
      const event =
        typeof payload === "object" && payload !== null && "logicFunctionLogs" in payload
          ? (payload as { logicFunctionLogs?: unknown }).logicFunctionLogs
          : payload;

      if (shouldCollectStreamOutput(format)) {
        collected.push(event);
      } else {
        await renderServerlessFunction(event, context);
      }

      seen += 1;
      if (maxEvents !== undefined && seen >= maxEvents) {
        stopRequested = true;
        controller.abort();
        break;
      }
    }
  } catch (error) {
    if (!stopRequested || !isAbortError(error)) {
      throw error;
    }
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }

  if (shouldCollectStreamOutput(format)) {
    await renderServerlessFunction(collected, context);
  }
}

function hasPayloadInput(options: ServerlessOptions): boolean {
  return Boolean(options.data || options.file || options.set?.length);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwnKey(value: unknown, key: string): boolean {
  return isRecord(value) && Object.prototype.hasOwnProperty.call(value, key);
}

function shouldFallbackToLegacy(
  response: ServerlessGraphQLResponse<unknown>,
  current: OperationRequest,
): boolean {
  const symbols = [current.resultKey, ...(current.schemaSymbols ?? [])];
  return hasSchemaErrorSymbol(response, symbols);
}

function throwGraphqlError(
  response: ServerlessGraphQLResponse<unknown>,
  fallbackMessage: string,
  code = "API_ERROR",
): never {
  throw new CliError(formatGraphqlErrors(response) ?? fallbackMessage, code);
}

function buildOptionInput(options: ServerlessOptions): Record<string, unknown> {
  const input: Record<string, unknown> = {};

  if (options.name !== undefined) {
    input.name = options.name;
  }

  if (options.description !== undefined) {
    input.description = options.description;
  }

  if (options.timeoutSeconds !== undefined) {
    input.timeoutSeconds = options.timeoutSeconds;
  }

  return input;
}

function normalizeCurrentServerlessInput(input: Record<string, unknown>): Record<string, unknown> {
  const normalized: Record<string, unknown> = { ...input };

  if (
    typeof normalized.sourceHandlerPath === "string" &&
    typeof normalized.handlerPath !== "string"
  ) {
    normalized.handlerPath = normalized.sourceHandlerPath;
  }

  const source = normalized.source;

  if (isRecord(source)) {
    const handlerPath =
      (typeof normalized.handlerPath === "string" && normalized.handlerPath) ||
      (typeof source.handlerPath === "string" && source.handlerPath) ||
      (typeof source.sourceHandlerPath === "string" && source.sourceHandlerPath) ||
      "src/index.ts";

    if (!hasOwnKey(normalized, "code")) {
      if (isRecord(source.code)) {
        normalized.code = source.code;
      } else if (typeof source.sourceHandlerCode === "string") {
        normalized.code = {
          [handlerPath]: source.sourceHandlerCode,
        };
      }
    }

    if (typeof normalized.handlerPath !== "string") {
      normalized.handlerPath = handlerPath;
    }

    if (typeof normalized.handlerName !== "string" && typeof source.handlerName === "string") {
      normalized.handlerName = source.handlerName;
    }

    if (!hasOwnKey(normalized, "toolInputSchema") && hasOwnKey(source, "toolInputSchema")) {
      normalized.toolInputSchema = source.toolInputSchema;
    }

    delete normalized.source;
  }

  delete normalized.sourceHandlerPath;

  return normalized;
}

async function readLayerTextInput(
  inlineValue: string | undefined,
  filePath: string | undefined,
): Promise<string | undefined> {
  if (inlineValue && inlineValue.trim() !== "") {
    return inlineValue;
  }

  if (filePath && filePath.trim() !== "") {
    const content = await readFileOrStdin(filePath.trim());
    return content.trim() === "" ? undefined : content;
  }

  return undefined;
}

function buildLogsInput(
  id: string | undefined,
  options: ServerlessOptions,
): Record<string, unknown> {
  const input: Record<string, unknown> = {};

  if (id) {
    input.id = id;
  }
  if (options.name) {
    input.name = options.name;
  }
  if (options.universalIdentifier) {
    input.universalIdentifier = options.universalIdentifier;
  }
  if (options.applicationId) {
    input.applicationId = options.applicationId;
  }
  if (options.applicationUniversalIdentifier) {
    input.applicationUniversalIdentifier = options.applicationUniversalIdentifier;
  }

  if (Object.keys(input).length === 0) {
    throw new CliError(
      "Serverless logs require at least one filter: function ID, --name, --universal-identifier, --application-id, or --application-universal-identifier.",
      "INVALID_ARGUMENTS",
    );
  }

  return input;
}

function shouldCollectStreamOutput(format: string | undefined): boolean {
  return format === "json";
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

async function postMetadataOperation<T>(
  services: ServerlessOperationContext["services"],
  request: OperationRequest,
): Promise<ServerlessGraphQLResponse<T>> {
  const payload: Record<string, unknown> = {
    query: request.query,
  };

  if (request.variables) {
    payload.variables = request.variables;
  }

  const response = await services.api.post<ServerlessGraphQLResponse<T>>(endpoint, payload);

  return response.data ?? {};
}
