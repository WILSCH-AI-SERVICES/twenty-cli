import { ApiMetadataContext } from "./types";

export async function runObjectsList(ctx: ApiMetadataContext): Promise<void> {
  const objects = await ctx.services.metadata.listObjects();
  await ctx.services.output.render(objects, {
    format: ctx.globalOptions.output,
    query: ctx.globalOptions.query,
  });
}
