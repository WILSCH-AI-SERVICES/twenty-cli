import { Command } from "commander";

import { CliError } from "../../../utilities/errors/cli-error";
import { requireYes } from "../../../utilities/shared/confirmation";
import { createServerlessOperationContext, executeCompatibleOperation } from "../serverless.shared";

export async function runServerlessDeleteOperation(
  id: string | undefined,
  command: Command,
): Promise<void> {
  if (!id) {
    throw new CliError("Missing function ID.", "INVALID_ARGUMENTS");
  }

  const context = await createServerlessOperationContext(command);
  requireYes(context.options, "Delete");

  await executeCompatibleOperation<unknown>(context.services, {
    current: {
      query: `mutation($input: ServerlessFunctionIdInput!) { deleteOneServerlessFunction(input: $input) { id } }`,
      variables: { input: { id } },
      resultKey: "deleteOneServerlessFunction",
      schemaSymbols: ["deleteOneServerlessFunction", "ServerlessFunctionIdInput"],
    },
    legacy: {
      query: `mutation($input: LogicFunctionIdInput!) { deleteOneLogicFunction(input: $input) { id } }`,
      variables: { input: { id } },
      resultKey: "deleteOneLogicFunction",
    },
  });

  // eslint-disable-next-line no-console
  console.log(`Serverless function ${id} deleted.`);
}
