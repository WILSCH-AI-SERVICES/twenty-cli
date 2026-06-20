import { Command } from "commander";

import {
  assertGraphqlSuccess,
  type GraphQLResponse,
  hasSchemaErrorSymbol,
} from "../../utilities/api/graphql-response";
import { CliError } from "../../utilities/errors/cli-error";
import { resolveOperationAlias } from "../../utilities/shared/command-aliases";
import { requireYes } from "../../utilities/shared/confirmation";
import { applyGlobalOptions, resolveGlobalOptions } from "../../utilities/shared/global-options";
import { readFileOrStdin, readJsonInput } from "../../utilities/shared/io";
import { createServices } from "../../utilities/shared/services";

interface ApplicationsOptions {
  manifest?: string;
  manifestFile?: string;
  packageJson?: string;
  packageJsonFile?: string;
  yarnLockFile?: string;
  name?: string;
  key?: string;
  value?: string;
  yes?: boolean;
}

const endpoint = "/metadata";
const legacyEndpoint = "/graphql";

const APPLICATION_OPERATIONS = [
  "list",
  "get",
  "sync",
  "uninstall",
  "create-development",
  "generate-token",
  "update-variable",
] as const;

const CURRENT_APPLICATION_FIELDS = `
  id
  name
  description
  version
  universalIdentifier
  canBeUninstalled
  defaultRoleId
  applicationVariables {
    id
    key
    value
    description
    isSecret
  }
`;

const LEGACY_APPLICATION_FIELDS = `
  id
  name
  description
  version
  universalIdentifier
  canBeUninstalled
  defaultServerlessFunctionRoleId
  applicationVariables {
    id
    key
    value
    description
    isSecret
  }
`;

