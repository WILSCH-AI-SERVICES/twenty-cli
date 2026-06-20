import type { ResolvedDbConfig } from "../db/services/db-config-resolver.service";
import type {
  GetOptions,
  GroupByParams,
  ListOptions,
  ListResponse,
} from "../records/services/api-records-read.service";
import type { SearchOptions, SearchResponse } from "../search/services/api-search.service";

export class UnsupportedDbReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedDbReadError";
  }
}

export class DbConnectionError extends Error {
  readonly code?: string;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = "DbConnectionError";

    const cause = options?.cause as { code?: unknown } | undefined;
    if (cause && typeof cause.code === "string") {
      this.code = cause.code;
    }

    if (options?.cause !== undefined) {
      Object.defineProperty(this, "cause", {
        value: options.cause,
        enumerable: false,
        configurable: true,
      });
    }
  }
}

export type ReadSourceMark = "db" | "api" | "mixed";

export interface ReadFallbackMetadata {
  from: "db";
  to: "api";
  reason: string;
}

export interface ReadOutputMetadata {
  read: {
    source: ReadSourceMark;
    fallback?: ReadFallbackMetadata;
  };
}

export class SourceTracker {
  private sawDb = false;
  private sawApi = false;

  lastFallbackReason?: string;

  mark(source: "db" | "api"): void {
    if (source === "db") {
      this.sawDb = true;
      return;
    }

    this.sawApi = true;
  }

  recordFallback(reason: string): void {
    this.lastFallbackReason = reason;
  }

  outputSource(): ReadSourceMark | undefined {
    if (this.sawDb && this.sawApi) return "mixed";
    if (this.sawDb) return "db";
    if (this.sawApi) return "api";
    return undefined;
  }

  outputMetadata(): ReadOutputMetadata | undefined {
    const source = this.outputSource();
    if (!source) {
      return undefined;
    }

    const fallback = this.lastFallbackReason
      ? {
          from: "db" as const,
          to: "api" as const,
          reason: this.lastFallbackReason,
        }
      : undefined;

    return {
      read: fallback ? { source, fallback } : { source },
    };
  }
}

export interface SearchReadBackend {
  runSearch(options: SearchOptions): Promise<SearchResponse>;
}

export interface DbSearchReadService {
  search(target: ResolvedDbConfig, options: SearchOptions): Promise<SearchResponse>;
}

export interface RecordsReadBackend {
  list(object: string, options?: ListOptions): Promise<ListResponse>;
  listAll(object: string, options?: ListOptions): Promise<ListResponse>;
  get(object: string, id: string, options?: GetOptions): Promise<unknown>;
  groupBy(object: string, payload?: unknown, params?: GroupByParams): Promise<unknown>;
}

export interface DbRecordsReadService {
  list(target: ResolvedDbConfig, object: string, options?: ListOptions): Promise<ListResponse>;
  listAll(target: ResolvedDbConfig, object: string, options?: ListOptions): Promise<ListResponse>;
  get(target: ResolvedDbConfig, object: string, id: string, options?: GetOptions): Promise<unknown>;
  groupBy(
    target: ResolvedDbConfig,
    object: string,
    payload?: unknown,
    params?: GroupByParams,
  ): Promise<unknown>;
}

export interface ReadBackendDbReads {
  search?: DbSearchReadService;
  records?: Partial<DbRecordsReadService>;
}
