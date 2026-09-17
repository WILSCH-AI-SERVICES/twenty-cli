import { writeFileSync } from "node:fs";

import { Command } from "commander";

import { createCommandContext } from "../../utilities/shared/context";
import { applyGlobalOptions } from "../../utilities/shared/global-options";
import { runConfigExport } from "./config-export.service";

interface ConfigExportOptions {
  outputFile?: string;
}

export function registerConfigCommand(program: Command): void {
  const config = program.command("config").description("Workspace configuration as text");
  applyGlobalOptions(config);

  const exportCommand = config
    .command("export")
    .description(
      "Read the workspace configuration back out as text: objects with their fields, views with their fields, filters, groups and sorts, and roles with their permissions",
    )
    .option("--output-file <path>", "Write the export to this file instead of stdout");
  applyGlobalOptions(exportCommand);

  exportCommand.action(async (_options: unknown, command: Command) => {
    const { services } = await createCommandContext(command);
    const options = command.opts() as ConfigExportOptions;
    const { document, text } = await runConfigExport(services.api);

    // Always the same text, whatever -o says: the export is a document, not a rendering.
    // Its byte-identity across runs is the point, so nothing between the serialisation and
    // the file descriptor is allowed to touch it.
    if (options.outputFile) {
      writeFileSync(options.outputFile, text);
      process.stderr.write(
        `config export: ${Buffer.byteLength(text)} bytes (${document.carries.objects} objects, ${document.carries.fields} fields, ${document.carries.views} views, ${document.carries.roles} roles) written to ${options.outputFile}\n`,
      );
      return;
    }

    process.stdout.write(text);
  });
}
