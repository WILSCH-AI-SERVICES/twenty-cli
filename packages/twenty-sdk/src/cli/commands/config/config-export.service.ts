// `twenty config export` — the workspace configuration read back out as text.
//
// WHAT IT CARRIES. Objects with every field embedded, views with their fields, filters,
// filter groups, groups and sorts embedded, and roles with their permission flags, object
// permissions and field permissions. That is the metadata half of the floor: the data
// model, how it is looked at, and who may write.
//
// WHY THE EMISSION IS THE API'S OWN ORDER, UNTOUCHED. Two exports of an unchanged
// workspace must be byte-identical, and a reader must be able to trust that identity
// without sorting or normalising anything afterwards. The server returns each collection
// in a stable order (witnessed on Twenty v2.39.5: identical bytes across two reads with
// nothing changed, and again after a field was added and deleted), so this command keeps
// that order and the server's own key order, and serialises once with a fixed indent. No
// timestamps of its own, no sorting, no key reordering. What changes between two exports
// is what changed in the workspace.
//
// WHY EVERY LIST IS PAGED AND COUNTED. /rest/metadata/* answers at most 200 rows per page
// whatever `limit` asks for, and the CLI's plain `list` verbs take one page. A workspace
// with 589 fields read that way loses 389 of them silently — a field that exists reads as
// absent, and an export that omits it is a lie. So each collection is walked cursor by
// cursor to the last page, and the rows collected are compared with the server's own
// `totalCount`; a mismatch is a hard error, never a short export. Objects embed their
// fields, so the fields kind is cross-checked against /rest/metadata/fields' totalCount
// rather than fetched twice.
import { requireGraphqlField, type GraphQLResponse } from "../../utilities/api/graphql-response";
import {
  extractCollection,
  isRestObject,
  type RestObject,
} from "../../utilities/api/rest-response";
import { CliError } from "../../utilities/errors/cli-error";
import { GET_ROLES_WITH_PERMISSIONS_QUERY } from "../../utilities/metadata/roles-graphql";

export const CONFIG_EXPORT_FORMAT = "twenty-cli/config-export@1";
export const METADATA_PAGE_SIZE = 200;

export interface ConfigExportApi {
  get<T = unknown>(url: string, config?: { params?: Record<string, string> }): Promise<{ data: T }>;
  post<T = unknown>(url: string, data?: unknown): Promise<{ data: T }>;
}

export interface MetadataCollection {
  items: RestObject[];
  totalCount?: number;
  pages: number;
}

export interface ConfigExportCounts {
  objects: number;
  fields: number;
  views: number;
  viewFields: number;
  viewFilters: number;
  viewFilterGroups: number;
  viewGroups: number;
  viewSorts: number;
  roles: number;
  permissionFlags: number;
  objectPermissions: number;
  fieldPermissions: number;
}

export interface OmittedKind {
  kind: string;
  why: string;
}

export interface ConfigExportDocument {
  format: string;
  carries: ConfigExportCounts;
  omits: OmittedKind[];
  objects: RestObject[];
  views: RestObject[];
  roles: RestObject[];
}

// A kind present in the store and absent from the export is a gap the export states
// rather than one it passes over. These are the kinds the metadata store holds that this
// document does not carry, each with the reason.
export const OMITTED_KINDS: readonly OmittedKind[] = Object.freeze([
  {
    kind: "apiKeys",
    why: "credentials and their role bindings are secrets, not configuration; `twenty api-keys list` reads them",
  },
  {
    kind: "webhooks",
    why: "integration endpoints, read with `twenty webhooks list`",
  },
  {
    kind: "workflows",
    why: "automation, read with `twenty workflows list`",
  },
  {
    kind: "pageLayouts",
    why: "record-page layout, not data-model configuration; `twenty api-metadata page-layouts list` reads it",
  },
  {
    kind: "rowLevelPermissionPredicates",
    why: "licence-gated on self-hosted builds; the server refuses to configure them",
  },
  {
    kind: "records",
    why: "data, not configuration; `twenty api export` is that round trip",
  },
]);

interface MetadataPageEnvelope {
  totalCount?: unknown;
  pageInfo?: unknown;
}

