import { Command } from "commander";

import { assertGraphqlSuccess, type GraphQLResponse } from "../../utilities/api/graphql-response";
import { CliError } from "../../utilities/errors/cli-error";
import { parseBody } from "../../utilities/shared/body";
import { resolveOperationAlias } from "../../utilities/shared/command-aliases";
import { applyGlobalOptions, resolveGlobalOptions } from "../../utilities/shared/global-options";
import { createServices } from "../../utilities/shared/services";

interface ApplicationRegistrationsOptions {
  data?: string;
  file?: string;
  set?: string[];
  targetWorkspaceSubdomain?: string;
}

const endpoint = "/metadata";

const APPLICATION_REGISTRATION_OPERATIONS = [
  "list",
  "get",
  "stats",
  "tarball-url",
  "list-variables",
  "create",
  "update",
  "delete",
  "create-variable",
  "update-variable",
  "delete-variable",
  "rotate-secret",
  "transfer-ownership",
] as const;

const APPLICATION_REGISTRATION_FIELDS = `
  id
  universalIdentifier
  name
  description
  logoUrl
  author
  oAuthClientId
  oAuthRedirectUris
  oAuthScopes
  ownerWorkspaceId
  sourceType
  sourcePackage
  latestAvailableVersion
  websiteUrl
  termsUrl
  isListed
  isFeatured
  createdAt
  updatedAt
`;

const APPLICATION_REGISTRATION_VARIABLE_FIELDS = `
  id
  key
  description
  isSecret
  isRequired
  isFilled
  createdAt
  updatedAt
`;

const APPLICATION_REGISTRATION_STATS_FIELDS = `
  activeInstalls
  mostInstalledVersion
  versionDistribution {
    version
    count
  }
`;

const LIST_APPLICATION_REGISTRATIONS_QUERY = `query FindManyApplicationRegistrations {
  findManyApplicationRegistrations {
    ${APPLICATION_REGISTRATION_FIELDS}
  }
}`;

const GET_APPLICATION_REGISTRATION_QUERY = `query FindOneApplicationRegistration($id: String!) {
  findOneApplicationRegistration(id: $id) {
    ${APPLICATION_REGISTRATION_FIELDS}
  }
}`;

const GET_APPLICATION_REGISTRATION_STATS_QUERY = `query FindApplicationRegistrationStats($id: String!) {
  findApplicationRegistrationStats(id: $id) {
    ${APPLICATION_REGISTRATION_STATS_FIELDS}
  }
}`;

const GET_APPLICATION_REGISTRATION_TARBALL_URL_QUERY = `query ApplicationRegistrationTarballUrl($id: String!) {
  applicationRegistrationTarballUrl(id: $id)
}`;

const LIST_APPLICATION_REGISTRATION_VARIABLES_QUERY = `query FindApplicationRegistrationVariables($applicationRegistrationId: String!) {
  findApplicationRegistrationVariables(applicationRegistrationId: $applicationRegistrationId) {
    ${APPLICATION_REGISTRATION_VARIABLE_FIELDS}
  }
}`;

const CREATE_APPLICATION_REGISTRATION_MUTATION = `mutation CreateApplicationRegistration($input: CreateApplicationRegistrationInput!) {
  createApplicationRegistration(input: $input) {
    applicationRegistration {
      ${APPLICATION_REGISTRATION_FIELDS}
    }
    clientSecret
  }
}`;

const UPDATE_APPLICATION_REGISTRATION_MUTATION = `mutation UpdateApplicationRegistration($input: UpdateApplicationRegistrationInput!) {
  updateApplicationRegistration(input: $input) {
    ${APPLICATION_REGISTRATION_FIELDS}
  }
}`;

const DELETE_APPLICATION_REGISTRATION_MUTATION = `mutation DeleteApplicationRegistration($id: String!) {
  deleteApplicationRegistration(id: $id)
}`;

