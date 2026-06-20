import { Command } from "commander";

import {
  hasSchemaErrorSymbol,
  requireGraphqlField,
  type GraphQLResponse,
} from "../../utilities/api/graphql-response";
import { CliError } from "../../utilities/errors/cli-error";
import { parseBody } from "../../utilities/shared/body";
import { requireYes } from "../../utilities/shared/confirmation";
import { createCommandContext } from "../../utilities/shared/context";
import { applyGlobalOptions } from "../../utilities/shared/global-options";

interface RouteTriggersOptions {
  data?: string;
  file?: string;
  set?: string[];
  yes?: boolean;
}

const ROUTE_TRIGGER_FIELDS = `
  id
  path
  isAuthRequired
  httpMethod
  createdAt
  updatedAt
`;

const FIND_MANY_ROUTE_TRIGGERS_QUERY = `query FindManyRouteTriggers {
  findManyRouteTriggers {
    ${ROUTE_TRIGGER_FIELDS}
  }
}`;

const FIND_ONE_ROUTE_TRIGGER_QUERY = `query FindOneRouteTrigger($id: String!) {
  findOneRouteTrigger(input: { id: $id }) {
    ${ROUTE_TRIGGER_FIELDS}
  }
}`;

const CREATE_ONE_ROUTE_TRIGGER_MUTATION = `mutation CreateOneRouteTrigger($input: CreateRouteTriggerInput!) {
  createOneRouteTrigger(input: $input) {
    ${ROUTE_TRIGGER_FIELDS}
  }
}`;

const UPDATE_ONE_ROUTE_TRIGGER_MUTATION = `mutation UpdateOneRouteTrigger($input: UpdateRouteTriggerInput!) {
  updateOneRouteTrigger(input: $input) {
    ${ROUTE_TRIGGER_FIELDS}
  }
}`;

const DELETE_ONE_ROUTE_TRIGGER_MUTATION = `mutation DeleteOneRouteTrigger($input: RouteTriggerIdInput!) {
  deleteOneRouteTrigger(input: $input) {
    ${ROUTE_TRIGGER_FIELDS}
  }
}`;

function collect(value: string, previous: string[] = []): string[] {
  return previous.concat([value]);
}

function requireRouteTriggerField<T>(
  response: GraphQLResponse<Record<string, T>> | undefined,
  key: string,
  fallbackMessage: string,
): T {
  const payload = response ?? {};

  if (hasSchemaErrorSymbol(payload, [key])) {
    throw new CliError(
      "Route trigger management is not available on this workspace's current schema.",
      "API_ERROR",
    );
  }

  return requireGraphqlField(payload, key, fallbackMessage);
}

