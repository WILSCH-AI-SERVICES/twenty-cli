import { Command } from "commander";

import { requireGraphqlField, type GraphQLResponse } from "../../utilities/api/graphql-response";
import { CliError } from "../../utilities/errors/cli-error";
import { parseBody } from "../../utilities/shared/body";
import { createCommandContext } from "../../utilities/shared/context";
import { applyGlobalOptions } from "../../utilities/shared/global-options";

interface WebhooksOptions {
  data?: string;
  file?: string;
  set?: string[];
}

function collect(value: string, previous: string[] = []): string[] {
  return previous.concat([value]);
}

export function registerWebhooksCommand(program: Command): void {
  const endpoint = "/metadata";
  const cmd = program.command("webhooks").description("Manage webhooks");
  applyGlobalOptions(cmd);

  const listCmd = cmd.command("list").description("List webhooks");
  applyGlobalOptions(listCmd);
  listCmd.action(async (_options: unknown, command: Command) => {
    const { globalOptions, services } = await createCommandContext(command);
    const response = await services.api.post<GraphQLResponse<{ webhooks?: unknown[] | null }>>(
      endpoint,
      {
        query: `query { webhooks { id targetUrl operations description createdAt } }`,
      },
    );
    const webhooks = requireGraphqlField(
      response.data ?? {},
      "webhooks",
      "Failed to list webhooks.",
    );
    await services.output.render(webhooks ?? [], {
      format: globalOptions.output,
      query: globalOptions.query,
    });
  });

  const getCmd = cmd.command("get").description("Get a webhook").argument("[id]", "Webhook ID");
  applyGlobalOptions(getCmd);
  getCmd.action(async (id: string | undefined, _options: unknown, command: Command) => {
    const { globalOptions, services } = await createCommandContext(command);
    if (!id) throw new CliError("Missing webhook ID.", "INVALID_ARGUMENTS");
    const response = await services.api.post<GraphQLResponse<{ webhook: unknown }>>(endpoint, {
      query: `query($id: UUID!) { webhook(input: { id: $id }) { id targetUrl operations description secret createdAt updatedAt } }`,
      variables: { id },
    });
    await services.output.render(
      requireGraphqlField(response.data ?? {}, "webhook", `Failed to fetch webhook ${id}.`),
      {
        format: globalOptions.output,
        query: globalOptions.query,
      },
    );
  });

  const createCmd = cmd.command("create").description("Create a webhook");
  createCmd
    .option("-d, --data <json>", "JSON payload")
    .option("-f, --file <path>", "JSON file")
    .option("--set <key=value>", "Set a field value", collect);
  applyGlobalOptions(createCmd);
  createCmd.action(async (options: WebhooksOptions, command: Command) => {
    const { globalOptions, services } = await createCommandContext(command);
    const payload = await parseBody(options.data, options.file, options.set);
    const response = await services.api.post<GraphQLResponse<{ createWebhook: unknown }>>(
      endpoint,
      {
        query: `mutation($input: CreateWebhookInput!) { createWebhook(input: $input) { id targetUrl operations description } }`,
        variables: { input: payload },
      },
    );
    await services.output.render(
      requireGraphqlField(response.data ?? {}, "createWebhook", "Failed to create webhook."),
      {
        format: globalOptions.output,
        query: globalOptions.query,
      },
    );
  });

  const updateCmd = cmd
    .command("update")
    .description("Update a webhook")
    .argument("[id]", "Webhook ID");
  updateCmd
    .option("-d, --data <json>", "JSON payload")
    .option("-f, --file <path>", "JSON file")
    .option("--set <key=value>", "Set a field value", collect);
  applyGlobalOptions(updateCmd);
  updateCmd.action(async (id: string | undefined, options: WebhooksOptions, command: Command) => {
    const { globalOptions, services } = await createCommandContext(command);
    if (!id) throw new CliError("Missing webhook ID.", "INVALID_ARGUMENTS");
    const payload = await parseBody(options.data, options.file, options.set);
    const response = await services.api.post<GraphQLResponse<{ updateWebhook: unknown }>>(
      endpoint,
      {
        query: `mutation($input: UpdateWebhookInput!) { updateWebhook(input: $input) { id targetUrl operations description } }`,
        variables: {
          input: {
            id,
            ...payload,
          },
        },
      },
    );
    await services.output.render(
      requireGraphqlField(response.data ?? {}, "updateWebhook", `Failed to update webhook ${id}.`),
      {
        format: globalOptions.output,
        query: globalOptions.query,
      },
    );
  });

  const deleteCmd = cmd
    .command("delete")
    .description("Delete a webhook")
    .argument("[id]", "Webhook ID");
  applyGlobalOptions(deleteCmd);
  deleteCmd.action(async (id: string | undefined, _options: unknown, command: Command) => {
    const { services } = await createCommandContext(command);
    if (!id) throw new CliError("Missing webhook ID.", "INVALID_ARGUMENTS");
    const response = await services.api.post<GraphQLResponse<{ deleteWebhook: boolean }>>(
      endpoint,
      {
        query: `mutation($id: UUID!) { deleteWebhook(input: { id: $id }) }`,
        variables: { id },
      },
    );
    const deleted = requireGraphqlField(
      response.data ?? {},
      "deleteWebhook",
      `Failed to delete webhook ${id}.`,
    );
    if (!deleted) {
      throw new CliError(`Failed to delete webhook ${id}.`, "API_ERROR");
    }
    // eslint-disable-next-line no-console
    console.log(`Webhook ${id} deleted.`);
  });
}
