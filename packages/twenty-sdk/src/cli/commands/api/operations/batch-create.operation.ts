import path from "path";

import { parseArrayPayload } from "../../../utilities/shared/body";
import { ApiOperationContext } from "./types";

export async function runBatchCreateOperation(ctx: ApiOperationContext): Promise<void> {
  let records: Record<string, unknown>[] = [];
  if (ctx.options.file) {
    const ext = path.extname(ctx.options.file).toLowerCase();
    if (ext === ".csv") {
      records = await ctx.services.importer.import(ctx.options.file);
    } else {
      const payload = await parseArrayPayload(ctx.options.data, ctx.options.file);
      records = payload as Record<string, unknown>[];
    }
  } else {
    const payload = await parseArrayPayload(ctx.options.data, ctx.options.file);
    records = payload as Record<string, unknown>[];
  }

  const response = await ctx.services.records.batchCreate(ctx.object, records);
  await ctx.services.output.render(response, {
    format: ctx.globalOptions.output,
    query: ctx.globalOptions.query,
  });
}
