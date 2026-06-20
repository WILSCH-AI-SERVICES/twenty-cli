import { CliError } from "../../../utilities/errors/cli-error";
import { readJsonInput } from "../../../utilities/shared/io";
import { ApiOperationContext } from "./types";

export async function runMergeOperation(ctx: ApiOperationContext): Promise<void> {
  let payload: Record<string, unknown> | undefined;

  const parsedPriority = ctx.options.priority ? Number(ctx.options.priority) : 0;
  const priority = Number.isNaN(parsedPriority) ? 0 : parsedPriority;

  if (ctx.options.source || ctx.options.target) {
    if (!ctx.options.source || !ctx.options.target) {
      throw new CliError("Both --source and --target are required for merge.", "INVALID_ARGUMENTS");
    }
    payload = {
      ids: [ctx.options.source, ctx.options.target],
      conflictPriorityIndex: priority,
    };
  } else if (ctx.options.ids) {
    const ids = ctx.options.ids
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);
    if (ids.length === 0) {
      throw new CliError("No valid IDs provided for merge.", "INVALID_ARGUMENTS");
    }
    payload = {
      ids,
      conflictPriorityIndex: priority,
    };
  } else if (ctx.options.data || ctx.options.file) {
    const raw = await readJsonInput(ctx.options.data, ctx.options.file);
    if (!raw || typeof raw !== "object") {
      throw new CliError("Invalid merge payload.", "INVALID_ARGUMENTS");
    }
    payload = raw as Record<string, unknown>;
  }

  if (!payload) {
    throw new CliError(
      "Missing payload; use --ids, --source/--target, --data, or --file.",
      "INVALID_ARGUMENTS",
    );
  }

  if (ctx.options.dryRun) {
    payload.dryRun = true;
  }

  const response = await ctx.services.records.merge(ctx.object, payload);
  await ctx.services.output.render(response, {
    format: ctx.globalOptions.output,
    query: ctx.globalOptions.query,
  });
}
