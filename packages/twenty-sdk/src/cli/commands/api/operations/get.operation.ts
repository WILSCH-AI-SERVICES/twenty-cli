import { CliError } from "../../../utilities/errors/cli-error";
import { ApiOperationContext } from "./types";

export async function runGetOperation(ctx: ApiOperationContext): Promise<void> {
  const id = ctx.arg;
  if (!id) {
    throw new CliError("Missing record ID.", "INVALID_ARGUMENTS");
  }
  const record = await ctx.services.records.get(ctx.object, id, { include: ctx.options.include });
  await ctx.services.output.render(record, {
    format: ctx.globalOptions.output,
    query: ctx.globalOptions.query,
  });
}
