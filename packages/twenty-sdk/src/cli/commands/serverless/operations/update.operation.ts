import { Command } from "commander";

import { CliError } from "../../../utilities/errors/cli-error";
import {
  buildUpdateInput,
  createServerlessOperationContext,
  executeCompatibleOperation,
  renderServerlessFunction,
  SERVERLESS_FUNCTION_FIELDS,
} from "../serverless.shared";

export async function runServerlessUpdateOperation(
  id: string | undefined,
  command: Command,
): Promise<void> {
  if (!id) {
    throw new CliError("Missing function ID.", "INVALID_ARGUMENTS");
  }

  const context = await createServerlessOperationContext(command);
  const currentInput = await buildUpdateInput(id, context.options, "current");
  const result = await executeCompatibleOperation<unknown>(context.services, {
    current: {
      query: `mutation($input: UpdateServerlessFunctionInput!) { updateOneServerlessFunction(input: $input) { ${SERVERLESS_FUNCTION_FIELDS} } }`,
      variables: { input: currentInput },
      resultKey: "updateOneServerlessFunction",
      schemaSymbols: ["updateOneServerlessFunction", "UpdateServerlessFunctionInput"],
    },
    legacy: {
      query: `mutation($input: UpdateLogicFunctionFromSourceInput!) { updateOneLogicFunction(input: $input) }`,
      variables: { input: await buildUpdateInput(id, context.options, "legacy") },
      resultKey: "updateOneLogicFunction",
    },
  });

  await renderServerlessFunction(
    {
      id,
      updated: Boolean(result),
    },
    context,
  );
}
