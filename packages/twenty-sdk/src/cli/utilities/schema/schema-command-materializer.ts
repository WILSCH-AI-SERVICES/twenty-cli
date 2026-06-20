import { Command } from "commander";

import { applyGlobalOptions } from "../shared/global-options";
import { readCachedSchemaEntries } from "./schema-cache-reader";
import { SchemaCacheEntry } from "./schema-cache.service";
import { runMetadataOperation, runRecordOperation } from "./schema-command-runners";
import { extractCoreRecordResources, extractMetadataResources } from "./schema-openapi-resources";

export { extractCoreRecordResources, extractMetadataResources } from "./schema-openapi-resources";

export type DynamicRecordOperation =
  | "batch-create"
  | "batch-delete"
  | "batch-update"
  | "create"
  | "delete"
  | "destroy"
  | "find-duplicates"
  | "get"
  | "group-by"
  | "list"
  | "merge"
  | "restore"
  | "update";

export type DynamicMetadataOperation = "create" | "delete" | "get" | "list" | "update";

export interface DynamicResource<TOperation extends string> {
  apiName: string;
  operations: TOperation[];
}

export interface CachedSchemaCommandEntries {
  coreOpenApi?: SchemaCacheEntry;
  metadataOpenApi?: SchemaCacheEntry;
}

interface DynamicCommandOptions {
  limit?: string;
  cursor?: string;
  filter?: string;
  sort?: string;
  order?: string;
  include?: string;
  data?: string;
  file?: string;
  set?: string[];
  ids?: string;
  field?: string;
  object?: string;
  view?: string;
  yes?: boolean;
  totalCount?: boolean;
}

export function registerCachedSchemaCommands(
  program: Command,
  entries?: CachedSchemaCommandEntries,
): void {
  const cachedEntries = entries ?? safeReadCachedSchemaEntries();
  const records = program.command("records").description("Cache-backed record commands");
  applyGlobalOptions(records);

  for (const resource of extractCoreRecordResources(cachedEntries.coreOpenApi?.schema)) {
    registerRecordResource(records, resource);
  }

  const metadata = program.command("metadata").description("Cache-backed metadata commands");
  applyGlobalOptions(metadata);

  for (const resource of extractMetadataResources(cachedEntries.metadataOpenApi?.schema)) {
    registerMetadataResource(metadata, resource);
  }
}

function safeReadCachedSchemaEntries(): CachedSchemaCommandEntries {
  try {
    return readCachedSchemaEntries();
  } catch {
    return {};
  }
}

function registerRecordResource(
  parent: Command,
  resource: DynamicResource<DynamicRecordOperation>,
): void {
  const commandName = toKebabCase(resource.apiName);
  const command = parent
    .command(commandName)
    .description(`Cached record commands for ${commandName}`);
  applyGlobalOptions(command);

  for (const operation of resource.operations) {
    const operationCommand = command
      .command(operation)
      .description(recordOperationSummary(operation, commandName));
    applyRecordOptions(operationCommand);
    if (isDestructiveRecordOperation(operation)) {
      applyRecordDestructiveOptions(operationCommand);
    }
    if (operationNeedsId(operation)) {
      operationCommand.argument("[id]", "Record ID");
    }
    applyGlobalOptions(operationCommand);
    operationCommand.action(
      async (
        idOrOptions: string | DynamicCommandOptions | undefined,
        maybeOptions?: DynamicCommandOptions | Command,
        maybeCommand?: Command,
      ) => {
        const id = typeof idOrOptions === "string" ? idOrOptions : undefined;
        const actionCommand =
          maybeCommand ?? (maybeOptions instanceof Command ? maybeOptions : operationCommand);
        await runRecordOperation(actionCommand, resource.apiName, operation, id);
      },
    );
  }
}

function registerMetadataResource(
  parent: Command,
  resource: DynamicResource<DynamicMetadataOperation>,
): void {
  const commandName = toKebabCase(resource.apiName);
  const command = parent
    .command(commandName)
    .description(`Cached metadata commands for ${commandName}`);
  applyGlobalOptions(command);

  for (const operation of resource.operations) {
    const operationCommand = command
      .command(operation)
      .description(metadataOperationSummary(operation, commandName));
    applyMetadataOptions(operationCommand);
    if (operation !== "list" && operation !== "create") {
      operationCommand.argument("[id]", "Identifier");
    }
    applyGlobalOptions(operationCommand);
    operationCommand.action(
      async (
        idOrOptions: string | DynamicCommandOptions | undefined,
        maybeOptions?: DynamicCommandOptions | Command,
        maybeCommand?: Command,
      ) => {
        const id = typeof idOrOptions === "string" ? idOrOptions : undefined;
        const actionCommand =
          maybeCommand ?? (maybeOptions instanceof Command ? maybeOptions : operationCommand);
        await runMetadataOperation(actionCommand, resource.apiName, operation, id);
      },
    );
  }
}

function applyRecordOptions(command: Command): void {
  command
    .option("--limit <number>", "Limit number of records")
    .option("--cursor <cursor>", "Pagination cursor")
    .option("--filter <expression>", "Filter expression")
    .option("--sort <field>", "Sort field")
    .option("--order <direction>", "Sort order (asc or desc)")
    .option("--include <relations>", "Include related records")
    .option("--total-count", "Include totalCount in the response (slower; default false)")
    .option("-d, --data <json>", "JSON payload")
    .option("-f, --file <path>", "JSON file")
    .option("--set <key=value>", "Set a field value", collect)
    .option("--ids <ids>", "Comma-separated IDs")
    .option("--field <field>", "Group-by field")
    .option("--concurrency <number>", "Concurrent batch-update requests");
}

function applyRecordDestructiveOptions(command: Command): void {
  command.option("--yes", "Confirm destructive operations");
}

function applyMetadataOptions(command: Command): void {
  command
    .option("-d, --data <json>", "JSON payload")
    .option("-f, --file <path>", "JSON file")
    .option("--set <key=value>", "Set a field value", collect)
    .option("--object <nameOrId>", "Filter by object name or metadata ID")
    .option("--view <id>", "Filter by view ID");
}

function operationNeedsId(operation: DynamicRecordOperation): boolean {
  return (
    operation === "get" ||
    operation === "update" ||
    operation === "delete" ||
    operation === "destroy" ||
    operation === "restore"
  );
}

function isDestructiveRecordOperation(operation: DynamicRecordOperation): boolean {
  return operation === "delete" || operation === "destroy" || operation === "batch-delete";
}

function recordOperationSummary(operation: DynamicRecordOperation, resource: string): string {
  return `${capitalize(operation.replace(/-/g, " "))} ${resource}`;
}

function metadataOperationSummary(operation: DynamicMetadataOperation, resource: string): string {
  return `${capitalize(operation)} ${resource}`;
}

function collect(value: string, previous: string[] = []): string[] {
  return previous.concat([value]);
}

function toKebabCase(value: string): string {
  return value
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2")
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[_\s]+/g, "-")
    .toLowerCase();
}

function capitalize(value: string): string {
  return value.length === 0 ? value : `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}
