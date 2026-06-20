import { Command } from "commander";

import {
  buildCreateInput,
  createServerlessOperationContext,
  executeCompatibleOperation,
  LEGACY_LOGIC_FUNCTION_FIELDS,
  renderServerlessFunction,
  SERVERLESS_FUNCTION_FIELDS,
} from "../serverless.shared";

export async function runServerlessCreateOperation(command: Command): Promise<void> {
  const context = await createServerlessOperationContext(command);
  const currentInput = await buildCreateInput(context.options, "current");
  const result = await executeCompatibleOperation<unknown>(context.services, {
    current: {
      query: `mutation($input: CreateServerlessFunctionInput!) { createOneServerlessFunction(input: $input) { ${SERVERLESS_FUNCTION_FIELDS} } }`,
      variables: { input: currentInput },
      resultKey: "createOneServerlessFunction",
      schemaSymbols: ["createOneServerlessFunction", "CreateServerlessFunctionInput"],
    },
    legacy: {
      query: `mutation($input: CreateLogicFunctionFromSourceInput!) { createOneLogicFunction(input: $input) { ${LEGACY_LOGIC_FUNCTION_FIELDS} } }`,
      variables: { input: await buildCreateInput(context.options, "legacy") },
      resultKey: "createOneLogicFunction",
    },
  });

  await renderServerlessFunction(result, context);
}
