import { CliError } from "../../../utilities/errors/cli-error";
import { readJsonInput } from "../../../utilities/shared/io";
import { ApiOperationContext } from "./types";

export async function runFindDuplicatesOperation(ctx: ApiOperationContext): Promise<void> {
  let payload: unknown | undefined;

  if (ctx.options.data || ctx.options.file) {
    payload = await readJsonInput(ctx.options.data, ctx.options.file);
  } else if (ctx.options.ids) {
    const ids = ctx.options.ids
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);

    payload = { ids };
  } else if (ctx.options.fields) {
    throw new CliError(
      "Field-only duplicate detection is not supported by the current Twenty REST API.",
      "INVALID_ARGUMENTS",
      'Use --ids "record_1,record_2" or --data \'{"data":[{...}]}\'.',
    );
  }

  if (!payload) {
    throw new CliError(
      "Missing payload for find-duplicates.",
      "INVALID_ARGUMENTS",
      'Use --ids "record_1,record_2" or --data \'{"ids":["record_1"]}\' / \'{"data":[{...}]}\'.',
    );
  }

  if (typeof payload !== "object" || Array.isArray(payload)) {
    throw new CliError(
      "Find-duplicates payload must be a JSON object.",
      "INVALID_ARGUMENTS",
      'Use --data \'{"ids":["record_1"]}\' or --data \'{"data":[{...}]}\'.',
    );
  }

  const response = await ctx.services.records.findDuplicates(ctx.object, payload);
  await ctx.services.output.render(response, {
    format: ctx.globalOptions.output,
    query: ctx.globalOptions.query,
  });
}
