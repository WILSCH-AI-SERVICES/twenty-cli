import type {
  DbConfigResolverService,
  ResolvedDbConfig,
} from "../db/services/db-config-resolver.service";
import { redactDbSecrets } from "../db/services/db-secret-redaction.service";
import type {
  ApiRecordsReadService,
  GetOptions,
  GroupByParams,
  ListOptions,
  ListResponse,
} from "../records/services/api-records-read.service";
import type {
  ApiSearchService,
  SearchOptions,
  SearchResponse,
} from "../search/services/api-search.service";
import type { ReadSource } from "../shared/global-options";
import { extractSqlState, shouldFallbackToApi } from "./fallback-classifier";
import {
  type ReadBackendDbReads,
  type RecordsReadBackend,
  type SearchReadBackend,
  type SourceTracker,
} from "./types";

type DbConfigResolver = Pick<DbConfigResolverService, "resolve">;
type ApiSearchReader = Pick<ApiSearchService, "search">;
type ApiRecordsReader = Pick<ApiRecordsReadService, "list" | "listAll" | "get" | "groupBy">;

interface ReadBackendServiceOptions {
  workspace?: string;
  readSource?: ReadSource;
  agentMode?: boolean;
  reportFallback?: (error: unknown) => void;
  sourceTracker?: SourceTracker;
}

export class ReadBackendService implements SearchReadBackend, RecordsReadBackend {
  constructor(
    private readonly dbConfigResolver: DbConfigResolver,
    private readonly apiSearch: ApiSearchReader,
    private readonly apiRecords?: ApiRecordsReader,
    private readonly dbReads: ReadBackendDbReads = {},
    private readonly options: ReadBackendServiceOptions = {},
  ) {}

  async runSearch(options: SearchOptions): Promise<SearchResponse> {
    return this.runRead(
      () => this.apiSearch.search(options),
      this.dbReads.search ? (target) => this.dbReads.search!.search(target, options) : undefined,
    );
  }

  async list(object: string, options: ListOptions = {}): Promise<ListResponse> {
    return this.runRead(
      () => this.requireApiRecords().list(object, options),
      this.dbReads.records?.list
        ? (target) => this.dbReads.records!.list!(target, object, options)
        : undefined,
    );
  }

  async listAll(object: string, options: ListOptions = {}): Promise<ListResponse> {
    return this.runRead(
      () => this.requireApiRecords().listAll(object, options),
      this.dbReads.records?.listAll
        ? (target) => this.dbReads.records!.listAll!(target, object, options)
        : undefined,
    );
  }

  async get(object: string, id: string, options?: GetOptions): Promise<unknown> {
    return this.runRead(
      () => this.requireApiRecords().get(object, id, options),
      this.dbReads.records?.get
        ? (target) => this.dbReads.records!.get!(target, object, id, options)
        : undefined,
    );
  }

  async groupBy(object: string, payload?: unknown, params?: GroupByParams): Promise<unknown> {
    return this.runRead(
      () => this.requireApiRecords().groupBy(object, payload, params),
      this.dbReads.records?.groupBy
        ? (target) => this.dbReads.records!.groupBy!(target, object, payload, params)
        : undefined,
    );
  }

  private async runRead<T>(
    apiRead: () => Promise<T>,
    dbRead?: (target: ResolvedDbConfig) => Promise<T>,
  ): Promise<T> {
    const target = await this.dbConfigResolver.resolve({
      workspace: this.options.workspace,
      readSource: this.options.readSource,
    });

    const strictApi = this.options.readSource === "api";
    const strictDb = this.options.readSource === "db";

    if (strictApi || target.mode !== "db" || !dbRead) {
      this.options.sourceTracker?.mark("api");
      return apiRead();
    }

    try {
      const result = await dbRead(target);
      this.options.sourceTracker?.mark("db");
      return result;
    } catch (error) {
      if (!strictDb && shouldFallbackToApi(error)) {
        this.options.sourceTracker?.recordFallback(describeFallback(error));
        this.options.sourceTracker?.mark("api");
        this.options.reportFallback?.(error);
        return apiRead();
      }

      throw error;
    }
  }

  private requireApiRecords(): ApiRecordsReader {
    if (!this.apiRecords) {
      throw new Error("ReadBackendService requires API records support for records reads.");
    }

    return this.apiRecords;
  }
}

function describeFallback(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? "unknown error");
  const sqlState = extractSqlState(error);
  const reason = sqlState ? `${message} (${sqlState})` : message;

  return redactDbSecrets(reason) ?? reason;
}
