import { CliError } from "../../../utilities/errors/cli-error";
import {
  DEFAULT_ALL_PAGE_SIZE,
  DEFAULT_FILE_EXPORT_MAX_RECORDS,
  DEFAULT_LIST_MAX_RECORDS,
  MAX_EXPLICIT_RECORDS,
  parseMaxRecords,
  parseRecordPageSize,
} from "../../../utilities/records/record-bounds";
import type { ListOptions } from "../../../utilities/records/services/records.service";
import { parseKeyValuePairs } from "../../../utilities/shared/parse";
import { ApiOperationContext } from "./types";

const OUTPUT_FORMATS = new Set(["json", "csv", "text"]);

export async function runExportOperation(ctx: ApiOperationContext): Promise<void> {
  const format = (ctx.options.format ?? "json").toLowerCase();
  if (format !== "json" && format !== "csv") {
    throw new CliError(`Unsupported export format ${JSON.stringify(format)}.`, "INVALID_ARGUMENTS");
  }
  if (ctx.options.fields) {
    throw new CliError(
      "--fields is not supported for export. Twenty REST find-many only supports depth-based field expansion.",
      "INVALID_ARGUMENTS",
    );
  }

  const params = parseKeyValuePairs(ctx.options.param);
  let outputFile = ctx.options.outputFile;
  if (!outputFile && ctx.options.output && !OUTPUT_FORMATS.has(ctx.options.output)) {
    outputFile = ctx.options.output;
  }

  const shouldAll = ctx.options.all === true;
  const limit = parseRecordPageSize(ctx.options.limit, DEFAULT_ALL_PAGE_SIZE);
  const maxRecords = shouldAll
    ? parseMaxRecords(
        ctx.options.maxRecords,
        outputFile ? DEFAULT_FILE_EXPORT_MAX_RECORDS : DEFAULT_LIST_MAX_RECORDS,
      )
    : undefined;
  const listOptions: ListOptions = {
    limit,
    cursor: ctx.options.cursor,
    filter: ctx.options.filter,
    include: ctx.options.include,
    sort: ctx.options.sort,
    order: ctx.options.order,
    params,
  };
  if (maxRecords !== undefined) {
    listOptions.maxRecords = maxRecords;
    listOptions.maxRecordsErrorMessage = `api export --all exceeded --max-records ${maxRecords}. Re-run with --max-records <n> up to ${MAX_EXPLICIT_RECORDS} or add a filter.`;
  }

  const response = shouldAll
    ? await ctx.services.records.listAll(ctx.object, listOptions)
    : await ctx.services.records.list(ctx.object, listOptions);

  await ctx.services.exporter.export(response.data as Record<string, unknown>[], {
    format: format as "json" | "csv",
    output: outputFile,
  });
}
