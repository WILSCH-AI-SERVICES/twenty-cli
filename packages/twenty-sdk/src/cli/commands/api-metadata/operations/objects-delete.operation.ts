import { CliError } from "../../../utilities/errors/cli-error";
import { ApiMetadataContext } from "./types";

export async function runObjectsDelete(ctx: ApiMetadataContext): Promise<void> {
  const id = ctx.arg;
  if (!id) {
    throw new CliError("Missing object ID.", "INVALID_ARGUMENTS");
  }
  await ctx.services.metadata.deleteObject(id);
  console.log(`Object ${id} deleted.`);
}
