import { CliError } from "../../../utilities/errors/cli-error";
import { requireYes } from "../../../utilities/shared/confirmation";
import { ApiOperationContext } from "./types";

export async function runDeleteOperation(ctx: ApiOperationContext): Promise<void> {
  const id = ctx.arg;
  if (!id) {
    throw new CliError("Missing record ID.", "INVALID_ARGUMENTS");
  }
  requireYes(ctx.options, "Delete");

  const response = await ctx.services.records.delete(ctx.object, id);
  if (response == null || (typeof response === "string" && response === "")) {
    // eslint-disable-next-line no-console
    console.log(`Deleted ${ctx.object} ${id}`);
    return;
  }
  await ctx.services.output.render(response, {
    format: ctx.globalOptions.output,
    query: ctx.globalOptions.query,
  });
}
