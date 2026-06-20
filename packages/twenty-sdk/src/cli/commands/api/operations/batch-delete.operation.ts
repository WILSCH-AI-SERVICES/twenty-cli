import { CliError } from "../../../utilities/errors/cli-error";
import { requireYes } from "../../../utilities/shared/confirmation";
import { readJsonInput } from "../../../utilities/shared/io";
import { ApiOperationContext } from "./types";

export async function runBatchDeleteOperation(ctx: ApiOperationContext): Promise<void> {
  requireYes(ctx.options, "Batch delete");

  let ids: string[] = [];

  if (ctx.options.ids) {
    ids = ctx.options.ids
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);
  } else {
    const payload = await readJsonInput(ctx.options.data, ctx.options.file);
    if (!payload) {
      throw new CliError(
        "Missing JSON payload; use --data, --file, or --ids.",
        "INVALID_ARGUMENTS",
      );
    }
    if (!Array.isArray(payload)) {
      throw new CliError("Batch payload must be a JSON array.", "INVALID_ARGUMENTS");
    }
    ids = payload.map((value) => String(value));
  }

  if (ids.length === 0) {
    throw new CliError("No valid IDs provided.", "INVALID_ARGUMENTS");
  }

  const response = await ctx.services.records.batchDelete(ctx.object, ids);
  await ctx.services.output.render(response, {
    format: ctx.globalOptions.output,
    query: ctx.globalOptions.query,
  });
}
