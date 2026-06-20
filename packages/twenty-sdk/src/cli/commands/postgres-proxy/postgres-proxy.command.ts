import { Command } from "commander";

import { type GraphQLResponse } from "../../utilities/api/graphql-response";
import { CliError } from "../../utilities/errors/cli-error";
import { createCommandContext } from "../../utilities/shared/context";
import { applyGlobalOptions } from "../../utilities/shared/global-options";

interface PostgresProxyOptions {
  showPassword?: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const POSTGRES_CREDENTIAL_FIELDS = `
  id
  user
  password
  workspaceId
`;

const GET_POSTGRES_CREDENTIALS_QUERY = `query GetPostgresCredentials {
  getPostgresCredentials {
    ${POSTGRES_CREDENTIAL_FIELDS}
  }
}`;

const ENABLE_POSTGRES_PROXY_MUTATION = `mutation EnablePostgresProxy {
  enablePostgresProxy {
    ${POSTGRES_CREDENTIAL_FIELDS}
  }
}`;

const DISABLE_POSTGRES_PROXY_MUTATION = `mutation DisablePostgresProxy {
  disablePostgresProxy {
    ${POSTGRES_CREDENTIAL_FIELDS}
  }
}`;

export function registerPostgresProxyCommand(program: Command): void {
  const endpoint = "/graphql";
  const cmd = program.command("postgres-proxy").description("Manage Postgres proxy credentials");
  applyGlobalOptions(cmd);

  const getCmd = cmd
    .command("get")
    .description("Get Postgres proxy credentials")
    .option("--show-password", "Show the Postgres proxy password");
  applyGlobalOptions(getCmd);
  getCmd.action(async (options: PostgresProxyOptions, command: Command) => {
    const { globalOptions, services } = await createCommandContext(command);
    const response = await services.api.post<GraphQLResponse<{ getPostgresCredentials?: unknown }>>(
      endpoint,
      {
        query: GET_POSTGRES_CREDENTIALS_QUERY,
      },
    );

    await services.output.render(
      sanitizeCredentials(resolvePostgresResult(response.data, "getPostgresCredentials"), options),
      {
        format: globalOptions.output,
        query: globalOptions.query,
      },
    );
  });

  const enableCmd = cmd.command("enable").description("Enable the Postgres proxy");
  applyGlobalOptions(enableCmd);
  enableCmd.action(async (_options: unknown, command: Command) => {
    const { globalOptions, services } = await createCommandContext(command);
    const response = await services.api.post<GraphQLResponse<{ enablePostgresProxy?: unknown }>>(
      endpoint,
      {
        query: ENABLE_POSTGRES_PROXY_MUTATION,
      },
    );

    await services.output.render(
      sanitizeCredentials(resolvePostgresResult(response.data, "enablePostgresProxy"), {}),
      {
        format: globalOptions.output,
        query: globalOptions.query,
      },
    );
  });

  const disableCmd = cmd.command("disable").description("Disable the Postgres proxy");
  applyGlobalOptions(disableCmd);
  disableCmd.action(async (_options: unknown, command: Command) => {
    const { globalOptions, services } = await createCommandContext(command);
    const response = await services.api.post<GraphQLResponse<{ disablePostgresProxy?: unknown }>>(
      endpoint,
      {
        query: DISABLE_POSTGRES_PROXY_MUTATION,
      },
    );

    await services.output.render(
      sanitizeCredentials(resolvePostgresResult(response.data, "disablePostgresProxy"), {}),
      {
        format: globalOptions.output,
        query: globalOptions.query,
      },
    );
  });
}

function sanitizeCredentials(value: unknown, options: PostgresProxyOptions): unknown {
  if (options.showPassword || value == null || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }

  const record = { ...(value as Record<string, unknown>) };
  if ("password" in record) {
    record.password = maskSecret(record.password);
  }

  return record;
}

function resolvePostgresResult<T>(
  response: GraphQLResponse<Record<string, T | null>> | undefined,
  key: string,
): T | null {
  if (Array.isArray(response?.errors) && response.errors.length > 0) {
    if (response.errors.some((error) => error.message?.includes(key))) {
      throw new CliError(
        `Postgres proxy is not available on this workspace because it does not expose ${key}.`,
        "API_ERROR",
      );
    }

    throw new CliError(
      response.errors
        .map((error) => error.message?.trim())
        .filter((message): message is string => Boolean(message))
        .join("\n") || "Postgres proxy request failed.",
      "API_ERROR",
    );
  }

  const data = response?.data;
  if (!isRecord(data) || !Object.prototype.hasOwnProperty.call(data, key)) {
    throw new CliError("Postgres proxy request returned an unexpected response.", "API_ERROR");
  }

  return (data as Record<string, T | null>)[key] ?? null;
}

function maskSecret(value: unknown): unknown {
  if (value == null || value === "") {
    return value;
  }

  return "[hidden]";
}