export async function collectMetadataPages(
  api: ConfigExportApi,
  path: string,
  key: string,
  pageSize = METADATA_PAGE_SIZE,
): Promise<MetadataCollection> {
  const items: RestObject[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | undefined;
  let totalCount: number | undefined;
  let pages = 0;

  for (;;) {
    const params: Record<string, string> = { limit: String(pageSize) };
    if (cursor) {
      params.starting_after = cursor;
    }

    const response = await api.get<unknown>(path, { params });
    const payload = response.data;
    pages += 1;
    items.push(...extractCollection(payload, key));

    const envelope: MetadataPageEnvelope = isRestObject(payload) ? payload : {};
    if (typeof envelope.totalCount === "number") {
      totalCount = envelope.totalCount;
    }

    const pageInfo = isRestObject(envelope.pageInfo) ? envelope.pageInfo : undefined;
    if (pageInfo?.hasNextPage !== true) {
      break;
    }

    const endCursor = typeof pageInfo.endCursor === "string" ? pageInfo.endCursor : undefined;
    if (!endCursor || seenCursors.has(endCursor)) {
      throw new CliError(
        `${path} reports another page after ${items.length} rows but gave no usable cursor; refusing to emit a short export.`,
        "API_ERROR",
      );
    }

    seenCursors.add(endCursor);
    cursor = endCursor;
  }

  if (totalCount !== undefined && totalCount !== items.length) {
    throw new CliError(
      `${path} returned ${items.length} rows but reports totalCount ${totalCount}; refusing to emit an export that would silently omit ${totalCount - items.length} rows.`,
      "API_ERROR",
    );
  }

  return { items, totalCount, pages };
}

export async function readMetadataTotalCount(
  api: ConfigExportApi,
  path: string,
): Promise<number | undefined> {
  const response = await api.get<unknown>(path, { params: { limit: "1" } });
  const payload = response.data;

  return isRestObject(payload) && typeof payload.totalCount === "number"
    ? payload.totalCount
    : undefined;
}

export async function listRolesWithPermissions(api: ConfigExportApi): Promise<RestObject[]> {
  const response = await api.post<GraphQLResponse<Record<string, unknown>>>("/metadata", {
    query: GET_ROLES_WITH_PERMISSIONS_QUERY,
  });
  const roles = requireGraphqlField(response.data ?? {}, "getRoles", "Failed to list roles.");

  return Array.isArray(roles) ? roles.filter(isRestObject) : [];
}

export function countEmbedded(items: readonly RestObject[], key: string): number {
  return items.reduce((sum, item) => {
    const value = item[key];

    return sum + (Array.isArray(value) ? value.length : 0);
  }, 0);
}

export function buildConfigExportDocument(input: {
  objects: RestObject[];
  views: RestObject[];
  roles: RestObject[];
}): ConfigExportDocument {
  const { objects, views, roles } = input;

  return {
    format: CONFIG_EXPORT_FORMAT,
    carries: {
      objects: objects.length,
      fields: countEmbedded(objects, "fields"),
      views: views.length,
      viewFields: countEmbedded(views, "viewFields"),
      viewFilters: countEmbedded(views, "viewFilters"),
      viewFilterGroups: countEmbedded(views, "viewFilterGroups"),
      viewGroups: countEmbedded(views, "viewGroups"),
      viewSorts: countEmbedded(views, "viewSorts"),
      roles: roles.length,
      permissionFlags: countEmbedded(roles, "permissionFlags"),
      objectPermissions: countEmbedded(roles, "objectPermissions"),
      fieldPermissions: countEmbedded(roles, "fieldPermissions"),
    },
    omits: [...OMITTED_KINDS],
    objects,
    views,
    roles,
  };
}

// One serialisation, fixed indent, trailing newline. The document's key order and every
// array's order are exactly what was assembled above, which is exactly what the server
// returned.
export function serializeConfigExport(document: ConfigExportDocument): string {
  return `${JSON.stringify(document, null, 2)}\n`;
}

export async function runConfigExport(
  api: ConfigExportApi,
): Promise<{ document: ConfigExportDocument; text: string }> {
  const objects = await collectMetadataPages(api, "/rest/metadata/objects", "objects");

  const embeddedFields = countEmbedded(objects.items, "fields");
  const fieldsTotal = await readMetadataTotalCount(api, "/rest/metadata/fields");
  if (fieldsTotal !== undefined && fieldsTotal !== embeddedFields) {
    throw new CliError(
      `objects embed ${embeddedFields} fields but /rest/metadata/fields reports totalCount ${fieldsTotal}; refusing to emit an export whose fields do not match the store.`,
      "API_ERROR",
    );
  }

  const views = await collectMetadataPages(api, "/rest/metadata/views", "views");
  const roles = await listRolesWithPermissions(api);

  const document = buildConfigExportDocument({
    objects: objects.items,
    views: views.items,
    roles,
  });

  return { document, text: serializeConfigExport(document) };
}
