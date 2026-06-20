import { ApiMetadataContext } from "./types";

export async function runFieldsList(ctx: ApiMetadataContext): Promise<void> {
  let fields: unknown[];

  if (ctx.options.object) {
    // Get fields directly from the object metadata (matches Go CLI behavior)
    const obj = await ctx.services.metadata.getObject(ctx.options.object);
    fields = obj.fields ?? [];
  } else {
    // List all fields across all objects
    fields = await ctx.services.metadata.listFields();
  }

  await ctx.services.output.render(fields, {
    format: ctx.globalOptions.output,
    query: ctx.globalOptions.query,
  });
}
