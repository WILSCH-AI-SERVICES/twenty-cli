import { Command } from "commander";

export function registerCommand(
  parent: Command,
  name: string,
  description: string,
  configure: (command: Command) => void,
): Command {
  const command = parent.command(name).description(description);
  configure(command);

  return command;
}
