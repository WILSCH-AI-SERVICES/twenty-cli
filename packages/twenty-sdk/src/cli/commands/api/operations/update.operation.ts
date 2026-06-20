import { CliError } from "../../../utilities/errors/cli-error";
import { parseBody } from "../../../utilities/shared/body";
import { ApiOperationContext } from "./types";

export async function runUpdateOperation(ctx: ApiOperationContext): Promise<void> {
  const id = ctx.arg;
  if (!id) {
    throw new CliError("Missing record ID.", "INVALID_ARGUMENTS");
  }
  const payload = await parseBody(ctx.options.data, ctx.options.file, ctx.options.set);
  const record = await ctx.services.records.update(ctx.object, id, payload);
  await ctx.services.output.render(record, {
    format: ctx.globalOptions.output,
    query: ctx.globalOptions.query,
  });
}
