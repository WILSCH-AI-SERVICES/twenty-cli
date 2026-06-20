import path from "path";

import { Command } from "commander";
import fs from "fs-extra";

import {
  resolveTargetCommand,
  hasHelpJsonFlag,
  shouldRenderRootHelp,
  getVisibleSubcommands,
} from "./command-resolution";
import { EXIT_CODES, METADATA, OUTPUT_CONTRACT, ROOT_HELP_FALLBACK } from "./constants";
import { getHelpOperations } from "./operations";
import { getHelpArguments, getHelpOptions } from "./options";
import { HelpDocument, HelpWriter } from "./types";

export async function maybeHandleInlineHelp(
  program: Command,
  args: string[],
  write: HelpWriter = defaultWrite,
): Promise<boolean> {
  if (hasHelpJsonFlag(args)) {
    write(JSON.stringify(buildHelpJson(program, args), null, 2));
    return true;
  }

  if (shouldRenderRootHelp(args)) {
    write(loadRootHelpText());
    return true;
  }

  return false;
}

export function buildHelpJson(program: Command, args: string[]): HelpDocument {
  const { command, path: commandPath } = resolveTargetCommand(program, args);
  const commandKey = commandPath.join(" ");
  const metadata = METADATA[commandKey] ?? {};
  const options = getHelpOptions(command);
  const operations = getHelpOperations(command, commandKey, metadata);
  const capabilities = {
    mutates: metadata.mutates ?? operations.some((operation) => operation.mutates),
    supports_query: options.some((option) => option.name === "query"),
    supports_workspace: options.some((option) => option.name === "workspace"),
    supports_output: options.some((option) => option.name === "output"),
  };

  return {
    schema_version: 1,
    kind: command === program ? "root" : "command",
    name: command.name(),
    aliases: command.aliases(),
    path: commandPath,
    summary: command.description() || "",
    description: command.description() || undefined,
    usage: buildUsage(command, commandPath),
    examples: metadata.examples ?? [],
    args: getHelpArguments(command),
    options,
    operations,
    subcommands: getVisibleSubcommands(command),
    capabilities,
    exit_codes: EXIT_CODES,
    output_contract:
      capabilities.supports_output || capabilities.supports_query ? OUTPUT_CONTRACT : undefined,
  };
}

function loadRootHelpText(): string {
  const helpPath = path.join(__dirname, "..", "help.txt");
  if (fs.pathExistsSync(helpPath)) {
    return fs.readFileSync(helpPath, "utf-8");
  }

  return ROOT_HELP_FALLBACK;
}

function buildUsage(command: Command, commandPath: string[]): string {
  if (commandPath.length === 1) {
    return `${commandPath[0]} [command] [options]`;
  }

  const usage = command.usage();
  if (!usage) {
    return commandPath.join(" ");
  }

  return `${commandPath.join(" ")} ${usage}`;
}

function defaultWrite(text: string): void {
  // eslint-disable-next-line no-console
  console.log(text);
}
