import { Command } from "commander";

import { requireGraphqlField, type GraphQLResponse } from "../../utilities/api/graphql-response";
import { CliError } from "../../utilities/errors/cli-error";
import { parseBody } from "../../utilities/shared/body";
import { resolveOperationAlias } from "../../utilities/shared/command-aliases";
import { createCommandContext } from "../../utilities/shared/context";
import { applyGlobalOptions } from "../../utilities/shared/global-options";

const CONNECTED_ACCOUNT_OPERATIONS = [
  "list",
  "get",
  "sync",
  "get-imap-smtp-caldav",
  "save-imap-smtp-caldav",
] as const;

interface ConnectedAccountsOptions {
  limit?: string;
  cursor?: string;
  showSecrets?: boolean;
  data?: string;
  file?: string;
  set?: string[];
  accountOwnerId?: string;
  handle?: string;
}

const IMAP_SMTP_CALDAV_CONNECTION_FIELDS = `
  id
  handle
  provider
  accountOwnerId
  connectionParameters {
    IMAP {
      host
      port
      username
      password
      secure
    }
    SMTP {
      host
      port
      username
      password
      secure
    }
    CALDAV {
      host
      port
      username
      password
      secure
    }
  }
`;

const GET_CONNECTED_IMAP_SMTP_CALDAV_ACCOUNT_QUERY = `query GetConnectedImapSmtpCaldavAccount($id: UUID!) {
  getConnectedImapSmtpCaldavAccount(id: $id) {
    ${IMAP_SMTP_CALDAV_CONNECTION_FIELDS}
  }
}`;

const SAVE_IMAP_SMTP_CALDAV_ACCOUNT_MUTATION = `mutation SaveImapSmtpCaldavAccount($accountOwnerId: UUID!, $handle: String!, $connectionParameters: EmailAccountConnectionParameters!, $id: UUID) {
  saveImapSmtpCaldavAccount(
    accountOwnerId: $accountOwnerId
    handle: $handle
    connectionParameters: $connectionParameters
    id: $id
  ) {
    success
    connectedAccountId
  }
}`;

function collect(value: string, previous: string[] = []): string[] {
  return previous.concat([value]);
}

export function registerConnectedAccountsCommand(program: Command): void {
  const cmd = program
    .command("connected-accounts")
    .description("Inspect connected accounts and trigger channel sync")
    .argument("<operation>", "list, get, sync, get-imap-smtp-caldav, save-imap-smtp-caldav")
    .argument("[id]", "Connected account ID")
    .option("--limit <number>", "Maximum connected accounts to list")
    .option("--cursor <cursor>", "Pagination cursor")
    .option("--show-secrets", "Show sensitive credential fields")
    .option("-d, --data <json>", "JSON payload for manual connection parameters")
    .option("-f, --file <path>", "JSON payload file for manual connection parameters")
    .option("--set <key=value>", "Set a nested connection parameter value", collect)
    .option("--account-owner-id <id>", "Workspace member ID that owns the connected account")
    .option("--handle <value>", "Connected account handle, typically an email address");

  applyGlobalOptions(cmd);

  cmd.action(
    async (
      operation: string,
      id: string | undefined,
      options: ConnectedAccountsOptions,
      command: Command,
    ) => {
      const { globalOptions, services } = await createCommandContext(command);
      const op = resolveOperationAlias(operation, CONNECTED_ACCOUNT_OPERATIONS);

      switch (op) {
        case "list": {
          const response = await services.records.list("connectedAccounts", {
            limit: options.limit ? Number.parseInt(options.limit, 10) : undefined,
            cursor: options.cursor,
          });
          await services.output.render(
            response.data.map((row: unknown) => sanitizeConnectedAccount(row, options)),
            {
              format: globalOptions.output,
              query: globalOptions.query,
            },
          );
          break;
        }
        case "get": {
          if (!id) throw new CliError("Missing connected account ID.", "INVALID_ARGUMENTS");
          const response = await services.records.get("connectedAccounts", id);
          await services.output.render(sanitizeConnectedAccount(response, options), {
            format: globalOptions.output,
            query: globalOptions.query,
          });
          break;
        }
        case "sync": {
          if (!id) throw new CliError("Missing connected account ID.", "INVALID_ARGUMENTS");
          const response = await services.api.post<
            GraphQLResponse<{ startChannelSync?: { success?: boolean } | null }>
          >("/graphql", {
            query: `mutation($connectedAccountId: UUID!) {
              startChannelSync(connectedAccountId: $connectedAccountId) {
                success
              }
            }`,
            variables: { connectedAccountId: id },
          });
          const syncResult = requireGraphqlField(
            response.data ?? {},
            "startChannelSync",
            `Failed to start channel sync for connected account ${id}.`,
          );

          await services.output.render(
            {
              success: syncResult?.success ?? false,
              connectedAccountId: id,
            },
            {
              format: globalOptions.output,
              query: globalOptions.query,
            },
          );
          break;
        }
        case "get-imap-smtp-caldav": {
          if (!id) throw new CliError("Missing connected account ID.", "INVALID_ARGUMENTS");

          const response = await services.api.post<
            GraphQLResponse<{ getConnectedImapSmtpCaldavAccount?: unknown }>
          >("/graphql", {
            query: GET_CONNECTED_IMAP_SMTP_CALDAV_ACCOUNT_QUERY,
            variables: { id },
          });

          await services.output.render(
            sanitizeImapSmtpCaldavAccount(
              resolveGraphqlField(
                response.data,
                "getConnectedImapSmtpCaldavAccount",
                "IMAP/SMTP/CALDAV account management is not available on this workspace",
              ),
              options,
            ),
            {
              format: globalOptions.output,
              query: globalOptions.query,
            },
          );
          break;
        }
        case "save-imap-smtp-caldav": {
          if (!options.accountOwnerId) {
            throw new CliError("Missing --account-owner-id option.", "INVALID_ARGUMENTS");
          }
          if (!options.handle) {
            throw new CliError("Missing --handle option.", "INVALID_ARGUMENTS");
          }

          const connectionParameters = await parseBody(options.data, options.file, options.set);
          const response = await services.api.post<
            GraphQLResponse<{ saveImapSmtpCaldavAccount?: unknown }>
          >("/graphql", {
            query: SAVE_IMAP_SMTP_CALDAV_ACCOUNT_MUTATION,
            variables: {
              accountOwnerId: options.accountOwnerId,
              handle: options.handle,
              connectionParameters,
              id,
            },
          });

          await services.output.render(
            resolveGraphqlField(
              response.data,
              "saveImapSmtpCaldavAccount",
              "IMAP/SMTP/CALDAV account management is not available on this workspace",
            ),
            {
              format: globalOptions.output,
              query: globalOptions.query,
            },
          );
          break;
        }
        default:
          throw new CliError(`Unknown operation: ${operation}`, "INVALID_ARGUMENTS");
      }
    },
  );
}

