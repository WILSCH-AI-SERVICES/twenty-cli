import { CliError } from "../../../utilities/errors/cli-error";
import { resolveBulkFilter } from "./bulk-filter";
import { ApiOperationContext } from "./types";

export async function runRestoreOperation(ctx: ApiOperationContext): Promise<void> {
  const id = ctx.arg;
  if (id) {
    const response = await ctx.services.records.restore(ctx.object, id);
    await ctx.services.output.render(response, {
      format: ctx.globalOptions.output,
      query: ctx.globalOptions.query,
    });
    return;
  }

  if (!ctx.options.filter && !ctx.options.ids) {
    throw new CliError("Missing record ID.", "INVALID_ARGUMENTS");
  }

  const filter = resolveBulkFilter(ctx.options);
  const response = await ctx.services.records.restoreMany(ctx.object, { filter });
  await ctx.services.output.render(response, {
    format: ctx.globalOptions.output,
    query: ctx.globalOptions.query,
  });
}
