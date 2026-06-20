import { Command } from "commander";

import { CliError } from "../../utilities/errors/cli-error";
import { applyGlobalOptions } from "../../utilities/shared/global-options";
import { runServerlessCreateLayerOperation } from "./operations/create-layer.operation";
import { runServerlessCreateOperation } from "./operations/create.operation";
import { runServerlessDeleteOperation } from "./operations/delete.operation";
import { runServerlessExecuteOperation } from "./operations/execute.operation";
import { runServerlessGetOperation } from "./operations/get.operation";
import { runServerlessListOperation } from "./operations/list.operation";
import { runServerlessLogsOperation } from "./operations/logs.operation";
import { runServerlessPublishOperation } from "./operations/publish.operation";
import { runServerlessSourceOperation } from "./operations/source.operation";
import { runServerlessUpdateOperation } from "./operations/update.operation";
import {
  applyExecutionOptions,
  applyLayerOptions,
  applyLogsOptions,
  applyMutationOptions,
  registerServerlessSubcommand,
} from "./serverless.registration";
import {
  createServerlessOperationContext,
  executeCompatibleOperation,
  renderServerlessFunction,
} from "./serverless.shared";
import { ServerlessSubcommandConfig } from "./serverless.types";

async function runServerlessPackagesOperation(
  id: string | undefined,
  command: Command,
): Promise<void> {
  if (!id) {
    throw new CliError("Missing function ID.", "INVALID_ARGUMENTS");
  }

  const context = await createServerlessOperationContext(command);
  const result = await executeCompatibleOperation<unknown>(context.services, {
    current: {
      query: `query($input: ServerlessFunctionIdInput!) { getAvailablePackages(input: $input) }`,
      variables: { input: { id } },
      resultKey: "getAvailablePackages",
      schemaSymbols: ["ServerlessFunctionIdInput"],
    },
    legacy: {
      query: `query($input: LogicFunctionIdInput!) { getAvailablePackages(input: $input) }`,
      variables: { input: { id } },
      resultKey: "getAvailablePackages",
    },
  });

  await renderServerlessFunction(result ?? {}, context);
}

const subcommands: ServerlessSubcommandConfig[] = [
  {
    name: "list",
    description: "List serverless functions",
    action: async (_id, command) => runServerlessListOperation(command),
  },
  {
    name: "get",
    description: "Get a serverless function",
    hasIdArgument: true,
    action: runServerlessGetOperation,
  },
  {
    name: "create",
    description: "Create a serverless function",
    configure: applyMutationOptions,
    action: async (_id, command) => runServerlessCreateOperation(command),
  },
  {
    name: "update",
    description: "Update a serverless function",
    hasIdArgument: true,
    configure: applyMutationOptions,
    action: runServerlessUpdateOperation,
  },
  {
    name: "delete",
    description: "Delete a serverless function",
    hasIdArgument: true,
    configure: (command) => {
      command.option("--yes", "Confirm destructive operations");
    },
    action: runServerlessDeleteOperation,
  },
  {
    name: "publish",
    description: "Publish a serverless function",
    hasIdArgument: true,
    action: runServerlessPublishOperation,
  },
  {
    name: "execute",
    description: "Execute a serverless function",
    hasIdArgument: true,
    configure: applyExecutionOptions,
    action: runServerlessExecuteOperation,
  },
  {
    name: "packages",
    alias: "available-packages",
    description: "List available packages for a serverless function",
    hasIdArgument: true,
    action: runServerlessPackagesOperation,
  },
  {
    name: "source",
    description: "Get serverless function source code",
    hasIdArgument: true,
    action: runServerlessSourceOperation,
  },
  {
    name: "logs",
    description: "Stream serverless function logs",
    hasIdArgument: true,
    configure: applyLogsOptions,
    action: runServerlessLogsOperation,
  },
  {
    name: "create-layer",
    description: "Create a serverless function layer",
    configure: applyLayerOptions,
    action: async (_id, command) => runServerlessCreateLayerOperation(command),
  },
];

export function registerServerlessCommand(program: Command): void {
  const serverless = program.command("serverless").description("Manage serverless functions");
  applyGlobalOptions(serverless);

  for (const subcommand of subcommands) {
    registerServerlessSubcommand(serverless, subcommand);
  }
}
