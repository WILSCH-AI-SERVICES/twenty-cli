import { Command } from "commander";

import { applyGlobalOptions } from "../../utilities/shared/global-options";
import { collect } from "./serverless.shared";
import { ServerlessSubcommandConfig } from "./serverless.types";

export function applyMutationOptions(command: Command): void {
  command
    .option("-d, --data <json>", "JSON payload")
    .option("-f, --file <path>", "JSON file payload (use - for stdin)")
    .option("--set <key=value>", "Set a field value", collect)
    .option("--name <name>", "Function name")
    .option("--description <text>", "Function description")
    .option("--timeout-seconds <seconds>", "Function timeout in seconds", Number);
}

export function applyExecutionOptions(command: Command): void {
  command
    .option("-d, --data <json>", "JSON payload")
    .option("-f, --file <path>", "JSON file payload (use - for stdin)")
    .option("--set <key=value>", "Set a field value", collect);
}

export function applyLogsOptions(command: Command): void {
  command
    .option("--name <name>", "Function name")
    .option("--universal-identifier <id>", "Function universal identifier filter for logs")
    .option("--application-id <id>", "Application ID filter for logs")
    .option(
      "--application-universal-identifier <id>",
      "Application universal identifier filter for logs",
    )
    .option("--max-events <count>", "Stop streaming after N log payloads", Number)
    .option("--wait-seconds <seconds>", "Stop streaming after N seconds", Number);
}

export function applyLayerOptions(command: Command): void {
  command
    .option("--package-json <json>", "Layer package.json JSON")
    .option("--package-json-file <path>", "Layer package.json file")
    .option("--yarn-lock <text>", "Layer yarn.lock content")
    .option("--yarn-lock-file <path>", "Layer yarn.lock file");
}

export function registerServerlessSubcommand(
  serverless: Command,
  config: ServerlessSubcommandConfig,
): Command {
  const command = serverless.command(config.name).description(config.description);

  if (config.alias) {
    command.alias(config.alias);
  }

  if (config.hasIdArgument) {
    command.argument("[id]", "Function ID");
  }

  config.configure?.(command);
  applyGlobalOptions(command);

  if (config.hasIdArgument) {
    command.action(async (id: string | undefined, _options: unknown, currentCommand: Command) => {
      await config.action(id, currentCommand);
    });
  } else {
    command.action(async (_options: unknown, currentCommand: Command) => {
      await config.action(undefined, currentCommand);
    });
  }

  return command;
}
