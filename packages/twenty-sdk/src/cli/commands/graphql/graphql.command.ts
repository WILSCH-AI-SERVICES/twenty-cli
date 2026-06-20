import { Command } from "commander";

import { requireGraphqlField, type GraphQLResponse } from "../../utilities/api/graphql-response";
import { CliError } from "../../utilities/errors/cli-error";
import { createCommandContext } from "../../utilities/shared/context";
import { applyGlobalOptions } from "../../utilities/shared/global-options";
import { readJsonInput } from "../../utilities/shared/io";

type GraphqlOperationKind = "query" | "mutation";

interface GraphqlOperationOptions {
  kind?: string;
  args?: string;
  variableDefs?: string;
  variables?: string;
  variablesFile?: string;
  selection?: string;
  endpoint: string;
}

export function registerGraphqlCommand(program: Command): void {
  const cmd = program
    .command("graphql")
    .description("Execute a GraphQL operation by field name")
    .argument("<operation>", "GraphQL field name")
    .option("--kind <kind>", "GraphQL operation kind: query or mutation", "query")
    .option("--args <graphql>", "GraphQL field arguments, without surrounding parentheses")
    .option(
      "--variable-defs <graphql>",
      "GraphQL variable definitions, without surrounding parentheses",
    )
    .option("--variables <json>", "JSON variables")
    .option("--variables-file <path>", "JSON variables file (use - for stdin)")
    .option("--selection <graphql>", "GraphQL selection set, without surrounding braces")
    .option("--endpoint <path>", "GraphQL endpoint path", "graphql");
  applyGlobalOptions(cmd);

  cmd.action(async (operation: string, options: GraphqlOperationOptions, command: Command) => {
    const { globalOptions, services } = await createCommandContext(command);
    const kind = normalizeGraphqlOperationKind(options.kind);
    assertGraphqlName(operation, "GraphQL operation");
    const variables = await readVariables(options.variables, options.variablesFile);
    const query = buildGraphqlOperationDocument(operation, {
      kind,
      args: options.args,
      variableDefs: options.variableDefs,
      selection: options.selection,
    });
    const payload: Record<string, unknown> = { query };

    if (Object.keys(variables).length > 0) {
      payload.variables = variables;
    }

    const response = await services.api.post<GraphQLResponse<Record<string, unknown>>>(
      normalizeEndpoint(options.endpoint),
      payload,
    );
    const result = requireGraphqlField(
      response.data ?? {},
      operation,
      `Failed to execute GraphQL operation ${operation}.`,
    );

    await services.output.render(result, {
      format: globalOptions.output,
      query: globalOptions.query,
    });
  });
}

export function buildGraphqlOperationDocument(
  operation: string,
  options: {
    kind: GraphqlOperationKind;
    args?: string;
    variableDefs?: string;
    selection?: string;
  },
): string {
  const operationName = `Cli${operation.charAt(0).toUpperCase()}${operation.slice(1)}`;
  const variableDefs = normalizeParenthesized(options.variableDefs);
  const fieldArgs = normalizeParenthesized(options.args);
  const selection = normalizeSelection(options.selection);

  return `${options.kind} ${operationName}${variableDefs} { ${operation}${fieldArgs}${selection} }`;
}

async function readVariables(raw?: string, filePath?: string): Promise<Record<string, unknown>> {
  const payload = await readJsonInput(raw, filePath);
  if (payload === undefined) return {};
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    throw new CliError("GraphQL variables must be a JSON object.", "INVALID_ARGUMENTS");
  }
  return payload as Record<string, unknown>;
}

function normalizeGraphqlOperationKind(value?: string): GraphqlOperationKind {
  const normalized = (value ?? "query").toLowerCase();
  if (normalized === "query" || normalized === "mutation") return normalized;
  throw new CliError("GraphQL operation kind must be query or mutation.", "INVALID_ARGUMENTS");
}

function assertGraphqlName(value: string, label: string): void {
  if (!/^[_A-Za-z][_0-9A-Za-z]*$/.test(value)) {
    throw new CliError(`${label} name must be a valid GraphQL name.`, "INVALID_ARGUMENTS");
  }
}

function normalizeParenthesized(value?: string): string {
  const trimmed = value?.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("(") && trimmed.endsWith(")")) return trimmed;
  return `(${trimmed})`;
}

function normalizeSelection(value?: string): string {
  const trimmed = value?.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) return ` ${trimmed}`;
  return ` { ${trimmed} }`;
}

function normalizeEndpoint(endpoint: string): string {
  if (endpoint.startsWith("/")) return endpoint;
  return `/${endpoint}`;
}
