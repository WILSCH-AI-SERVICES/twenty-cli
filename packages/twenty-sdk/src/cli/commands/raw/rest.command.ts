import { Command } from "commander";

import { applyGlobalOptions, resolveGlobalOptions } from "../../utilities/shared/global-options";
import { readJsonInput } from "../../utilities/shared/io";
import { parseKeyValuePairs } from "../../utilities/shared/parse";
import { createServices } from "../../utilities/shared/services";

export function registerRestCommand(parent: Command): void {
  const cmd = parent
    .command("rest")
    .description("Raw REST API access")
    .argument("<method>", "HTTP method")
    .argument("<path>", "REST path")
    .option("-d, --data <json>", "JSON payload")
    .option("-f, --file <path>", "JSON file payload (use - for stdin)")
    .option("--param <key=value>", "Query param", collect);

  applyGlobalOptions(cmd);

  cmd.action(
    async (
      method: string,
      path: string,
      options: { data?: string; file?: string; param?: string[] } | Command,
      command?: Command,
    ) => {
      const resolvedCommand = command ?? (options instanceof Command ? options : cmd);
      const globalOptions = resolveGlobalOptions(resolvedCommand);
      const services = await createServices(globalOptions);

      const rawOptions = resolvedCommand.opts() as {
        data?: string;
        file?: string;
        param?: string[];
      };
      const payload = await readJsonInput(rawOptions.data, rawOptions.file);
      const params = normalizeQueryParams(parseKeyValuePairs(rawOptions.param));
      const url = path.startsWith("/") ? path : `/${path}`;

      const response = await services.api.request({
        method: method.toLowerCase(),
        url,
        params: Object.keys(params).length ? params : undefined,
        data: payload,
      });

      await services.output.render(response.data, {
        format: globalOptions.output,
        query: globalOptions.query,
      });
    },
  );
}

function collect(value: string, previous: string[] = []): string[] {
  return previous.concat([value]);
}

function normalizeQueryParams(params: Record<string, string[]>): Record<string, string | string[]> {
  const normalized: Record<string, string | string[]> = {};

  for (const [key, values] of Object.entries(params)) {
    if (values.length === 0) continue;
    normalized[key] = values.length === 1 ? values[0]! : values;
  }

  return normalized;
}
