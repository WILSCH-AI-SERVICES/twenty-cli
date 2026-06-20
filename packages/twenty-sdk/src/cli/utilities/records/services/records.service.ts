import { extractFirstValue, getDataSection } from "../../api/rest-response";
import { ApiService } from "../../api/services/api.service";
import { CliError } from "../../errors/cli-error";
import type { RecordsReadBackend } from "../../readbackend/types";
import { capitalize, singularize } from "../../shared/parse";
import { DEFAULT_BATCH_UPDATE_CONCURRENCY } from "../record-bounds";
import {
  ApiRecordsReadService,
  type GetOptions,
  type GroupByParams,
  type ListOptions,
  type ListResponse,
} from "./api-records-read.service";

export type {
  GetOptions,
  GroupByParams,
  ListOptions,
  ListResponse,
  PageInfo,
} from "./api-records-read.service";

interface BulkMutationOptions {
  filter: string;
  include?: string;
}

interface RecordsServiceDependencies {
  readBackend?: RecordsReadBackend;
}

interface BatchUpdateOptions {
  concurrency?: number;
}

export class RecordsService {
  private readonly readBackend: RecordsReadBackend;

  constructor(
    private readonly api: ApiService,
    dependencies: RecordsServiceDependencies = {},
  ) {
    this.readBackend = dependencies.readBackend ?? new ApiRecordsReadService(api);
  }

  async list(object: string, options: ListOptions = {}): Promise<ListResponse> {
    return this.readBackend.list(object, options);
  }

  async listAll(object: string, options: ListOptions = {}): Promise<ListResponse> {
    const all: unknown[] = [];
    let cursor = options.cursor ?? "";
    let pageInfo: ListResponse["pageInfo"];
    let totalCount: number | undefined;

    while (true) {
      const response = await this.readBackend.list(object, { ...options, cursor });
      all.push(...response.data);
      if (options.maxRecords !== undefined && all.length > options.maxRecords) {
        throw new CliError(
          options.maxRecordsErrorMessage ??
            `Fetching ${object} exceeded --max-records ${options.maxRecords}. Re-run with --max-records <n> or add a filter.`,
          "INVALID_ARGUMENTS",
        );
      }

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
    return this.readBackend.get(object, id, options);
  }

  async create(object: string, data: Record<string, unknown>): Promise<unknown> {
    const response = await this.api.post(`/rest/${object}`, data);
    const dataSection = getDataSection(response.data);
    const key = `create${capitalize(singularize(object))}`;
    return dataSection[key] ?? extractFirstValue(dataSection);
  }

  async update(object: string, id: string, data: Record<string, unknown>): Promise<unknown> {
    const response = await this.api.patch(`/rest/${object}/${id}`, data);
    const dataSection = getDataSection(response.data);
    const key = `update${capitalize(singularize(object))}`;
    return dataSection[key] ?? extractFirstValue(dataSection);
  }

  async delete(object: string, id: string): Promise<unknown> {
    const response = await this.api.delete(`/rest/${object}/${id}`, {
      params: { soft_delete: "true" },
    });
    return response.data ?? null;
  }

  async destroy(object: string, id: string): Promise<unknown> {
    const response = await this.api.delete(`/rest/${object}/${id}`);
    return response.data ?? null;
  }

  async restore(object: string, id: string): Promise<unknown> {
    const response = await this.api.patch(`/rest/restore/${object}/${id}`);
    return response.data ?? null;
  }

  async batchCreate(object: string, records: Record<string, unknown>[]): Promise<unknown> {
    const response = await this.api.post(`/rest/batch/${object}`, records);
    return response.data ?? null;
  }

  async batchUpdate(
    object: string,
    records: Record<string, unknown>[],
    options: BatchUpdateOptions = {},
  ): Promise<unknown> {
    const concurrency = options.concurrency ?? DEFAULT_BATCH_UPDATE_CONCURRENCY;
    const updates: unknown[] = new Array(records.length);
    let nextIndex = 0;

    const worker = async () => {
      while (nextIndex < records.length) {
        const index = nextIndex;
        nextIndex += 1;
        const record = records[index]!;
        const id = extractRecordId(record);
        const { id: _ignoredId, ...data } = record;
        updates[index] = await this.update(object, id, data);
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(concurrency, records.length) }, () => worker()),
    );

    return updates;
  }

  async updateMany(
    object: string,
    data: Record<string, unknown>,
    options: BulkMutationOptions,
  ): Promise<unknown> {
    const response = await this.api.patch(`/rest/${object}`, data, {
      params: buildBulkParams(options),
    });
    return response.data ?? null;
  }

  async batchDelete(object: string, ids: string[]): Promise<unknown> {
    const filter = `id[in]:[${ids.join(",")}]`;
    const response = await this.api.delete(`/rest/${object}`, {
      params: {
        filter,
        soft_delete: "true",
      },
    });
    return response.data ?? null;
  }

  async restoreMany(object: string, options: BulkMutationOptions): Promise<unknown> {
    const response = await this.api.patch(`/rest/restore/${object}`, undefined, {
      params: buildBulkParams(options),
    });
    return response.data ?? null;
  }

  async destroyMany(object: string, options: BulkMutationOptions): Promise<unknown> {
    const response = await this.api.delete(`/rest/${object}`, {
      params: buildBulkParams(options),
    });
    return response.data ?? null;
  }

  async groupBy(object: string, payload?: unknown, params?: GroupByParams): Promise<unknown> {
    return this.readBackend.groupBy(object, payload, params);
  }

  async findDuplicates(object: string, payload: unknown): Promise<unknown> {
    const response = await this.api.post(`/rest/${object}/duplicates`, payload);
    return response.data ?? null;
  }

  async merge(object: string, payload: unknown): Promise<unknown> {
    const response = await this.api.patch(`/rest/${object}/merge`, payload);
    return response.data ?? null;
  }
}

function extractRecordId(record: Record<string, unknown>): string {
  const id = record.id;

  if (typeof id !== "string" || id.length === 0) {
    throw new CliError(
      "Batch update requires every record to include a string id.",
      "INVALID_ARGUMENTS",
    );
  }

  return id;
}

function buildBulkParams(options: BulkMutationOptions): Record<string, string> {
  const params: Record<string, string> = {
    filter: options.filter,
  };

  if (options.include) {
    params.depth = "1";
  }

  return params;
}
