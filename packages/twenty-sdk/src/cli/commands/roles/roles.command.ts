import { Command } from "commander";

import { requireGraphqlField, type GraphQLResponse } from "../../utilities/api/graphql-response";
import { CliError } from "../../utilities/errors/cli-error";
import { parseBody } from "../../utilities/shared/body";
import { resolveOperationAlias } from "../../utilities/shared/command-aliases";
import { applyGlobalOptions, resolveGlobalOptions } from "../../utilities/shared/global-options";
import { createServices } from "../../utilities/shared/services";

interface RolesOptions {
  data?: string;
  file?: string;
  set?: string[];
  roleId?: string;
  includeTargets?: boolean;
  includePermissions?: boolean;
}

const ROLE_FIELDS = `
  id
  label
  description
  icon
  isEditable
  canUpdateAllSettings
  canAccessAllTools
  canReadAllObjectRecords
  canUpdateAllObjectRecords
  canSoftDeleteAllObjectRecords
  canDestroyAllObjectRecords
  canBeAssignedToUsers
  canBeAssignedToAgents
  canBeAssignedToApiKeys
`;

const ROLE_OPERATIONS = [
  "list",
  "get",
  "create",
  "update",
  "delete",
  "upsert-permission-flags",
  "upsert-object-permissions",
  "upsert-field-permissions",
  "assign-agent",
  "remove-agent",
] as const;

const ROLE_TARGET_FIELDS = `
  workspaceMembers {
    id
    name {
      firstName
      lastName
    }
    userEmail
    avatarUrl
  }
  agents {
    id
    name
    label
    icon
    description
    roleId
    isCustom
    createdAt
    updatedAt
  }
  apiKeys {
    id
    name
    expiresAt
    revokedAt
  }
`;

const ROLE_PERMISSION_FIELDS = `
  permissionFlags {
    id
    roleId
    flag
  }
  objectPermissions {
    objectMetadataId
    canReadObjectRecords
    canUpdateObjectRecords
    canSoftDeleteObjectRecords
    canDestroyObjectRecords
    restrictedFields
  }
  fieldPermissions {
    id
    roleId
    objectMetadataId
    fieldMetadataId
    canReadFieldValue
    canUpdateFieldValue
  }
`;

const CREATE_ROLE_MUTATION = `mutation CreateOneRole($createRoleInput: CreateRoleInput!) {
  createOneRole(createRoleInput: $createRoleInput) {
    ${ROLE_FIELDS}
  }
}`;

const UPDATE_ROLE_MUTATION = `mutation UpdateOneRole($updateRoleInput: UpdateRoleInput!) {
  updateOneRole(updateRoleInput: $updateRoleInput) {
    ${ROLE_FIELDS}
  }
}`;

const DELETE_ROLE_MUTATION = `mutation DeleteOneRole($roleId: UUID!) {
  deleteOneRole(roleId: $roleId)
}`;

const UPSERT_PERMISSION_FLAGS_MUTATION = `mutation UpsertPermissionFlags($upsertPermissionFlagsInput: UpsertPermissionFlagsInput!) {
  upsertPermissionFlags(upsertPermissionFlagsInput: $upsertPermissionFlagsInput) {
    id
    roleId
    flag
  }
}`;

const UPSERT_OBJECT_PERMISSIONS_MUTATION = `mutation UpsertObjectPermissions($upsertObjectPermissionsInput: UpsertObjectPermissionsInput!) {
  upsertObjectPermissions(upsertObjectPermissionsInput: $upsertObjectPermissionsInput) {
    objectMetadataId
    canReadObjectRecords
    canUpdateObjectRecords
    canSoftDeleteObjectRecords
    canDestroyObjectRecords
    restrictedFields
  }
}`;

const UPSERT_FIELD_PERMISSIONS_MUTATION = `mutation UpsertFieldPermissions($upsertFieldPermissionsInput: UpsertFieldPermissionsInput!) {
  upsertFieldPermissions(upsertFieldPermissionsInput: $upsertFieldPermissionsInput) {
    id
    roleId
    objectMetadataId
    fieldMetadataId
    canReadFieldValue
    canUpdateFieldValue
  }
}`;

const ASSIGN_ROLE_TO_AGENT_MUTATION = `mutation AssignRoleToAgent($agentId: UUID!, $roleId: UUID!) {
  assignRoleToAgent(agentId: $agentId, roleId: $roleId)
}`;

