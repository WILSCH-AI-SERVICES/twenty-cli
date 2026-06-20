import { Command } from "commander";

import { requireGraphqlField, type GraphQLResponse } from "../../utilities/api/graphql-response";
import { CliError } from "../../utilities/errors/cli-error";
import { createCommandContext } from "../../utilities/shared/context";
import { applyGlobalOptions } from "../../utilities/shared/global-options";

interface ApiKeyOptions {
  name?: string;
  expiresAt?: string;
  roleId?: string;
  revokedAt?: string;
}

export function registerApiKeysCommand(program: Command): void {
  const endpoint = "/metadata";
  const cmd = program.command("api-keys").description("Manage API keys");
  applyGlobalOptions(cmd);

  const listCmd = cmd.command("list").description("List API keys");
  applyGlobalOptions(listCmd);
  listCmd.action(async (_options: unknown, command: Command) => {
    const { globalOptions, services } = await createCommandContext(command);
    const response = await services.api.post<GraphQLResponse<{ apiKeys?: unknown[] | null }>>(
      endpoint,
      {
        query: `query { apiKeys { id name expiresAt revokedAt createdAt role { id label } } }`,
      },
    );
    const apiKeys = requireGraphqlField(response.data ?? {}, "apiKeys", "Failed to list API keys.");
    await services.output.render(apiKeys ?? [], {
      format: globalOptions.output,
      query: globalOptions.query,
    });
  });

  const getCmd = cmd.command("get").description("Get an API key").argument("[id]", "API key ID");
  applyGlobalOptions(getCmd);
  getCmd.action(async (id: string | undefined, _options: unknown, command: Command) => {
    const { globalOptions, services } = await createCommandContext(command);
    if (!id) throw new CliError("Missing API key ID.", "INVALID_ARGUMENTS");
    const response = await services.api.post<GraphQLResponse<{ apiKey: unknown }>>(endpoint, {
      query: `query($id: UUID!) { apiKey(input: { id: $id }) { id name expiresAt revokedAt createdAt updatedAt role { id label } } }`,
      variables: { id },
    });
    await services.output.render(
      requireGraphqlField(response.data ?? {}, "apiKey", `Failed to fetch API key ${id}.`),
      {
        format: globalOptions.output,
        query: globalOptions.query,
      },
    );
  });

  const createCmd = cmd.command("create").description("Create an API key");
  createCmd
    .option("--name <name>", "API key name")
    .option("--expires-at <date>", "Expiration date (ISO format)")
    .option("--role-id <id>", "Role ID for the API key");
  applyGlobalOptions(createCmd);
  createCmd.action(async (options: ApiKeyOptions, command: Command) => {
    const { globalOptions, services } = await createCommandContext(command);
    if (!options.name) throw new CliError("Missing --name option.", "INVALID_ARGUMENTS");
    if (!options.expiresAt) throw new CliError("Missing --expires-at option.", "INVALID_ARGUMENTS");
    if (!options.roleId) throw new CliError("Missing --role-id option.", "INVALID_ARGUMENTS");
    const response = await services.api.post<
      GraphQLResponse<{ createApiKey?: { id: string; name: string; expiresAt?: string } | null }>
    >(endpoint, {
      query: `mutation($input: CreateApiKeyInput!) { createApiKey(input: $input) { id name expiresAt role { id label } } }`,
      variables: {
        input: {
          name: options.name,
          expiresAt: options.expiresAt,
          roleId: options.roleId,
        },
      },
    });
    const result = requireGraphqlField(
      response.data ?? {},
      "createApiKey",
      "Failed to create API key.",
    );
    if (!result) throw new CliError("Failed to create API key.", "API_ERROR");
    const tokenResponse = await services.api.post<
      GraphQLResponse<{ generateApiKeyToken?: { token?: string } | null }>
    >(endpoint, {
      query: `mutation($id: UUID!, $expiresAt: String!) { generateApiKeyToken(apiKeyId: $id, expiresAt: $expiresAt) { token } }`,
      variables: { id: result.id, expiresAt: options.expiresAt },
    });
    const tokenResult = requireGraphqlField(
      tokenResponse.data ?? {},
      "generateApiKeyToken",
      `Failed to generate a token for API key ${result.id}.`,
    );
    const output = {
      ...result,
      token: tokenResult?.token,
    };
    await services.output.render(output, {
      format: globalOptions.output,
      query: globalOptions.query,
    });
  });

  const updateCmd = cmd
    .command("update")
    .description("Update an API key")
    .argument("[id]", "API key ID");
  updateCmd
    .option("--name <name>", "API key name")
    .option("--expires-at <date>", "Expiration date (ISO format)")
    .option("--revoked-at <date>", "Revoked date (ISO format)");
  applyGlobalOptions(updateCmd);
  updateCmd.action(async (id: string | undefined, options: ApiKeyOptions, command: Command) => {
    const { globalOptions, services } = await createCommandContext(command);
    if (!id) throw new CliError("Missing API key ID.", "INVALID_ARGUMENTS");
    if (!options.name && !options.expiresAt && options.revokedAt === undefined) {
      throw new CliError(
        "Provide at least one of --name, --expires-at, or --revoked-at.",
        "INVALID_ARGUMENTS",
      );
    }

    const response = await services.api.post<GraphQLResponse<{ updateApiKey: unknown }>>(endpoint, {
      query: `mutation($input: UpdateApiKeyInput!) { updateApiKey(input: $input) { id name expiresAt revokedAt role { id label } } }`,
      variables: {
        input: {
          id,
          name: options.name,
          expiresAt: options.expiresAt,
          revokedAt: options.revokedAt,
        },
      },
    });
    await services.output.render(
      requireGraphqlField(response.data ?? {}, "updateApiKey", `Failed to update API key ${id}.`),
      {
        format: globalOptions.output,
        query: globalOptions.query,
      },
    );
  });

  const deleteCmd = cmd
    .command("delete")
    .description("Delete an API key")
    .argument("[id]", "API key ID");
  applyGlobalOptions(deleteCmd);
  deleteCmd.action(async (id: string | undefined, _options: unknown, command: Command) => {
    const { globalOptions, services } = await createCommandContext(command);
    if (!id) throw new CliError("Missing API key ID.", "INVALID_ARGUMENTS");
    const response = await services.api.delete(`/rest/metadata/apiKeys/${id}`);
    await services.output.render(response.data ?? { id, deleted: true }, {
      format: globalOptions.output,
      query: globalOptions.query,
    });
  });

  const revokeCmd = cmd
    .command("revoke")
    .description("Revoke an API key")
    .argument("[id]", "API key ID");
  applyGlobalOptions(revokeCmd);
  revokeCmd.action(async (id: string | undefined, _options: unknown, command: Command) => {
    const { services } = await createCommandContext(command);
    if (!id) throw new CliError("Missing API key ID.", "INVALID_ARGUMENTS");
    const response = await services.api.post<
      GraphQLResponse<{ revokeApiKey?: { id: string } | null }>
    >(endpoint, {
      query: `mutation($id: UUID!) { revokeApiKey(input: { id: $id }) { id } }`,
      variables: { id },
    });
    const revoked = requireGraphqlField(
      response.data ?? {},
      "revokeApiKey",
      `Failed to revoke API key ${id}.`,
    );
    if (!revoked) throw new CliError(`Failed to revoke API key ${id}.`, "API_ERROR");
    // eslint-disable-next-line no-console
    console.log(`API key ${id} revoked.`);
  });

  const assignRoleCmd = cmd
    .command("assign-role")
    .description("Assign a role to an API key")
    .argument("[id]", "API key ID")
    .option("--role-id <id>", "Role ID for the API key");
  applyGlobalOptions(assignRoleCmd);
  assignRoleCmd.action(async (id: string | undefined, options: ApiKeyOptions, command: Command) => {
    const { globalOptions, services } = await createCommandContext(command);
    if (!id) throw new CliError("Missing API key ID.", "INVALID_ARGUMENTS");
    if (!options.roleId) throw new CliError("Missing --role-id option.", "INVALID_ARGUMENTS");

    const response = await services.api.post<GraphQLResponse<{ assignRoleToApiKey: boolean }>>(
      endpoint,
      {
        query: `mutation($id: UUID!, $roleId: UUID!) { assignRoleToApiKey(apiKeyId: $id, roleId: $roleId) }`,
        variables: { id, roleId: options.roleId },
      },
    );

    await services.output.render(
      {
        apiKeyId: id,
        roleId: options.roleId,
        assigned: requireGraphqlField(
          response.data ?? {},
          "assignRoleToApiKey",
          `Failed to assign role ${options.roleId} to API key ${id}.`,
        ),
      },
      { format: globalOptions.output, query: globalOptions.query },
    );
  });
}
