import { Command } from "commander";

import { OutputService } from "../output/services/output.service";
import { GlobalOptions, resolveGlobalOptions } from "./global-options";
import { CliServices, createOutputService, createServices } from "./services";

export interface CommandContext {
  globalOptions: GlobalOptions;
  services: CliServices;
}

export interface OutputContext {
  globalOptions: GlobalOptions;
  output: OutputService;
}

export async function createCommandContext(
  command: Command,
  overrides?: Parameters<typeof resolveGlobalOptions>[1],
): Promise<CommandContext> {
  const globalOptions = resolveGlobalOptions(command, overrides);
  const services = await createServices(globalOptions);

  return {
    globalOptions,
    services,
  };
}

export function createOutputContext(
  command: Command,
  overrides?: Parameters<typeof resolveGlobalOptions>[1],
): OutputContext {
  const globalOptions = resolveGlobalOptions(command, overrides);

  return {
    globalOptions,
    output: createOutputService(globalOptions),
  };
}
