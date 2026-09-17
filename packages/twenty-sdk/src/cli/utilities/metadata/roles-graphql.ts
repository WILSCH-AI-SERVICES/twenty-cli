// GraphQL documents for workspace roles, shared by `config export` (which reads every role
// with its permissions) and `parity check` (which creates and deletes a role as its seventh
// act). They mirror the selections `twenty roles` sends; they live here so neither command
// reaches into roles.command.ts, which the upstream may reshape.

export const ROLE_CORE_FIELDS = `
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

export const ROLE_PERMISSION_FIELDS = `
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

export const GET_ROLES_QUERY = `query GetRoles {
  getRoles {
    ${ROLE_CORE_FIELDS}
  }
}`;

export const GET_ROLES_WITH_PERMISSIONS_QUERY = `query GetRoles {
  getRoles {
    ${ROLE_CORE_FIELDS}
    ${ROLE_PERMISSION_FIELDS}
  }
}`;

export const CREATE_ROLE_MUTATION = `mutation CreateOneRole($createRoleInput: CreateRoleInput!) {
  createOneRole(createRoleInput: $createRoleInput) {
    ${ROLE_CORE_FIELDS}
  }
}`;

export const DELETE_ROLE_MUTATION = `mutation DeleteOneRole($roleId: UUID!) {
  deleteOneRole(roleId: $roleId)
}`;
