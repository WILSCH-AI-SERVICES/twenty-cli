import { CliError } from "../../../utilities/errors/cli-error";
import { ApiCommandOptions } from "./types";

export function resolveBulkFilter(options: ApiCommandOptions): string {
  if (options.filter?.trim()) {
    return options.filter.trim();
  }

  const ids = parseIds(options.ids);
  if (ids.length > 0) {
    return `id[in]:[${ids.join(",")}]`;
  }

  throw new CliError("Missing record ID.", "INVALID_ARGUMENTS");
}

function parseIds(rawIds: string | undefined): string[] {
  if (!rawIds) {
    return [];
  }

  return rawIds
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
}