function sanitizeConnectedAccount(value: unknown, options: ConnectedAccountsOptions): unknown {
  if (options.showSecrets || value == null || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }

  const record = { ...(value as Record<string, unknown>) };

  if ("accessToken" in record) {
    record.accessToken = maskSecret(record.accessToken);
  }
  if ("refreshToken" in record) {
    record.refreshToken = maskSecret(record.refreshToken);
  }
  if ("connectionParameters" in record) {
    record.connectionParameters = maskSecret(record.connectionParameters);
  }

  return record;
}

function sanitizeImapSmtpCaldavAccount(value: unknown, options: ConnectedAccountsOptions): unknown {
  if (options.showSecrets || value == null || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }

  const record = { ...(value as Record<string, unknown>) };
  const connectionParameters = record.connectionParameters;

  if (connectionParameters == null || typeof connectionParameters !== "object") {
    return record;
  }

  record.connectionParameters = Object.fromEntries(
    Object.entries(connectionParameters as Record<string, unknown>).map(([protocol, params]) => {
      if (params == null || typeof params !== "object" || Array.isArray(params)) {
        return [protocol, params];
      }

      const next = { ...(params as Record<string, unknown>) };
      if ("password" in next) {
        next.password = maskSecret(next.password);
      }

      return [protocol, next];
    }),
  );

  return record;
}

function resolveGraphqlField<T>(
  response: GraphQLResponse<Record<string, T | null>> | undefined,
  key: string,
  unavailablePrefix: string,
): T | null {
  if (Array.isArray(response?.errors) && response.errors.length > 0) {
    if (response.errors.some((error) => error.message?.includes(key))) {
      throw new CliError(`${unavailablePrefix} because it does not expose ${key}.`, "API_ERROR");
    }

    throw new CliError(
      response.errors
        .map((error) => error.message?.trim())
        .filter((message): message is string => Boolean(message))
        .join("\n") || `${unavailablePrefix}.`,
      "API_ERROR",
    );
  }

  const data = response?.data;
  if (data == null || typeof data !== "object" || Array.isArray(data)) {
    throw new CliError("Connected account request returned an unexpected response.", "API_ERROR");
  }

  if (!Object.prototype.hasOwnProperty.call(data, key)) {
    throw new CliError("Connected account request returned an unexpected response.", "API_ERROR");
  }

  return (data as Record<string, T | null>)[key] ?? null;
}

function maskSecret(value: unknown): unknown {
  if (value == null || value === "") {
    return value;
  }

  return "[hidden]";
}
