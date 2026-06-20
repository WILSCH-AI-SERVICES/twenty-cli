import { Command, Option } from "commander";

import { isGlobalOptionValueToken } from "../utilities/shared/global-options";
import { HELP_JSON_FLAG_ALIASES } from "./constants";
import { HelpSubcommand } from "./types";

export function resolveTargetCommand(
  program: Command,
  args: string[],
): { command: Command; path: string[] } {
  const sanitizedArgs = args.filter((token) => !isTruthyHelpJsonFlag(token));
  const pathParts = [program.name()];
  let current = program;

  for (let index = 0; index < sanitizedArgs.length; index += 1) {
    const token = sanitizedArgs[index];
    if (token === undefined) {
      continue;
    }
    if (token === "--") {
      break;
    }

    const option = findMatchingOption(current, token);
    if (option) {
      if ((option.required || option.optional) && !token.includes("=")) {
        index += 1;
      }
      continue;
    }

    if (token.startsWith("-")) {
      continue;
    }

    const nextCommand = current.commands.find(
      (candidate) =>
        candidate.name() !== "help" &&
        (candidate.name() === token || candidate.aliases().includes(token)),
    );

    if (!nextCommand) {
      break;
    }

    current = nextCommand;
    pathParts.push(nextCommand.name());
  }

  return { command: current, path: pathParts };
}

export function hasHelpJsonFlag(args: string[]): boolean {
  return args.some((token) => isTruthyHelpJsonFlag(token));
}

export function isTruthyHelpJsonFlag(token: string): boolean {
  if (HELP_JSON_FLAG_ALIASES.includes(token)) {
    return true;
  }

  for (const flag of HELP_JSON_FLAG_ALIASES) {
    if (!token.startsWith(`${flag}=`)) {
      continue;
    }

    const rawValue = token
      .slice(flag.length + 1)
      .trim()
      .toLowerCase();
    return rawValue === "1" || rawValue === "true";
  }

  return false;
}

export function findMatchingOption(command: Command, token: string): Option | undefined {
  return command.options.find((option) => {
    if (option.long === token || option.short === token) {
      return true;
    }

    return Boolean(option.long && token.startsWith(`${option.long}=`));
  });
}

export function getVisibleSubcommands(command: Command): HelpSubcommand[] {
  return command.commands
    .filter(
      (candidate) => candidate.name() !== "help" && !candidate.name().startsWith("completion"),
    )
    .map((candidate) => ({
      name: candidate.name(),
      aliases: candidate.aliases(),
      summary: candidate.description() || "",
    }));
}

export function shouldRenderRootHelp(args: string[]): boolean {
  if (args.length === 0) {
    return true;
  }

  const hasHelpFlag = args.includes("--help") || args.includes("-h");
  if (!hasHelpFlag) {
    return false;
  }

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === undefined) {
      continue;
    }

    if (token === "--") {
      break;
    }

    if (token === "--help" || token === "-h") {
      continue;
    }

    if (isGlobalOptionValueToken(token)) {
      if (!token.includes("=")) {
        index += 1;
      }
      continue;
    }

    if (token.startsWith("-")) {
      continue;
    }

    return false;
  }
  return true;
}