const CREATE_APPLICATION_REGISTRATION_VARIABLE_MUTATION = `mutation CreateApplicationRegistrationVariable($input: CreateApplicationRegistrationVariableInput!) {
  createApplicationRegistrationVariable(input: $input) {
    ${APPLICATION_REGISTRATION_VARIABLE_FIELDS}
  }
}`;

const UPDATE_APPLICATION_REGISTRATION_VARIABLE_MUTATION = `mutation UpdateApplicationRegistrationVariable($input: UpdateApplicationRegistrationVariableInput!) {
  updateApplicationRegistrationVariable(input: $input) {
    ${APPLICATION_REGISTRATION_VARIABLE_FIELDS}
  }
}`;

const DELETE_APPLICATION_REGISTRATION_VARIABLE_MUTATION = `mutation DeleteApplicationRegistrationVariable($id: String!) {
  deleteApplicationRegistrationVariable(id: $id)
}`;

const ROTATE_APPLICATION_REGISTRATION_CLIENT_SECRET_MUTATION = `mutation RotateApplicationRegistrationClientSecret($id: String!) {
  rotateApplicationRegistrationClientSecret(id: $id) {
    clientSecret
  }
}`;

const TRANSFER_APPLICATION_REGISTRATION_OWNERSHIP_MUTATION = `mutation TransferApplicationRegistrationOwnership($applicationRegistrationId: String!, $targetWorkspaceSubdomain: String!) {
  transferApplicationRegistrationOwnership(
    applicationRegistrationId: $applicationRegistrationId
    targetWorkspaceSubdomain: $targetWorkspaceSubdomain
  ) {
    ${APPLICATION_REGISTRATION_FIELDS}
  }
}`;

function collect(value: string, previous: string[] = []): string[] {
  return previous.concat([value]);
}

function requireTarget(target: string | undefined, label: string): string {
  if (!target) {
    throw new CliError(`Missing ${label}.`, "INVALID_ARGUMENTS");
  }

  return target;
}