export function registerApplicationsCommand(program: Command): void {
  const cmd = program
    .command("applications")
    .description("Manage workspace applications")
    .argument(
      "<operation>",
      "list, get, sync, uninstall, update-variable, create-development, generate-token",
    )
    .argument("[target]", "Application ID or universal identifier")
    .option("--manifest <json>", "Application manifest JSON")
    .option("--manifest-file <path>", "Application manifest JSON file")
    .option("--package-json <json>", "Legacy package.json JSON for older syncApplication schemas")
    .option(
      "--package-json-file <path>",
      "Legacy package.json file for older syncApplication schemas",
    )
    .option("--yarn-lock-file <path>", "Legacy yarn.lock file for older syncApplication schemas")
    .option("--name <name>", "Application display name for create-development")
    .option("--key <key>", "Application variable key")
    .option("--value <value>", "Application variable value")
    .option("--yes", "Confirm destructive operations");

  applyGlobalOptions(cmd);

  cmd.action(
    async (
      operation: string,
      target: string | undefined,
      options: ApplicationsOptions,
      command: Command,
    ) => {
      const globalOptions = resolveGlobalOptions(command);
      const services = await createServices(globalOptions);
      const op = resolveOperationAlias(operation, APPLICATION_OPERATIONS);

      switch (op) {
        case "list": {
          const applications = await queryApplications<unknown[]>(
            services,
            "findManyApplications",
            {
              current: `query {
                findManyApplications {
                  ${CURRENT_APPLICATION_FIELDS}
                }
              }`,
              legacy: `query {
                findManyApplications {
                  ${LEGACY_APPLICATION_FIELDS}
                }
              }`,
            },
            undefined,
            "Failed to list applications.",
          );
          await services.output.render(applications ?? [], {
            format: globalOptions.output,
            query: globalOptions.query,
          });
          break;
        }
        case "get": {
          if (!target) throw new CliError("Missing application ID.", "INVALID_ARGUMENTS");
          const application = await queryApplications<unknown>(
            services,
            "findOneApplication",
            {
              current: `query($id: UUID!) {
                findOneApplication(id: $id) {
                  ${CURRENT_APPLICATION_FIELDS}
                }
              }`,
              legacy: `query($id: UUID!) {
                findOneApplication(id: $id) {
                  ${LEGACY_APPLICATION_FIELDS}
                }
              }`,
            },
            { id: target },
            `Failed to fetch application ${target}.`,
          );
          await services.output.render(application, {
            format: globalOptions.output,
            query: globalOptions.query,
          });
          break;
        }
        case "sync": {
          const manifest = await readRequiredJsonObject(
            options.manifest,
            options.manifestFile,
            "application manifest",
          );
          const response = await services.api.post<GraphQLResponse<{ syncApplication: unknown }>>(
            endpoint,
            {
              query: `mutation($manifest: JSON!) {
                syncApplication(manifest: $manifest) {
                  applicationUniversalIdentifier
                  actions
                }
              }`,
              variables: { manifest },
            },
          );

          if (shouldFallbackToLegacySync(response.data ?? {})) {
            const packageJson = await readRequiredJsonObject(
              options.packageJson,
              options.packageJsonFile,
              "package.json",
            );
            const yarnLock = await readRequiredText(options.yarnLockFile, "--yarn-lock-file");
            const legacyResponse = await services.api.post<
              GraphQLResponse<{ syncApplication: boolean }>
            >(legacyEndpoint, {
              query: `mutation($manifest: JSON!, $packageJson: JSON!, $yarnLock: String!) {
                syncApplication(
                  manifest: $manifest
                  packageJson: $packageJson
                  yarnLock: $yarnLock
                )
              }`,
              variables: { manifest, packageJson, yarnLock },
            });
            const legacyData = assertGraphqlSuccess(
              legacyResponse.data ?? {},
              "Failed to sync application.",
            );

            await services.output.render(
              {
                success: legacyData.syncApplication ?? false,
                compatibility: "legacy",
              },
              {
                format: globalOptions.output,
                query: globalOptions.query,
              },
            );
            break;
          }

          const data = assertGraphqlSuccess(response.data ?? {}, "Failed to sync application.");
          await services.output.render(data.syncApplication, {
            format: globalOptions.output,
            query: globalOptions.query,
          });
          break;
        }
        case "uninstall": {
          if (!target)
            throw new CliError("Missing application universal identifier.", "INVALID_ARGUMENTS");
          requireYes(options, "Uninstall");
          const response = await services.api.post<
            GraphQLResponse<{ uninstallApplication: boolean }>
          >(endpoint, {
            query: `mutation($universalIdentifier: String!) {
              uninstallApplication(universalIdentifier: $universalIdentifier)
            }`,
            variables: { universalIdentifier: target },
          });
          const data = assertGraphqlSuccess(
            response.data ?? {},
            `Failed to uninstall application ${target}.`,
          );
          await services.output.render(
            {
              success: data.uninstallApplication ?? false,
              universalIdentifier: target,
            },
            {
              format: globalOptions.output,
              query: globalOptions.query,
            },
          );
          break;
        }
        case "create-development": {
          if (!target) {
            throw new CliError("Missing application universal identifier.", "INVALID_ARGUMENTS");
          }
          const response = await services.api.post<
            GraphQLResponse<{ createDevelopmentApplication: unknown }>
          >(endpoint, {
            query: `mutation($universalIdentifier: String!, $name: String!) {
              createDevelopmentApplication(
                universalIdentifier: $universalIdentifier
                name: $name
              ) {
                id
                universalIdentifier
              }
            }`,
            variables: {
              universalIdentifier: target,
              name: options.name ?? target,
            },
          });
          const data = assertGraphqlSuccess(
            response.data ?? {},
            `Failed to create development application ${target}.`,
          );
          await services.output.render(data.createDevelopmentApplication, {
            format: globalOptions.output,
            query: globalOptions.query,
          });
          break;
        }
        case "generate-token": {
          if (!target) throw new CliError("Missing application ID.", "INVALID_ARGUMENTS");
          const response = await services.api.post<
            GraphQLResponse<{ generateApplicationToken: unknown }>
          >(endpoint, {
            query: `mutation($applicationId: UUID!) {
              generateApplicationToken(applicationId: $applicationId) {
                applicationAccessToken
                applicationRefreshToken
              }
            }`,
            variables: {
              applicationId: target,
            },
          });
          const data = assertGraphqlSuccess(
            response.data ?? {},
            `Failed to generate application token for ${target}.`,
          );
          await services.output.render(data.generateApplicationToken, {
            format: globalOptions.output,
            query: globalOptions.query,
          });
          break;
        }
        case "update-variable": {
          if (!target) throw new CliError("Missing application ID.", "INVALID_ARGUMENTS");
          if (!options.key) throw new CliError("Missing --key option.", "INVALID_ARGUMENTS");
          if (!options.value) throw new CliError("Missing --value option.", "INVALID_ARGUMENTS");
          const response = await services.api.post<
            GraphQLResponse<{ updateOneApplicationVariable: boolean }>
          >(endpoint, {
            query: `mutation($applicationId: UUID!, $key: String!, $value: String!) {
              updateOneApplicationVariable(
                applicationId: $applicationId
                key: $key
                value: $value
              )
            }`,
            variables: {
              applicationId: target,
              key: options.key,
              value: options.value,
            },
          });
          const data = assertGraphqlSuccess(
            response.data ?? {},
            `Failed to update application variable ${options.key}.`,
          );
          await services.output.render(
            {
              success: data.updateOneApplicationVariable ?? false,
              applicationId: target,
              key: options.key,
            },
            {
              format: globalOptions.output,
              query: globalOptions.query,
            },
          );
          break;
        }
        default:
          throw new CliError(`Unknown operation: ${operation}`, "INVALID_ARGUMENTS");
      }
    },
  );
}

