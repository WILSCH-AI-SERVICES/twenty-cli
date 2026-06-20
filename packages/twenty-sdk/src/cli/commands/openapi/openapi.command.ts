import { Command } from "commander";
import fs from "fs-extra";

import { CliError } from "../../utilities/errors/cli-error";
import { applyGlobalOptions, resolveGlobalOptions } from "../../utilities/shared/global-options";
import { requestPrivate } from "../../utilities/shared/request-transport";
import { createServices } from "../../utilities/shared/services";

interface OpenApiOptions {
  outputFile?: string;
}

export function registerOpenApiCommand(program: Command): void {
  const cmd = program
    .command("openapi")
    .description("Fetch OpenAPI discovery schemas")
    .argument("<target>", "Schema target: core or metadata")
    .option("--output-file <path>", "Write schema output to a file");

  applyGlobalOptions(cmd);

  cmd.action(async (target: string, options: OpenApiOptions | Command, command?: Command) => {
    const resolvedCommand = command ?? (options instanceof Command ? options : cmd);
    const rawOptions = resolvedCommand.opts() as OpenApiOptions;
    const globalOptions = resolveGlobalOptions(resolvedCommand);
    const services = await createServices(globalOptions);
    const path = normalizeOpenApiTarget(target);

    const response = await requestPrivate(services, {
      method: "get",
      url: path,
    });

    if (rawOptions.outputFile) {
      await fs.writeFile(rawOptions.outputFile, JSON.stringify(response.data, null, 2));
      // eslint-disable-next-line no-console
      console.error(`Wrote OpenAPI schema to ${rawOptions.outputFile}`);
      return;
    }

    await services.output.render(response.data, {
      format: globalOptions.output,
      query: globalOptions.query,
    });
  });
}

function normalizeOpenApiTarget(target: string): string {
  const normalized = target.toLowerCase();

  switch (normalized) {
    case "core":
      return "/rest/open-api/core";
    case "metadata":
      return "/rest/open-api/metadata";
    default:
      throw new CliError(
        `Unknown OpenAPI schema target ${JSON.stringify(target)}.`,
        "INVALID_ARGUMENTS",
      );
  }
}