export function registerApplicationRegistrationsCommand(program: Command): void {
  const cmd = program
    .command("application-registrations")
    .description("Manage application registrations")
    .argument(
      "<operation>",
      "list, get, stats, tarball-url, list-variables, create, update, delete, create-variable, update-variable, delete-variable, rotate-secret, transfer-ownership",
    )
    .argument("[target]", "Registration or variable ID")
    .option("-d, --data <json>", "JSON payload")
    .option("-f, --file <path>", "JSON payload file")
    .option("--set <key=value>", "Set a field value", collect)
    .option(
      "--target-workspace-subdomain <subdomain>",
      "Target workspace subdomain for transfer-ownership",
    );

  applyGlobalOptions(cmd);

  cmd.action(
    async (
      operation: string,
      target: string | undefined,
      options: ApplicationRegistrationsOptions,
      command: Command,
    ) => {
      const globalOptions = resolveGlobalOptions(command);
      const services = await createServices(globalOptions);
      const op = resolveOperationAlias(operation, APPLICATION_REGISTRATION_OPERATIONS);

      switch (op) {
        case "list": {
          const response = await services.api.post<
            GraphQLResponse<{ findManyApplicationRegistrations: unknown[] }>
          >(endpoint, {
            query: LIST_APPLICATION_REGISTRATIONS_QUERY,
          });
          const data = assertGraphqlSuccess(
            response.data ?? {},
            "Failed to list application registrations.",
          );
          await services.output.render(data.findManyApplicationRegistrations ?? [], {
            format: globalOptions.output,
            query: globalOptions.query,
          });
          break;
        }
        case "get": {
          const id = requireTarget(target, "application registration ID");
          const response = await services.api.post<
            GraphQLResponse<{ findOneApplicationRegistration: unknown }>
          >(endpoint, {
            query: GET_APPLICATION_REGISTRATION_QUERY,
            variables: { id },
          });
          const data = assertGraphqlSuccess(
            response.data ?? {},
            `Failed to fetch application registration ${id}.`,
          );
          await services.output.render(data.findOneApplicationRegistration, {
            format: globalOptions.output,
            query: globalOptions.query,
          });
          break;
        }
        case "stats": {
          const id = requireTarget(target, "application registration ID");
          const response = await services.api.post<
            GraphQLResponse<{ findApplicationRegistrationStats: unknown }>
          >(endpoint, {
            query: GET_APPLICATION_REGISTRATION_STATS_QUERY,
            variables: { id },
          });
          const data = assertGraphqlSuccess(
            response.data ?? {},
            `Failed to fetch application registration stats for ${id}.`,
          );
          await services.output.render(data.findApplicationRegistrationStats, {
            format: globalOptions.output,
            query: globalOptions.query,
          });
          break;
        }
        case "tarball-url": {
          const id = requireTarget(target, "application registration ID");
          const response = await services.api.post<
            GraphQLResponse<{ applicationRegistrationTarballUrl: string | null }>
          >(endpoint, {
            query: GET_APPLICATION_REGISTRATION_TARBALL_URL_QUERY,
            variables: { id },
          });
          const data = assertGraphqlSuccess(
            response.data ?? {},
            `Failed to fetch application registration tarball URL for ${id}.`,
          );
          await services.output.render(
            {
              id,
              url: data.applicationRegistrationTarballUrl ?? null,
            },
            {
              format: globalOptions.output,
              query: globalOptions.query,
            },
          );
          break;
        }
        case "list-variables": {
          const applicationRegistrationId = requireTarget(target, "application registration ID");
          const response = await services.api.post<
            GraphQLResponse<{ findApplicationRegistrationVariables: unknown[] }>
          >(endpoint, {
            query: LIST_APPLICATION_REGISTRATION_VARIABLES_QUERY,
            variables: { applicationRegistrationId },
          });
          const data = assertGraphqlSuccess(
            response.data ?? {},
            `Failed to list application registration variables for ${applicationRegistrationId}.`,
          );
          await services.output.render(data.findApplicationRegistrationVariables ?? [], {
            format: globalOptions.output,
            query: globalOptions.query,
          });
          break;
        }
        case "create": {
          const input = await parseBody(options.data, options.file, options.set);
          const response = await services.api.post<
            GraphQLResponse<{ createApplicationRegistration: unknown }>
          >(endpoint, {
            query: CREATE_APPLICATION_REGISTRATION_MUTATION,
            variables: { input },
          });
          const data = assertGraphqlSuccess(
            response.data ?? {},
            "Failed to create application registration.",
          );
          await services.output.render(data.createApplicationRegistration, {
            format: globalOptions.output,
            query: globalOptions.query,
          });
          break;
        }
        case "update": {
          const id = requireTarget(target, "application registration ID");
          const update = await parseBody(options.data, options.file, options.set);
          const response = await services.api.post<
            GraphQLResponse<{ updateApplicationRegistration: unknown }>
          >(endpoint, {
            query: UPDATE_APPLICATION_REGISTRATION_MUTATION,
            variables: {
              input: {
                id,
                update,
              },
            },
          });
          const data = assertGraphqlSuccess(
            response.data ?? {},
            `Failed to update application registration ${id}.`,
          );
          await services.output.render(data.updateApplicationRegistration, {
            format: globalOptions.output,
            query: globalOptions.query,
          });
          break;
        }
        case "delete": {
          const id = requireTarget(target, "application registration ID");
          const response = await services.api.post<
            GraphQLResponse<{ deleteApplicationRegistration: boolean }>
          >(endpoint, {
            query: DELETE_APPLICATION_REGISTRATION_MUTATION,
            variables: { id },
          });
          const data = assertGraphqlSuccess(
            response.data ?? {},
            `Failed to delete application registration ${id}.`,
          );
          await services.output.render(
            {
              success: data.deleteApplicationRegistration ?? false,
              id,
            },
            {
              format: globalOptions.output,
              query: globalOptions.query,
            },
          );
          break;
        }
        case "create-variable": {
          const input = await parseBody(options.data, options.file, options.set);
          const response = await services.api.post<
            GraphQLResponse<{ createApplicationRegistrationVariable: unknown }>
          >(endpoint, {
            query: CREATE_APPLICATION_REGISTRATION_VARIABLE_MUTATION,
            variables: { input },
          });
          const data = assertGraphqlSuccess(
            response.data ?? {},
            "Failed to create application registration variable.",
          );
          await services.output.render(data.createApplicationRegistrationVariable, {
            format: globalOptions.output,
            query: globalOptions.query,
          });
          break;
        }
        case "update-variable": {
          const id = requireTarget(target, "application registration variable ID");
          const update = await parseBody(options.data, options.file, options.set);
          const response = await services.api.post<
            GraphQLResponse<{ updateApplicationRegistrationVariable: unknown }>
          >(endpoint, {
            query: UPDATE_APPLICATION_REGISTRATION_VARIABLE_MUTATION,
            variables: {
              input: {
                id,
                update,
              },
            },
          });
          const data = assertGraphqlSuccess(
            response.data ?? {},
            `Failed to update application registration variable ${id}.`,
          );
          await services.output.render(data.updateApplicationRegistrationVariable, {
            format: globalOptions.output,
            query: globalOptions.query,
          });
          break;
        }
        case "delete-variable": {
          const id = requireTarget(target, "application registration variable ID");
          const response = await services.api.post<
            GraphQLResponse<{ deleteApplicationRegistrationVariable: boolean }>
          >(endpoint, {
            query: DELETE_APPLICATION_REGISTRATION_VARIABLE_MUTATION,
            variables: { id },
          });
          const data = assertGraphqlSuccess(
            response.data ?? {},
            `Failed to delete application registration variable ${id}.`,
          );
          await services.output.render(
            {
              success: data.deleteApplicationRegistrationVariable ?? false,
              id,
            },
            {
              format: globalOptions.output,
              query: globalOptions.query,
            },
          );
          break;
        }
        case "rotate-secret": {
          const id = requireTarget(target, "application registration ID");
          const response = await services.api.post<
            GraphQLResponse<{
              rotateApplicationRegistrationClientSecret: { clientSecret?: string };
            }>
          >(endpoint, {
            query: ROTATE_APPLICATION_REGISTRATION_CLIENT_SECRET_MUTATION,
            variables: { id },
          });
          const data = assertGraphqlSuccess(
            response.data ?? {},
            `Failed to rotate client secret for ${id}.`,
          );
          await services.output.render(
            {
              id,
              clientSecret: data.rotateApplicationRegistrationClientSecret?.clientSecret,
            },
            {
              format: globalOptions.output,
              query: globalOptions.query,
            },
          );
          break;
        }
        case "transfer-ownership": {
          const applicationRegistrationId = requireTarget(target, "application registration ID");
          if (!options.targetWorkspaceSubdomain) {
            throw new CliError("Missing --target-workspace-subdomain option.", "INVALID_ARGUMENTS");
          }
          const response = await services.api.post<
            GraphQLResponse<{ transferApplicationRegistrationOwnership: unknown }>
          >(endpoint, {
            query: TRANSFER_APPLICATION_REGISTRATION_OWNERSHIP_MUTATION,
            variables: {
              applicationRegistrationId,
              targetWorkspaceSubdomain: options.targetWorkspaceSubdomain,
            },
          });
          const data = assertGraphqlSuccess(
            response.data ?? {},
            `Failed to transfer ownership for application registration ${applicationRegistrationId}.`,
          );
          await services.output.render(data.transferApplicationRegistrationOwnership, {
            format: globalOptions.output,
            query: globalOptions.query,
          });
          break;
        }
        default:
          throw new CliError(`Unknown operation: ${operation}`, "INVALID_ARGUMENTS");
      }
    },
  );
}
