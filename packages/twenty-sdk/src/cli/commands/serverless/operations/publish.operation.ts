import { Command } from "commander";

import { CliError } from "../../../utilities/errors/cli-error";
import {
  createServerlessOperationContext,
  executeCompatibleOperation,
  renderServerlessFunction,
  SERVERLESS_FUNCTION_FIELDS,
} from "../serverless.shared";

export async function runServerlessPublishOperation(
  id: string | undefined,
  command: Command,
): Promise<void> {
  if (!id) {
    throw new CliError("Missing function ID.", "INVALID_ARGUMENTS");
  }

  const context = await createServerlessOperationContext(command);
  const result = await executeCompatibleOperation<unknown>(context.services, {
    current: {
      query: `mutation($input: PublishServerlessFunctionInput!) { publishServerlessFunction(input: $input) { ${SERVERLESS_FUNCTION_FIELDS} } }`,
      variables: { input: { id } },
      resultKey: "publishServerlessFunction",
      schemaSymbols: ["publishServerlessFunction", "PublishServerlessFunctionInput"],
    },
    unavailableOnLegacyMessage:
      "Publish is not available on this workspace because it still exposes the legacy LogicFunction schema.",
  });

  await renderServerlessFunction(result, context);
}
