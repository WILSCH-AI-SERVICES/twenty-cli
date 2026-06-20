import { CliError } from "../../../utilities/errors/cli-error";
import {
  DEFAULT_ALL_PAGE_SIZE,
  DEFAULT_LIST_MAX_RECORDS,
  MAX_EXPLICIT_RECORDS,
  parseMaxRecords,
  parseRecordPageSize,
} from "../../../utilities/records/record-bounds";
import type { ListOptions } from "../../../utilities/records/services/records.service";
import { parseKeyValuePairs } from "../../../utilities/shared/parse";
import { ApiOperationContext } from "./types";

export async function runListOperation(ctx: ApiOperationContext): Promise<void> {
  const { services, globalOptions } = ctx;
  if (ctx.options.fields) {
    throw new CliError(
      "--fields is not supported for list. Twenty REST find-many only supports depth-based field expansion.",
      "INVALID_ARGUMENTS",
    );
  }

  const limit = parseRecordPageSize(
    ctx.options.limit,
    ctx.options.all ? DEFAULT_ALL_PAGE_SIZE : undefined,
  );
  const maxRecords = ctx.options.all
    ? parseMaxRecords(ctx.options.maxRecords, DEFAULT_LIST_MAX_RECORDS)
    : undefined;
  const params = parseKeyValuePairs(ctx.options.param);

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
    listOptions.maxRecordsErrorMessage = `api list --all exceeded --max-records ${maxRecords}. Re-run with --max-records <n> up to ${MAX_EXPLICIT_RECORDS} or add a filter.`;
  }

  const result = ctx.options.all
    ? await services.records.listAll(ctx.object, listOptions)
    : await services.records.list(ctx.object, listOptions);

  await services.output.render(result.data, {
    format: globalOptions.output,
    query: globalOptions.query,
  });
}