async function readRequiredJsonObject(
  data: string | undefined,
  filePath: string | undefined,
  label: string,
): Promise<Record<string, unknown>> {
  const payload = await readJsonInput(data, filePath);

  if (payload == null) {
    throw new CliError(
      `Missing ${label}; provide inline JSON or a file path.`,
      "INVALID_ARGUMENTS",
    );
  }

  if (typeof payload !== "object" || Array.isArray(payload)) {
    throw new CliError(`${label} must be a JSON object.`, "INVALID_ARGUMENTS");
  }

  return payload as Record<string, unknown>;
}

async function readRequiredText(filePath: string | undefined, optionName: string): Promise<string> {
  if (!filePath) {
    throw new CliError(`Missing ${optionName} option.`, "INVALID_ARGUMENTS");
  }

  return readFileOrStdin(filePath);
}

function shouldFallbackToLegacySync(response: GraphQLResponse<unknown>): boolean {
  return (
    hasSchemaErrorSymbol(response, ["syncApplication"]) &&
    hasSchemaErrorSymbol(response, ["packageJson", "yarnLock", "Boolean"])
  );
}

async function queryApplications<T>(
  services: Awaited<ReturnType<typeof createServices>>,
  resultKey: "findManyApplications" | "findOneApplication",
  queries: { current: string; legacy: string },
  variables: Record<string, unknown> | undefined,
  fallbackMessage: string,
): Promise<T | undefined> {
  const currentResponse = await postApplicationQuery<T>(services, queries.current, variables);

  if (shouldFallbackToLegacyApplicationField(currentResponse)) {
    const legacyResponse = await postApplicationQuery<T>(services, queries.legacy, variables);
    const legacyData = assertGraphqlSuccess(legacyResponse, fallbackMessage);

    return normalizeApplicationPayload(legacyData[resultKey]) as T | undefined;
  }

  const currentData = assertGraphqlSuccess(currentResponse, fallbackMessage);

  return normalizeApplicationPayload(currentData[resultKey]) as T | undefined;
}

async function postApplicationQuery<T>(
  services: Awaited<ReturnType<typeof createServices>>,
  query: string,
  variables: Record<string, unknown> | undefined,
): Promise<GraphQLResponse<Record<string, T>>> {
  const payload: { query: string; variables?: Record<string, unknown> } = {
    query,
  };

  if (variables) {
    payload.variables = variables;
  }

  const response = await services.api.post<GraphQLResponse<Record<string, T>>>(endpoint, payload);

  return response.data ?? {};
}

function shouldFallbackToLegacyApplicationField(response: GraphQLResponse<unknown>): boolean {
  return hasSchemaErrorSymbol(response, ["defaultRoleId"]);
}

function normalizeApplicationPayload(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeApplicationPayload(item));
  }

  if (!isRecord(value)) {
    return value;
  }

  const normalized = { ...value };
  const hasDefaultRoleField =
    Object.prototype.hasOwnProperty.call(normalized, "defaultRoleId") ||
    Object.prototype.hasOwnProperty.call(normalized, "defaultServerlessFunctionRoleId");
  const defaultRoleId =
    (typeof normalized.defaultRoleId === "string" && normalized.defaultRoleId) ||
    (typeof normalized.defaultServerlessFunctionRoleId === "string" &&
      normalized.defaultServerlessFunctionRoleId) ||
    null;

  if (hasDefaultRoleField) {
    normalized.defaultRoleId = defaultRoleId;
    normalized.defaultServerlessFunctionRoleId = defaultRoleId;
  }

  return normalized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