const REMOVE_ROLE_FROM_AGENT_MUTATION = `mutation RemoveRoleFromAgent($agentId: UUID!) {
  removeRoleFromAgent(agentId: $agentId)
}`;

function collect(value: string, previous: string[] = []): string[] {
  return previous.concat([value]);
}

function buildRoleSelection(options: RolesOptions): string {
  return [
    ROLE_FIELDS,
    options.includeTargets ? ROLE_TARGET_FIELDS : "",
    options.includePermissions ? ROLE_PERMISSION_FIELDS : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function buildGetRolesQuery(options: RolesOptions): string {
  return `query GetRoles {
  getRoles {
    ${buildRoleSelection(options)}
  }
}`;
}

function findRoleById(roles: unknown[], id: string): unknown {
  return roles.find((role) => {
    if (typeof role !== "object" || role === null) {
      return false;
    }

    const candidate = role as { id?: unknown };

    return candidate.id === id;
  });
}

export function registerRolesCommand(program: Command): void {
  const endpoint = "/metadata";
  const cmd = program
    .command("roles")
    .description("Manage workspace roles")
    .argument(
      "<operation>",
      "list, get, create, update, delete, upsert-permission-flags, upsert-object-permissions, upsert-field-permissions, assign-agent, remove-agent",
    )
    .argument("[id]", "Role ID")
    .option("-d, --data <json>", "JSON payload")
    .option("-f, --file <path>", "JSON file")
    .option("--set <key=value>", "Set a field value", collect)
    .option("--role-id <id>", "Role ID for assignment operations")
    .option(
      "--include-targets",
      "Include workspace members, agents, and API keys assigned to each role",
    )
    .option(
      "--include-permissions",
      "Include permission flag, object permission, and field permission details",
    );

  applyGlobalOptions(cmd);

  cmd.action(
    async (operation: string, id: string | undefined, options: RolesOptions, command: Command) => {
      const globalOptions = resolveGlobalOptions(command);
      const services = await createServices(globalOptions);
      const op = resolveOperationAlias(operation, ROLE_OPERATIONS);

      switch (op) {
        case "list": {
          const response = await services.api.post<GraphQLResponse<{ getRoles?: unknown[] }>>(
            endpoint,
            {
              query: buildGetRolesQuery(options),
            },
          );

          const roles = requireGraphqlField(
            response.data ?? {},
            "getRoles",
            "Failed to list roles.",
          );
          await services.output.render(roles ?? [], {
            format: globalOptions.output,
            query: globalOptions.query,
          });
          break;
        }
        case "get": {
          if (!id) {
            throw new CliError("Missing role ID.", "INVALID_ARGUMENTS");
          }

          const response = await services.api.post<GraphQLResponse<{ getRoles?: unknown[] }>>(
            endpoint,
            {
              query: buildGetRolesQuery(options),
            },
          );

          const roles = requireGraphqlField(
            response.data ?? {},
            "getRoles",
            "Failed to list roles.",
          );
          const role = findRoleById(roles ?? [], id);

          if (!role) {
            throw new CliError(`Role ${id} not found.`, "NOT_FOUND");
          }

          await services.output.render(role, {
            format: globalOptions.output,
            query: globalOptions.query,
          });
          break;
        }
        case "create": {
          const payload = await parseBody(options.data, options.file, options.set);
          const response = await services.api.post<GraphQLResponse<{ createOneRole?: unknown }>>(
            endpoint,
            {
              query: CREATE_ROLE_MUTATION,
              variables: {
                createRoleInput: payload,
              },
            },
          );

          await services.output.render(
            requireGraphqlField(response.data ?? {}, "createOneRole", "Failed to create role."),
            {
              format: globalOptions.output,
              query: globalOptions.query,
            },
          );
          break;
        }
        case "update": {
          if (!id) {
            throw new CliError("Missing role ID.", "INVALID_ARGUMENTS");
          }

          const payload = await parseBody(options.data, options.file, options.set);
          const response = await services.api.post<GraphQLResponse<{ updateOneRole?: unknown }>>(
            endpoint,
            {
              query: UPDATE_ROLE_MUTATION,
              variables: {
                updateRoleInput: {
                  id,
                  update: payload,
                },
              },
            },
          );

          await services.output.render(
            requireGraphqlField(
              response.data ?? {},
              "updateOneRole",
              `Failed to update role ${id}.`,
            ),
            {
              format: globalOptions.output,
              query: globalOptions.query,
            },
          );
          break;
        }
        case "delete": {
          if (!id) {
            throw new CliError("Missing role ID.", "INVALID_ARGUMENTS");
          }

          const response = await services.api.post<GraphQLResponse<{ deleteOneRole?: string }>>(
            endpoint,
            {
              query: DELETE_ROLE_MUTATION,
              variables: {
                roleId: id,
              },
            },
          );

          await services.output.render(
            {
              id:
                requireGraphqlField(
                  response.data ?? {},
                  "deleteOneRole",
                  `Failed to delete role ${id}.`,
                ) ?? id,
            },
            {
              format: globalOptions.output,
              query: globalOptions.query,
            },
          );
          break;
        }
        case "upsert-permission-flags": {
          const payload = await parseBody(options.data, options.file, options.set);
          const response = await services.api.post<
            GraphQLResponse<{ upsertPermissionFlags?: unknown[] }>
          >(endpoint, {
            query: UPSERT_PERMISSION_FLAGS_MUTATION,
            variables: {
              upsertPermissionFlagsInput: payload,
            },
          });

          const flags = requireGraphqlField(
            response.data ?? {},
            "upsertPermissionFlags",
            "Failed to upsert permission flags.",
          );
          await services.output.render(flags ?? [], {
            format: globalOptions.output,
            query: globalOptions.query,
          });
          break;
        }
        case "upsert-object-permissions": {
          const payload = await parseBody(options.data, options.file, options.set);
          const response = await services.api.post<
            GraphQLResponse<{ upsertObjectPermissions?: unknown[] }>
          >(endpoint, {
            query: UPSERT_OBJECT_PERMISSIONS_MUTATION,
            variables: {
              upsertObjectPermissionsInput: payload,
            },
          });

          const objectPermissions = requireGraphqlField(
            response.data ?? {},
            "upsertObjectPermissions",
            "Failed to upsert object permissions.",
          );
          await services.output.render(objectPermissions ?? [], {
            format: globalOptions.output,
            query: globalOptions.query,
          });
          break;
        }
        case "upsert-field-permissions": {
          const payload = await parseBody(options.data, options.file, options.set);
          const response = await services.api.post<
            GraphQLResponse<{ upsertFieldPermissions?: unknown[] }>
          >(endpoint, {
            query: UPSERT_FIELD_PERMISSIONS_MUTATION,
            variables: {
              upsertFieldPermissionsInput: payload,
            },
          });

          const fieldPermissions = requireGraphqlField(
            response.data ?? {},
            "upsertFieldPermissions",
            "Failed to upsert field permissions.",
          );
          await services.output.render(fieldPermissions ?? [], {
            format: globalOptions.output,
            query: globalOptions.query,
          });
          break;
        }
        case "assign-agent": {
          if (!id) {
            throw new CliError("Missing agent ID.", "INVALID_ARGUMENTS");
          }
          if (!options.roleId) {
            throw new CliError("Missing --role-id option.", "INVALID_ARGUMENTS");
          }

          const response = await services.api.post<
            GraphQLResponse<{ assignRoleToAgent?: boolean }>
          >(endpoint, {
            query: ASSIGN_ROLE_TO_AGENT_MUTATION,
            variables: {
              agentId: id,
              roleId: options.roleId,
            },
          });

          await services.output.render(
            {
              agentId: id,
              roleId: options.roleId,
              assigned: requireGraphqlField(
                response.data ?? {},
                "assignRoleToAgent",
                `Failed to assign role ${options.roleId} to agent ${id}.`,
              ),
            },
            {
              format: globalOptions.output,
              query: globalOptions.query,
            },
          );
          break;
        }
        case "remove-agent": {
          if (!id) {
            throw new CliError("Missing agent ID.", "INVALID_ARGUMENTS");
          }

          const response = await services.api.post<
            GraphQLResponse<{ removeRoleFromAgent?: boolean }>
          >(endpoint, {
            query: REMOVE_ROLE_FROM_AGENT_MUTATION,
            variables: {
              agentId: id,
            },
          });

          await services.output.render(
            {
              agentId: id,
              removed: requireGraphqlField(
                response.data ?? {},
                "removeRoleFromAgent",
                `Failed to remove a role from agent ${id}.`,
              ),
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
