import { Command } from "commander";

import {
  buildCreateLayerInput,
  createServerlessOperationContext,
  executeCompatibleOperation,
  renderServerlessFunction,
} from "../serverless.shared";

export async function runServerlessCreateLayerOperation(command: Command): Promise<void> {
  const context = await createServerlessOperationContext(command);
  const input = await buildCreateLayerInput(context.options);
  const result = await executeCompatibleOperation<unknown>(context.services, {
    current: {
      query: `mutation($packageJson: JSON!, $yarnLock: String!) {
        createOneServerlessFunctionLayer(packageJson: $packageJson, yarnLock: $yarnLock) {
          id
          applicationId
          createdAt
          updatedAt
        }
      }`,
      variables: input,
      resultKey: "createOneServerlessFunctionLayer",
      schemaSymbols: ["createOneServerlessFunctionLayer", "CreateServerlessFunctionLayerInput"],
    },
    unavailableOnLegacyMessage:
      "Serverless layers are not available on this workspace because it does not expose createOneServerlessFunctionLayer.",
  });

  await renderServerlessFunction(result, context);
}
