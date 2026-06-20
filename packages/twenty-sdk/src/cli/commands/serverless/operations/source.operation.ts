import { Command } from "commander";

import { CliError } from "../../../utilities/errors/cli-error";
import {
  createServerlessOperationContext,
  executeCompatibleOperation,
  renderServerlessFunction,
} from "../serverless.shared";

export async function runServerlessSourceOperation(
  id: string | undefined,
  command: Command,
): Promise<void> {
  if (!id) {
    throw new CliError("Missing function ID.", "INVALID_ARGUMENTS");
  }

  const context = await createServerlessOperationContext(command);
  const sourceCode = await executeCompatibleOperation<string | null>(context.services, {
    current: {
      query: `query($input: GetServerlessFunctionSourceCodeInput!) { getServerlessFunctionSourceCode(input: $input) }`,
      variables: { input: { id } },
      resultKey: "getServerlessFunctionSourceCode",
      schemaSymbols: ["getServerlessFunctionSourceCode", "GetServerlessFunctionSourceCodeInput"],
    },
    legacy: {
      query: `query($input: LogicFunctionIdInput!) { getLogicFunctionSourceCode(input: $input) }`,
      variables: { input: { id } },
      resultKey: "getLogicFunctionSourceCode",
    },
  });

  if (context.globalOptions.output === "json" || context.globalOptions.output === "csv") {
    await renderServerlessFunction({ sourceCode: sourceCode ?? "" }, context);
    return;
  }

  // eslint-disable-next-line no-console
  console.log(sourceCode ?? "");
}
