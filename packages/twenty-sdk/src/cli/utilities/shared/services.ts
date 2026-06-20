import { ApiService } from "../api/services/api.service";
import { PublicHttpService } from "../api/services/public-http.service";
import { ConfigService } from "../config/services/config.service";
import { DbCapabilitiesService } from "../db/services/db-capabilities.service";
import { DbConfigResolverService } from "../db/services/db-config-resolver.service";
import { DbConnectionService } from "../db/services/db-connection.service";
import { DbProfileService } from "../db/services/db-profile.service";
import { DbRecordsReadService } from "../db/services/db-records-read.service";
import { DbSearchService } from "../db/services/db-search.service";
import { DbStatusService } from "../db/services/db-status.service";
import { ExportService } from "../file/services/export.service";
import { ImportService } from "../file/services/import.service";
import { McpService } from "../mcp/services/mcp.service";
import { MetadataService } from "../metadata/services/metadata.service";
import { OutputService } from "../output/services/output.service";
import { QueryService } from "../output/services/query.service";
import { TableService } from "../output/services/table.service";
import { ReadBackendService } from "../readbackend/read-backend.service";
import { SourceTracker } from "../readbackend/types";
import { ApiRecordsReadService } from "../records/services/api-records-read.service";
import { RecordsService } from "../records/services/records.service";
import { SchemaCacheService } from "../schema/schema-cache.service";
import { ApiSearchService } from "../search/services/api-search.service";
import { SearchService } from "../search/services/search.service";
import { GlobalOptions } from "./global-options";

export interface CliServices {
  config: ConfigService;
  dbProfiles: DbProfileService;
  dbStatus: DbStatusService;
  api: ApiService;
  publicHttp: PublicHttpService;
  search: SearchService;
  mcp: McpService;
  schemaCache: SchemaCacheService;
  records: RecordsService;
  metadata: MetadataService;
  output: OutputService;
  importer: ImportService;
  exporter: ExportService;
  sourceTracker: SourceTracker;
}

let lastSourceTracker: SourceTracker | undefined;

export function getLastSourceTracker(): SourceTracker | undefined {
  return lastSourceTracker;
}

export function resetLastSourceTracker(): void {
  lastSourceTracker = undefined;
}

export function createOutputService(
  globalOptions: GlobalOptions,
  sourceTracker?: SourceTracker,
): OutputService {
  return new OutputService(new TableService(), new QueryService(), {
    format: globalOptions.output,
    light: globalOptions.light,
    full: globalOptions.full,
    agentMode: globalOptions.agentMode,
    sourceTracker: globalOptions.agentMode ? sourceTracker : undefined,
  });
}

export async function createServices(globalOptions: GlobalOptions): Promise<CliServices> {
  const config = new ConfigService();
  const dbConnection = new DbConnectionService();
  const dbCapabilities = new DbCapabilitiesService();
  const sourceTracker = new SourceTracker();
  lastSourceTracker = sourceTracker;
  const dbProfiles = new DbProfileService(config, dbConnection);
  const dbConfigResolver = new DbConfigResolverService(dbProfiles);
  const dbStatus = new DbStatusService(dbConfigResolver, dbConnection);
  const api = new ApiService(config, {
    workspace: globalOptions.workspace,
    debug: globalOptions.debug,
    noRetry: globalOptions.noRetry,
  });
  const publicHttp = new PublicHttpService(config, {
    workspace: globalOptions.workspace,
    debug: globalOptions.debug,
    noRetry: globalOptions.noRetry,
  });
  const schemaCache = new SchemaCacheService(config, api);
  if (globalOptions.invalidateMetadataCache) {
    // Drop the on-disk metadata-objects entry before MetadataService can consult it.
    // Failures must not break the command; log via debug only and proceed.
    try {
      await schemaCache.clear({ kind: "metadata-objects" });
    } catch {
      // Best-effort invalidation; the cache miss path will still produce correct results.
    }
  }
  const metadata = new MetadataService(api, schemaCache);
  const apiSearch = new ApiSearchService(api);
  const apiRecordsRead = new ApiRecordsReadService(api);
  const readBackend = new ReadBackendService(
    dbConfigResolver,
    apiSearch,
    apiRecordsRead,
    {
      search: new DbSearchService(metadata, undefined, dbConnection, undefined, schemaCache),
      records: new DbRecordsReadService(
        metadata,
        undefined,
        undefined,
        dbConnection,
        undefined,
        schemaCache,
        dbCapabilities,
      ),
    },
    {
      workspace: globalOptions.workspace,
      readSource: globalOptions.readSource,
      agentMode: globalOptions.agentMode,
      sourceTracker,
    },
  );
  const search = new SearchService(api, readBackend);
  const mcp = new McpService(api, config, {
    workspace: globalOptions.workspace,
    debug: globalOptions.debug,
  });
  const records = new RecordsService(api, { readBackend });
  const output = createOutputService(globalOptions, sourceTracker);
  const importer = new ImportService();
  const exporter = new ExportService();

  return {
    config,
    dbProfiles,
    dbStatus,
    api,
    publicHttp,
    search,
    mcp,
    schemaCache,
    records,
    metadata,
    output,
    importer,
    exporter,
    sourceTracker,
  };
}
