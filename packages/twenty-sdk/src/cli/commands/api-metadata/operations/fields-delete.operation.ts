import { CliError } from "../../../utilities/errors/cli-error";
import { ApiMetadataContext } from "./types";

export async function runFieldsDelete(ctx: ApiMetadataContext): Promise<void> {
  const id = ctx.arg;
  if (!id) {
    throw new CliError("Missing field ID.", "INVALID_ARGUMENTS");
  }
  await ctx.services.metadata.deleteField(id);
  console.log(`Field ${id} deleted.`);
}
