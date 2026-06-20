import { Command } from "commander";

import { CliError } from "../../../utilities/errors/cli-error";
import {
  buildExecutePayload,
  createServerlessOperationContext,
  executeCompatibleOperation,
  renderServerlessFunction,
} from "../serverless.shared";

export async function runServerlessExecuteOperation(
  id: string | undefined,
  command: Command,
): Promise<void> {
  if (!id) {
    throw new CliError("Missing function ID.", "INVALID_ARGUMENTS");
  }

  const context = await createServerlessOperationContext(command);
  const payload = await buildExecutePayload(context.options);
  const result = await executeCompatibleOperation<unknown>(context.services, {
    current: {
      query: `mutation($input: ExecuteServerlessFunctionInput!) { executeOneServerlessFunction(input: $input) { data logs duration status error } }`,
      variables: { input: { id, payload } },
      resultKey: "executeOneServerlessFunction",
      schemaSymbols: ["executeOneServerlessFunction", "ExecuteServerlessFunctionInput"],
    },
    legacy: {
      query: `mutation($input: ExecuteOneLogicFunctionInput!) { executeOneLogicFunction(input: $input) { data logs duration status error } }`,
      variables: { input: { id, payload } },
      resultKey: "executeOneLogicFunction",
    },
  });

  await renderServerlessFunction(result, context);
}
