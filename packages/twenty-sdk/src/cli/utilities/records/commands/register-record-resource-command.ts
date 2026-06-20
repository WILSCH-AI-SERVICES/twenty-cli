import { Command } from "commander";

import { CliError } from "../../errors/cli-error";
import { parseBody } from "../../shared/body";
import { resolveOperationAlias } from "../../shared/command-aliases";
import { createCommandContext } from "../../shared/context";
import { applyGlobalOptions } from "../../shared/global-options";

interface RecordResourceCommandOptions {
  limit?: string;
  cursor?: string;
  data?: string;
  file?: string;
  set?: string[];
  totalCount?: boolean;
}

interface RegisterRecordResourceCommandOptions {
  name: string;
  description: string;
  object: string;
  operationHelp?: string;
  sanitizeOutput?: (value: unknown) => unknown;
}

const RECORD_RESOURCE_OPERATIONS = ["list", "get", "update"] as const;

export function registerRecordResourceCommand(
  program: Command,
  options: RegisterRecordResourceCommandOptions,
): void {
  const cmd = program
    .command(options.name)
    .description(options.description)
    .argument("<operation>", options.operationHelp ?? "list, get, update")
    .argument("[id]", `${resourceLabel(options.name)} ID`)
    .option("--limit <number>", `Maximum ${options.name} to list`)
    .option("--cursor <cursor>", "Pagination cursor")
    .option("--total-count", "Include totalCount in the response (slower; default false)")
    .option("-d, --data <json>", "JSON payload")
    .option("-f, --file <path>", "JSON file")
    .option("--set <key=value>", "Set a field value", collect);

  applyGlobalOptions(cmd);

  cmd.action(
    async (
      operation: string,
      id: string | undefined,
      commandOptions: RecordResourceCommandOptions,
      command: Command,
    ) => {
      const { globalOptions, services } = await createCommandContext(command);
      const op = resolveOperationAlias(operation, RECORD_RESOURCE_OPERATIONS);

      switch (op) {
        case "list": {
          const response = await services.records.list(options.object, {
            limit: commandOptions.limit ? Number.parseInt(commandOptions.limit, 10) : undefined,
            cursor: commandOptions.cursor,
            totalCount: commandOptions.totalCount === true ? true : undefined,
          });

          await services.output.render(sanitize(response.data, options.sanitizeOutput), {
            format: globalOptions.output,
            query: globalOptions.query,
          });
          break;
        }
        case "get": {
          if (!id) {
            throw new CliError(`Missing ${resourceLabel(options.name)} ID.`, "INVALID_ARGUMENTS");
          }

          const response = await services.records.get(options.object, id);
          await services.output.render(sanitize(response, options.sanitizeOutput), {
            format: globalOptions.output,
            query: globalOptions.query,
          });
          break;
        }
        case "update": {
          if (!id) {
            throw new CliError(`Missing ${resourceLabel(options.name)} ID.`, "INVALID_ARGUMENTS");
          }

          const payload = await parseBody(
            commandOptions.data,
            commandOptions.file,
            commandOptions.set,
          );
          const response = await services.records.update(options.object, id, payload);
          await services.output.render(sanitize(response, options.sanitizeOutput), {
            format: globalOptions.output,
            query: globalOptions.query,
          });
          break;
        }
        default:
          throw new CliError(`Unknown operation: ${operation}`, "INVALID_ARGUMENTS");
      }
    },
  );
}

function collect(value: string, previous: string[] = []): string[] {
  return previous.concat([value]);
}

function resourceLabel(commandName: string): string {
  return commandName.replace(/-/g, " ").replace(/s$/, "");
}

function sanitize(value: unknown, sanitizer?: (value: unknown) => unknown): unknown {
  if (!sanitizer) {
    return value;
  }

  return sanitizer(value);
}
