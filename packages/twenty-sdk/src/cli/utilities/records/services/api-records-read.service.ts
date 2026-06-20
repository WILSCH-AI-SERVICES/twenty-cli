import { extractCollection, extractFirstValue, getDataSection } from "../../api/rest-response";
import { ApiService } from "../../api/services/api.service";
import { singularize } from "../../shared/parse";

type RecordsApiClient = Pick<ApiService, "get">;

export interface ListOptions {
  limit?: number;
  cursor?: string;
  filter?: string;
  sort?: string;
  order?: string;
  include?: string;
  params?: Record<string, string[]>;
  totalCount?: boolean;
  maxRecords?: number;
  maxRecordsErrorMessage?: string;
}

export interface GetOptions {
  include?: string;
}

export interface PageInfo {
  hasNextPage?: boolean;
  endCursor?: string;
}

export interface ListResponse {
  data: unknown[];
  totalCount?: number;
  pageInfo?: PageInfo;
}

export type GroupByParams = Record<string, string[]>;

export class ApiRecordsReadService {
  constructor(private readonly api: RecordsApiClient) {}

  async list(object: string, options: ListOptions = {}): Promise<ListResponse> {
    const params: Record<string, string | string[]> = {};
    if (options.limit) params.limit = String(options.limit);
    if (options.cursor) params.starting_after = options.cursor;
    if (options.sort) params.order_by = formatOrderBy(options.sort, options.order);
    if (options.include) params.depth = "1";
    if (options.filter) params.filter = options.filter;
    if (options.params) {
      for (const [key, values] of Object.entries(options.params)) {
        if (values.length === 0) continue;
        params[key] = values.length === 1 ? values[0]! : values;
      }
    }

    const response = await this.api.get(`/rest/${object}`, { params });
    const payload = response.data;
    const dataSection = getDataSection(payload);
    const records = extractCollection({ data: dataSection }, object);
    return {
      data: records,
      totalCount: isRecord(payload) ? (payload.totalCount as number | undefined) : undefined,
      pageInfo: isRecord(payload) ? (payload.pageInfo as PageInfo | undefined) : undefined,
    };
  }

  async listAll(object: string, options: ListOptions = {}): Promise<ListResponse> {
    const all: unknown[] = [];
    let cursor = options.cursor ?? "";
    let pageInfo: PageInfo | undefined;
    let totalCount: number | undefined;

    while (true) {
      const response = await this.list(object, { ...options, cursor });
      all.push(...response.data);
      pageInfo = response.pageInfo;
      totalCount = response.totalCount ?? totalCount;
      if (!pageInfo?.hasNextPage || !pageInfo?.endCursor) {
        break;
      }
      cursor = pageInfo.endCursor;
    }

    return { data: all, totalCount, pageInfo };
  }

  async get(object: string, id: string, options?: GetOptions): Promise<unknown> {
    const params: Record<string, string> = {};
    if (options?.include) {
      params.depth = "1";
    }
    const response = await this.api.get(`/rest/${object}/${id}`, { params });
    const dataSection = getDataSection(response.data);
    const singular = singularize(object);
    return dataSection[singular] ?? dataSection[object] ?? extractFirstValue(dataSection);
  }

  async groupBy(object: string, payload?: unknown, params?: GroupByParams): Promise<unknown> {
    const path = `/rest/${object}/groupBy`;
    const response = await this.api.get(path, {
      params: {
        ...flattenParams(params),
        ...serializeGroupByPayload(payload),
      },
    });
    return response.data ?? null;
  }
}

function flattenParams(
  params?: Record<string, string[]>,
): Record<string, string | string[]> | undefined {
  if (!params) return undefined;
  const out: Record<string, string | string[]> = {};
  for (const [key, values] of Object.entries(params)) {
    if (values.length === 0) continue;
    out[key] = values.length === 1 ? values[0]! : values;
  }
  return out;
}

function formatOrderBy(sort: string, order?: string): string {
  const direction = order?.toLowerCase() === "desc" ? "DescNullsLast" : "AscNullsFirst";

  return `${sort}[${direction}]`;
}

function serializeGroupByPayload(payload?: unknown): Record<string, string | string[]> {
  if (Array.isArray(payload)) {
    return {
      group_by: JSON.stringify(payload),
    };
  }

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return {};
  }

  const serialized: Record<string, string | string[]> = {};

  for (const [key, value] of Object.entries(payload)) {
    if (value === undefined) {
      continue;
    }

    if (key === "groupBy" || key === "group_by") {
      serialized.group_by = JSON.stringify(value);
      continue;
    }

    if (key === "orderBy" || key === "order_by") {
      serialized.order_by = JSON.stringify(value);
      continue;
    }

    if (key === "viewId" || key === "view_id") {
      serialized.view_id = String(value);
      continue;
    }

    if (key === "includeRecordsSample" || key === "include_records_sample") {
      serialized.include_records_sample = String(value);
      continue;
    }

    if (key === "filter" && isRecord(value)) {
      serialized.filter = serializeFilter(value);
      continue;
    }

    if (Array.isArray(value)) {
      serialized[key] = value.map(String);
      continue;
    }

    serialized[key] = typeof value === "object" ? JSON.stringify(value) : String(value);
  }

  return serialized;
}

function serializeFilter(filter: Record<string, unknown>): string {
  return Object.entries(filter)
    .map(([field, condition]) => {
      if (!isRecord(condition)) {
        return `${field}[eq]:${String(condition)}`;
      }

      const clauses = Object.entries(condition).map(([operator, value]) => {
        if (Array.isArray(value)) {
          return `${field}[${operator}]:[${value.map(String).join(",")}]`;
        }

        return `${field}[${operator}]:${String(value)}`;
      });

      return clauses.join(";");
    })
    .join(";");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
