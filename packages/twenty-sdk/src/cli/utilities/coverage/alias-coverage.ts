import type { Command } from "commander";
import { hasShortCommandCoverage } from "../shared/command-aliases";
import { collectOptionAliasEntries, findOptionAliasCollisions } from "../shared/option-aliases";

export interface AliasCoverageResult {
  ok: boolean;
  missingCommandAliases: string[];
  missingOptionAliases: string[];
  optionAliasCollisions: Array<{ alias: string; canonicals: string[] }>;
  commandCount: number;
  optionCount: number;
}

export function auditAliasCoverage(program: Command): AliasCoverageResult {
  const missingCommandAliases: string[] = [];
  let commandCount = 0;

  walkCommands(program, (command, path) => {
    if (path.length === 1) return;
    commandCount += 1;
    if (!hasShortCommandCoverage(command)) {
      missingCommandAliases.push(path.join(" "));
    }
  });

  const optionEntries = collectOptionAliasEntries(program);
  const missingOptionAliases = optionEntries
    .filter((entry) => entry.aliases.length === 0)
    .map((entry) => entry.canonical);
  const optionAliasCollisions = findOptionAliasCollisions(optionEntries);

  return {
    ok:
      missingCommandAliases.length === 0 &&
      missingOptionAliases.length === 0 &&
      optionAliasCollisions.length === 0,
    missingCommandAliases,
    missingOptionAliases,
    optionAliasCollisions,
    commandCount,
    optionCount: optionEntries.length,
  };
}

function walkCommands(
  command: Command,
  visit: (command: Command, path: string[]) => void,
  path: string[] = [command.name()],
): void {
  visit(command, path);
  for (const child of command.commands) {
    if (child.name() !== "help" && !child.name().startsWith("completion")) {
      walkCommands(child, visit, [...path, child.name()]);
    }
  }
}
