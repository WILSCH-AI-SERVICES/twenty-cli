import { Command } from "commander";

import { CliError } from "../../../utilities/errors/cli-error";
import {
  createServerlessOperationContext,
  executeCompatibleOperation,
  LEGACY_LOGIC_FUNCTION_FIELDS,
  renderServerlessFunction,
  SERVERLESS_FUNCTION_FIELDS,
} from "../serverless.shared";

export async function runServerlessGetOperation(
  id: string | undefined,
  command: Command,
): Promise<void> {
  if (!id) {
    throw new CliError("Missing function ID.", "INVALID_ARGUMENTS");
  }

  const context = await createServerlessOperationContext(command);
  const result = await executeCompatibleOperation<unknown>(context.services, {
    current: {
      query: `query($input: ServerlessFunctionIdInput!) { findOneServerlessFunction(input: $input) { ${SERVERLESS_FUNCTION_FIELDS} } }`,
      variables: { input: { id } },
      resultKey: "findOneServerlessFunction",
      schemaSymbols: ["findOneServerlessFunction", "ServerlessFunctionIdInput"],
    },
    legacy: {
      query: `query($input: LogicFunctionIdInput!) { findOneLogicFunction(input: $input) { ${LEGACY_LOGIC_FUNCTION_FIELDS} } }`,
      variables: { input: { id } },
      resultKey: "findOneLogicFunction",
    },
  });

  await renderServerlessFunction(result, context);
}
