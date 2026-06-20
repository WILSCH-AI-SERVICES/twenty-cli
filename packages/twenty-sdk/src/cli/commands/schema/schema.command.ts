import { Command } from "commander";

import { CliError } from "../../utilities/errors/cli-error";
import { SchemaCacheKindInput } from "../../utilities/schema/schema-cache.service";
import { createCommandContext } from "../../utilities/shared/context";
import { applyGlobalOptions } from "../../utilities/shared/global-options";

interface SchemaStatusOptions {
  ttlHours?: string;
}

export function registerSchemaCommand(program: Command): void {
  const cmd = program.command("schema").description("Manage cached Twenty discovery schemas");
  applyGlobalOptions(cmd);

  const refreshCmd = cmd
    .command("refresh")
    .description("Fetch and cache discovery schemas")
    .argument("[kind]", "Schema kind: all, core-openapi, metadata-openapi, graphql");
  applyGlobalOptions(refreshCmd);
  refreshCmd.action(async (kind: SchemaCacheKindInput | undefined, _options: unknown, command) => {
    const { globalOptions, services } = await createCommandContext(command);
    const report = await services.schemaCache.refresh({
      workspace: globalOptions.workspace,
      kind,
    });
    await services.output.render(report, {
      format: globalOptions.output,
      query: globalOptions.query,
    });
  });

  const statusCmd = cmd
    .command("status")
    .description("Show cached discovery schema status")
    .argument("[kind]", "Schema kind: all, core-openapi, metadata-openapi, graphql")
    .option("--ttl-hours <hours>", "Cache freshness window in hours");
  applyGlobalOptions(statusCmd);
  statusCmd.action(
    async (kind: SchemaCacheKindInput | undefined, options: SchemaStatusOptions, command) => {
      const { globalOptions, services } = await createCommandContext(command);
      const report = await services.schemaCache.status({
        workspace: globalOptions.workspace,
        kind,
        ttlMs: parseTtlMs(options.ttlHours),
      });
      await services.output.render(report, {
        format: globalOptions.output,
        query: globalOptions.query,
      });
    },
  );

  const clearCmd = cmd
    .command("clear")
    .description("Clear cached discovery schemas")
    .argument("[kind]", "Schema kind: all, core-openapi, metadata-openapi, graphql");
  applyGlobalOptions(clearCmd);
  clearCmd.action(async (kind: SchemaCacheKindInput | undefined, _options: unknown, command) => {
    const { globalOptions, services } = await createCommandContext(command);
    const report = await services.schemaCache.clear({
      workspace: globalOptions.workspace,
      kind,
    });
    await services.output.render(report, {
      format: globalOptions.output,
      query: globalOptions.query,
    });
  });
}

function parseTtlMs(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;

  const hours = Number(value);
  if (!Number.isFinite(hours) || hours <= 0) {
    throw new CliError("--ttl-hours must be a positive number.", "INVALID_ARGUMENTS");
  }

  return hours * 60 * 60 * 1000;
}