export function registerRouteTriggersCommand(program: Command): void {
  const endpoint = "/metadata";
  const cmd = program.command("route-triggers").description("Manage route triggers");
  applyGlobalOptions(cmd);

  const listCmd = cmd.command("list").description("List route triggers");
  applyGlobalOptions(listCmd);
  listCmd.action(async (_options: unknown, command: Command) => {
    const { globalOptions, services } = await createCommandContext(command);
    const response = await services.api.post<
      GraphQLResponse<{ findManyRouteTriggers?: unknown[] }>
    >(endpoint, {
      query: FIND_MANY_ROUTE_TRIGGERS_QUERY,
    });

    const routeTriggers = requireRouteTriggerField(
      response.data,
      "findManyRouteTriggers",
      "Failed to list route triggers.",
    );
    await services.output.render(routeTriggers ?? [], {
      format: globalOptions.output,
      query: globalOptions.query,
    });
  });

  const getCmd = cmd
    .command("get")
    .description("Get a route trigger")
    .argument("[id]", "Route trigger ID");
  applyGlobalOptions(getCmd);
  getCmd.action(async (id: string | undefined, _options: unknown, command: Command) => {
    const { globalOptions, services } = await createCommandContext(command);
    if (!id) {
      throw new CliError("Missing route trigger ID.", "INVALID_ARGUMENTS");
    }

    const response = await services.api.post<GraphQLResponse<{ findOneRouteTrigger?: unknown }>>(
      endpoint,
      {
        query: FIND_ONE_ROUTE_TRIGGER_QUERY,
        variables: { id },
      },
    );

    await services.output.render(
      requireRouteTriggerField(
        response.data,
        "findOneRouteTrigger",
        `Failed to fetch route trigger ${id}.`,
      ),
      {
        format: globalOptions.output,
        query: globalOptions.query,
      },
    );
  });

  const createCmd = cmd.command("create").description("Create a route trigger");
  createCmd
    .option("-d, --data <json>", "JSON payload")
    .option("-f, --file <path>", "JSON file payload (use - for stdin)")
    .option("--set <key=value>", "Set a field value", collect);
  applyGlobalOptions(createCmd);
  createCmd.action(async (options: RouteTriggersOptions, command: Command) => {
    const { globalOptions, services } = await createCommandContext(command);
    const payload = await parseBody(options.data, options.file, options.set);
    const response = await services.api.post<GraphQLResponse<{ createOneRouteTrigger?: unknown }>>(
      endpoint,
      {
        query: CREATE_ONE_ROUTE_TRIGGER_MUTATION,
        variables: { input: payload },
      },
    );

    await services.output.render(
      requireRouteTriggerField(
        response.data,
        "createOneRouteTrigger",
        "Failed to create route trigger.",
      ),
      {
        format: globalOptions.output,
        query: globalOptions.query,
      },
    );
  });

  const updateCmd = cmd
    .command("update")
    .description("Update a route trigger")
    .argument("[id]", "Route trigger ID");
  updateCmd
    .option("-d, --data <json>", "JSON payload")
    .option("-f, --file <path>", "JSON file payload (use - for stdin)")
    .option("--set <key=value>", "Set a field value", collect);
  applyGlobalOptions(updateCmd);
  updateCmd.action(
    async (id: string | undefined, options: RouteTriggersOptions, command: Command) => {
      const { globalOptions, services } = await createCommandContext(command);
      if (!id) {
        throw new CliError("Missing route trigger ID.", "INVALID_ARGUMENTS");
      }

      const payload = await parseBody(options.data, options.file, options.set);
      const response = await services.api.post<
        GraphQLResponse<{ updateOneRouteTrigger?: unknown }>
      >(endpoint, {
        query: UPDATE_ONE_ROUTE_TRIGGER_MUTATION,
        variables: {
          input: {
            id,
            update: payload,
          },
        },
      });

      await services.output.render(
        requireRouteTriggerField(
          response.data,
          "updateOneRouteTrigger",
          `Failed to update route trigger ${id}.`,
        ),
        {
          format: globalOptions.output,
          query: globalOptions.query,
        },
      );
    },
  );

  const deleteCmd = cmd
    .command("delete")
    .description("Delete a route trigger")
    .argument("[id]", "Route trigger ID")
    .option("--yes", "Confirm destructive operations");
  applyGlobalOptions(deleteCmd);
  deleteCmd.action(
    async (id: string | undefined, options: RouteTriggersOptions, command: Command) => {
      const { globalOptions, services } = await createCommandContext(command);
      if (!id) {
        throw new CliError("Missing route trigger ID.", "INVALID_ARGUMENTS");
      }
      requireYes(options, "Delete");

      const response = await services.api.post<
        GraphQLResponse<{ deleteOneRouteTrigger?: unknown }>
      >(endpoint, {
        query: DELETE_ONE_ROUTE_TRIGGER_MUTATION,
        variables: {
          input: {
            id,
          },
        },
      });

      await services.output.render(
        requireRouteTriggerField(
          response.data,
          "deleteOneRouteTrigger",
          `Failed to delete route trigger ${id}.`,
        ),
        {
          format: globalOptions.output,
          query: globalOptions.query,
        },
      );
    },
  );
}
