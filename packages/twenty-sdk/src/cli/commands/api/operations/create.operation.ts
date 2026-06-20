import { parseBody } from "../../../utilities/shared/body";
import { ApiOperationContext } from "./types";

export async function runCreateOperation(ctx: ApiOperationContext): Promise<void> {
  const payload = await parseBody(ctx.options.data, ctx.options.file, ctx.options.set);
  const record = await ctx.services.records.create(ctx.object, payload);
  await ctx.services.output.render(record, {
    format: ctx.globalOptions.output,
    query: ctx.globalOptions.query,
  });
}
