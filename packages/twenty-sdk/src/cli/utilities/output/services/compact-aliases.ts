export const COMPACT_FIELD_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  id: "id",
  name: "nm",
  displayName: "dn",
  firstName: "fn",
  lastName: "ln",
  title: "ttl",
  label: "lb",
  value: "val",
  key: "key",
  type: "typ",
  status: "st",
  command: "cmd",
  family: "fam",
  currentBackend: "cb",
  targetBackend: "tb",
  blocker: "blk",
  source: "src",
  fallbackReason: "fr",
  configured: "cfg",
  connection: "cn",
  resources: "res",
  warnings: "wrn",
  readable: "rd",
  priority: "pri",
  position: "pos",
  description: "ds",
  email: "em",
  primaryEmail: "pem",
  additionalEmails: "aem",
  phone: "ph",
  phones: "phs",
  city: "cty",
  address: "ad",
  company: "co",
  account: "ac",
  owner: "own",
  assignee: "asg",
  role: "rl",
  object: "obj",
  objectName: "onm",
  fieldName: "fnm",
  objectMetadataId: "omi",
  fieldMetadataId: "fmi",
  workspaceId: "wid",
  workspaceMemberId: "wmi",
  roleId: "rid",
  apiKeyId: "kid",
  webhookId: "whi",
  createdAt: "ca",
  updatedAt: "ua",
  deletedAt: "da",
  expiresAt: "ea",
  revokedAt: "ra",
  totalCount: "tc",
  pageInfo: "pg",
  hasNextPage: "hn",
  hasPreviousPage: "hp",
  startCursor: "sc",
  endCursor: "ec",
  data: "dt",
  items: "is",
  records: "rs",
  meta: "mt",
  error: "err",
  message: "msg",
});

export function assertCompactAliasesAreValid(
  aliases: Readonly<Record<string, string>> = COMPACT_FIELD_ALIASES,
): void {
  const seen = new Map<string, string>();

  for (const [field, alias] of Object.entries(aliases)) {
    if (!/^[a-z][a-z0-9]{1,2}$/.test(alias)) {
      throw new Error(`Compact alias for ${field} must be 2-3 lowercase characters.`);
    }

    const previous = seen.get(alias);
    if (previous) {
      throw new Error(`Compact aliases ${previous} and ${field} both map to ${alias}.`);
    }

    seen.set(alias, field);
  }
}

export function toLightPayload(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => toLightPayload(item));
  }

  if (!isPlainRecord(value)) {
    return value;
  }

  const result: Record<string, unknown> = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    const alias = COMPACT_FIELD_ALIASES[key] ?? key;
    const target = Object.prototype.hasOwnProperty.call(result, alias) ? key : alias;
    result[target] = toLightPayload(nestedValue);
  }

  return result;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
