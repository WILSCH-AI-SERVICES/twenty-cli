import { CliError } from "../../../utilities/errors/cli-error";
import { parseBody } from "../../../utilities/shared/body";
import { ApiMetadataContext } from "./types";

export async function runFieldsUpdate(ctx: ApiMetadataContext): Promise<void> {
  const id = ctx.arg;
  if (!id) {
    throw new CliError("Missing field ID.", "INVALID_ARGUMENTS");
  }
  const payload = await parseBody(ctx.options.data, ctx.options.file);
  const result = await ctx.services.metadata.updateField(id, payload as Record<string, unknown>);
  await ctx.services.output.render(result, {
    format: ctx.globalOptions.output,
    query: ctx.globalOptions.query,
  });
}
