import type {
  DynamicMetadataOperation,
  DynamicRecordOperation,
  DynamicResource,
} from "./schema-command-materializer";

const RECORD_OPERATION_ORDER: DynamicRecordOperation[] = [
  "batch-create",
  "batch-delete",
  "batch-update",
  "create",
  "delete",
  "destroy",
  "find-duplicates",
  "get",
  "group-by",
  "list",
  "merge",
  "restore",
  "update",
];

const METADATA_OPERATION_ORDER: DynamicMetadataOperation[] = [
  "create",
  "delete",
  "get",
  "list",
  "update",
];

export function extractCoreRecordResources(
  schema: unknown,
): DynamicResource<DynamicRecordOperation>[] {
  const resources = new Map<string, Set<DynamicRecordOperation>>();

  for (const [rawPath, methods] of Object.entries(extractOpenApiPaths(schema))) {
    if (!isRecord(methods)) continue;
    const normalizedPath = normalizeOpenApiPath(rawPath);
    const methodSet = new Set(Object.keys(methods).map((method) => method.toLowerCase()));
    const match = corePathToResourceOperation(normalizedPath, methodSet);
    if (!match || match.operations.length === 0) continue;

    const operations = resources.get(match.resource) ?? new Set<DynamicRecordOperation>();
    for (const operation of match.operations) operations.add(operation);
    resources.set(match.resource, operations);
  }

  return Array.from(resources.entries())
    .map(([apiName, operations]) => ({
      apiName,
      operations: sortOperations(Array.from(operations), RECORD_OPERATION_ORDER),
    }))
    .sort((left, right) => left.apiName.localeCompare(right.apiName));
}

export function extractMetadataResources(
  schema: unknown,
): DynamicResource<DynamicMetadataOperation>[] {
  const resources = new Map<string, Set<DynamicMetadataOperation>>();

  for (const [rawPath, methods] of Object.entries(extractOpenApiPaths(schema))) {
    if (!isRecord(methods)) continue;
    const normalizedPath = normalizeOpenApiPath(rawPath);
    const match = metadataPathToResourceOperation(
      normalizedPath,
      new Set(Object.keys(methods).map((method) => method.toLowerCase())),
    );
    if (!match || match.operations.length === 0) continue;

    const operations = resources.get(match.resource) ?? new Set<DynamicMetadataOperation>();
    for (const operation of match.operations) operations.add(operation);
    resources.set(match.resource, operations);
  }

  return Array.from(resources.entries())
    .map(([apiName, operations]) => ({
      apiName,
      operations: sortOperations(Array.from(operations), METADATA_OPERATION_ORDER),
    }))
    .sort((left, right) => left.apiName.localeCompare(right.apiName));
}

function extractOpenApiPaths(schema: unknown): Record<string, Record<string, unknown>> {
  if (!isRecord(schema) || !isRecord(schema.paths)) return {};
  return schema.paths as Record<string, Record<string, unknown>>;
}

function corePathToResourceOperation(
  openApiPath: string,
  methods: Set<string>,
): { resource: string; operations: DynamicRecordOperation[] } | undefined {
  let match = openApiPath.match(/^\/batch\/([^/]+)$/);
  if (match) {
    const resource = match[1];
    if (resource === undefined) return undefined;
    return {
      resource,
      operations: [
        ...(methods.has("post") ? ["batch-create" as const] : []),
        ...(methods.has("patch") ? ["batch-update" as const] : []),
        ...(methods.has("delete") ? ["batch-delete" as const] : []),
      ],
    };
  }

  match = openApiPath.match(/^\/restore\/([^/]+)\/\{[^/]+\}$/);
  if (match && methods.has("patch")) {
    const resource = match[1];
    return resource === undefined ? undefined : { resource, operations: ["restore"] };
  }

  match = openApiPath.match(/^\/restore\/([^/]+)$/);
  if (match && methods.has("patch")) {
    const resource = match[1];
    return resource === undefined ? undefined : { resource, operations: ["restore"] };
  }

  match = openApiPath.match(/^\/([^/]+)\/\{[^/]+\}$/);
  if (match) {
    const resource = match[1];
    if (resource === undefined) return undefined;
    return {
      resource,
      operations: [
        ...(methods.has("get") ? ["get" as const] : []),
        ...(methods.has("patch") ? ["update" as const] : []),
        ...(methods.has("delete") ? (["delete", "destroy"] as const) : []),
      ],
    };
  }

  match = openApiPath.match(/^\/([^/]+)\/duplicates$/);
  if (match && methods.has("post")) {
    const resource = match[1];
    return resource === undefined ? undefined : { resource, operations: ["find-duplicates"] };
  }

  match = openApiPath.match(/^\/([^/]+)\/groupBy$/);
  if (match && methods.has("get")) {
    const resource = match[1];
    return resource === undefined ? undefined : { resource, operations: ["group-by"] };
  }

  match = openApiPath.match(/^\/([^/]+)\/merge$/);
  if (match && methods.has("patch")) {
    const resource = match[1];
    return resource === undefined ? undefined : { resource, operations: ["merge"] };
  }

  match = openApiPath.match(/^\/([^/]+)$/);
  if (match) {
    const resource = match[1];
    if (resource === undefined) return undefined;
    return {
      resource,
      operations: [
        ...(methods.has("get") ? ["list" as const] : []),
        ...(methods.has("post") ? ["create" as const] : []),
        ...(methods.has("patch") ? ["batch-update" as const] : []),
        ...(methods.has("delete") ? ["batch-delete" as const] : []),
      ],
    };
  }

  return undefined;
}

function metadataPathToResourceOperation(
  openApiPath: string,
  methods: Set<string>,
): { resource: string; operations: DynamicMetadataOperation[] } | undefined {
  let match = openApiPath.match(/^(?:\/metadata)?\/([^/]+)\/\{[^/]+\}$/);
  if (match) {
    const resource = match[1];
    if (resource === undefined) return undefined;
    return {
      resource,
      operations: [
        ...(methods.has("get") ? ["get" as const] : []),
        ...(methods.has("patch") ? ["update" as const] : []),
        ...(methods.has("delete") ? ["delete" as const] : []),
      ],
    };
  }

  match = openApiPath.match(/^(?:\/metadata)?\/([^/]+)$/);
  if (match) {
    const resource = match[1];
    if (resource === undefined) return undefined;
    return {
      resource,
      operations: [
        ...(methods.has("get") ? ["list" as const] : []),
        ...(methods.has("post") ? ["create" as const] : []),
      ],
    };
  }

  return undefined;
}

function normalizeOpenApiPath(openApiPath: string): string {
  return openApiPath.replace(/^\/rest(?=\/)/, "");
}

function sortOperations<TOperation extends string>(
  operations: TOperation[],
  order: readonly TOperation[],
): TOperation[] {
  return operations.sort((left, right) => order.indexOf(left) - order.indexOf(right));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
