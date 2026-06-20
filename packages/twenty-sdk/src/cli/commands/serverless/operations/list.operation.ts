import { Command } from "commander";

import {
  createServerlessOperationContext,
  executeCompatibleOperation,
  LEGACY_LOGIC_FUNCTION_FIELDS,
  renderServerlessFunction,
  SERVERLESS_FUNCTION_FIELDS,
} from "../serverless.shared";

export async function runServerlessListOperation(command: Command): Promise<void> {
  const context = await createServerlessOperationContext(command);
  const result = await executeCompatibleOperation<unknown[]>(context.services, {
    current: {
      query: `query { findManyServerlessFunctions { ${SERVERLESS_FUNCTION_FIELDS} } }`,
      resultKey: "findManyServerlessFunctions",
      schemaSymbols: ["findManyServerlessFunctions"],
    },
    legacy: {
      query: `query { findManyLogicFunctions { ${LEGACY_LOGIC_FUNCTION_FIELDS} } }`,
      resultKey: "findManyLogicFunctions",
    },
  });

  await renderServerlessFunction(Array.isArray(result) ? result : [], context);
}
