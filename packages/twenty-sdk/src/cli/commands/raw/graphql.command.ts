import { Command } from "commander";
import fs from "fs-extra";

import { CliError } from "../../utilities/errors/cli-error";
import { resolveOperationAlias } from "../../utilities/shared/command-aliases";
import {
  applyGlobalOptions,
  resolveGlobalOptions,
  type GlobalOptions,
} from "../../utilities/shared/global-options";
import { readFileOrStdin, readJsonInput } from "../../utilities/shared/io";
import { createServices } from "../../utilities/shared/services";

const GRAPHQL_OPERATIONS = ["query", "mutate", "schema"] as const;

export function registerGraphqlCommand(parent: Command): void {
  const cmd = parent
    .command("graphql")
    .description("Raw GraphQL API access")
    .argument("<operation>", "query, mutate, or schema")
    .option("-d, --document <query>", "GraphQL document string")
    .option("-f, --file <path>", "GraphQL document file")
    .option("--variables <json>", "JSON variables")
    .option("--variables-file <path>", "JSON variables file (use - for stdin)")
    .option("--operation-name <name>", "GraphQL operation name")
    .option("--endpoint <path>", "GraphQL endpoint path", "graphql")
    .option("--output-file <path>", "Output file (schema command)");

  applyGlobalOptions(cmd);

  cmd.action(async (operation: string, options: GraphqlOptions | Command, command?: Command) => {
    const resolvedCommand = command ?? (options instanceof Command ? options : cmd);
    const rawOptions = resolvedCommand.opts() as GraphqlOptions;
    const globalOptions = resolveGlobalOptions(resolvedCommand);
    const services = await createServices(globalOptions);

    const op = resolveOperationAlias(operation, GRAPHQL_OPERATIONS);
    if (op === "schema") {
      const payload = { query: introspectionQuery };
      const response = await services.api.post(normalizeEndpoint(rawOptions.endpoint), payload);
      await outputGraphqlResult(response.data, globalOptions, services, rawOptions.outputFile);
      return;
    }

    if (op !== "query" && op !== "mutate") {
      throw new CliError(
        `Unknown GraphQL operation ${JSON.stringify(operation)}.`,
        "INVALID_ARGUMENTS",
      );
    }

    const query = await readGraphqlQuery(rawOptions.document, rawOptions.file);
    const variables = await readVariables(rawOptions.variables, rawOptions.variablesFile);

    const payload: Record<string, unknown> = { query };
    if (Object.keys(variables).length > 0) {
      payload.variables = variables;
    }
    if (rawOptions.operationName) {
      payload.operationName = rawOptions.operationName;
    }

    const response = await services.api.post(normalizeEndpoint(rawOptions.endpoint), payload);
    await outputGraphqlResult(response.data, globalOptions, services, undefined);
  });
}

interface GraphqlOptions {
  document?: string;
  file?: string;
  variables?: string;
  variablesFile?: string;
  operationName?: string;
  endpoint: string;
  outputFile?: string;
}

async function readGraphqlQuery(document?: string, filePath?: string): Promise<string> {
  if (filePath) {
    const content = await readFileOrStdin(filePath);
    return normalizeGraphqlDocument(content);
  }
  if (!document) {
    throw new CliError("Missing GraphQL document; use --document or --file.", "INVALID_ARGUMENTS");
  }
  return normalizeGraphqlDocument(document);
}

async function readVariables(raw?: string, filePath?: string): Promise<Record<string, unknown>> {
  const payload = await readJsonInput(raw, filePath);
  if (payload === undefined) return {};
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    throw new CliError("GraphQL variables must be a JSON object.", "INVALID_ARGUMENTS");
  }
  return payload as Record<string, unknown>;
}

function normalizeGraphqlDocument(document: string): string {
  const normalized = document.trim();
  if (normalized === "") {
    throw new CliError("GraphQL document must not be empty.", "INVALID_ARGUMENTS");
  }
  return normalized;
}

function normalizeEndpoint(endpoint: string): string {
  if (endpoint.startsWith("/")) return endpoint;
  return `/${endpoint}`;
}

async function outputGraphqlResult(
  data: unknown,
  globalOptions: Pick<GlobalOptions, "output" | "query">,
  services: Awaited<ReturnType<typeof createServices>>,
  outputFile?: string,
): Promise<void> {
  if (outputFile) {
    const content = typeof data === "string" ? data : JSON.stringify(data, null, 2);
    await fs.writeFile(outputFile, content);
    // eslint-disable-next-line no-console
    console.error(`Wrote schema output to ${outputFile}`);
    return;
  }

  await services.output.render(data, {
    format: globalOptions.output,
    query: globalOptions.query,
  });
}

const introspectionQuery = `
query IntrospectionQuery {
  __schema {
    queryType { name }
    mutationType { name }
    subscriptionType { name }
    types {
      ...FullType
    }
    directives {
      name
      description
      locations
      args {
        ...InputValue
      }
    }
  }
}

fragment FullType on __Type {
  kind
  name
  description
  fields(includeDeprecated: true) {
    name
    description
    args {
      ...InputValue
    }
    type {
      ...TypeRef
    }
    isDeprecated
    deprecationReason
  }
  inputFields {
    ...InputValue
  }
  interfaces {
    ...TypeRef
  }
  enumValues(includeDeprecated: true) {
    name
    description
    isDeprecated
    deprecationReason
  }
  possibleTypes {
    ...TypeRef
  }
}

fragment InputValue on __InputValue {
  name
  description
  type { ...TypeRef }
  defaultValue
}

fragment TypeRef on __Type {
  kind
  name
  ofType {
    kind
    name
    ofType {
      kind
      name
      ofType {
        kind
        name
        ofType {
          kind
          name
        }
      }
    }
  }
}
`;
