import { Command, Option } from "commander";

import { GLOBAL_OPTION_NAMES } from "../utilities/shared/global-options";
import { shortAliasesForOption } from "../utilities/shared/option-aliases";
import { HelpArgument, HelpOption } from "./types";

export function getHelpArguments(command: Command): HelpArgument[] {
  return (command.registeredArguments ?? []).map((argument) => ({
    name: argument.name(),
    required: argument.required,
    variadic: argument.variadic,
    description: argument.description || undefined,
  }));
}

export function getHelpOptions(command: Command): HelpOption[] {
  return command.options
    .filter((option) => option.long !== "--help")
    .map((option) => {
      const longName = (option.long ?? `--${option.attributeName()}`).replace(/^--/, "");

      return {
        name: longName,
        aliases: shortAliasesForOption(longName).filter((alias) => alias !== longName),
        flags: option.flags,
        type: inferOptionType(option),
        default:
          option.defaultValue === undefined ? undefined : JSON.stringify(option.defaultValue),
        required: option.mandatory ?? false,
        global: GLOBAL_OPTION_NAMES.has(longName),
        description: option.description || "",
      };
    });
}

export function inferOptionType(option: Option): string {
  if (option.required || option.optional) {
    return "string";
  }

  return "boolean";
}
