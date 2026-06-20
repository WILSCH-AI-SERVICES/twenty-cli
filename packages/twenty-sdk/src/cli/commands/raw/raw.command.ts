import { Command } from "commander";

import { registerGraphqlCommand } from "./graphql.command";
import { registerRestCommand } from "./rest.command";

export function registerRawCommand(program: Command): void {
  const rawCmd = program.command("raw").description("Escape-hatch raw API commands");

  registerRestCommand(rawCmd);
  registerGraphqlCommand(rawCmd);
}
