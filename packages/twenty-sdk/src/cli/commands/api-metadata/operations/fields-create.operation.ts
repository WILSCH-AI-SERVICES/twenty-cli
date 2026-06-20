import { parseBody } from "../../../utilities/shared/body";
import { ApiMetadataContext } from "./types";

export async function runFieldsCreate(ctx: ApiMetadataContext): Promise<void> {
  const payload = await parseBody(ctx.options.data, ctx.options.file);
  const response = await ctx.services.metadata.createField(payload);
  await ctx.services.output.render(response, {
    format: ctx.globalOptions.output,
    query: ctx.globalOptions.query,
  });
}
