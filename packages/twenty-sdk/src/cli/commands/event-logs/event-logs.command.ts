import { Command } from "commander";

import { assertGraphqlSuccess, type GraphQLResponse } from "../../utilities/api/graphql-response";
import { CliError } from "../../utilities/errors/cli-error";
import { createCommandContext } from "../../utilities/shared/context";
import { applyGlobalOptions } from "../../utilities/shared/global-options";

interface EventLogsOptions {
  table?: string;
  limit?: string;
  cursor?: string;
  eventType?: string;
  userWorkspaceId?: string;
  recordId?: string;
  objectMetadataId?: string;
  start?: string;
  end?: string;
  includePageInfo?: boolean;
}

interface EventLogsResult {
  records: unknown[];
  totalCount: number;
  pageInfo: {
    endCursor?: string | null;
    hasNextPage: boolean;
  };
}

const endpoint = "/metadata";

const EVENT_LOGS_QUERY = `query EventLogs($input: EventLogQueryInput!) {
  eventLogs(input: $input) {
    records {
      event
      timestamp
      userId
      properties
      recordId
      objectMetadataId
      isCustom
    }
    totalCount
    pageInfo {
      endCursor
      hasNextPage
    }
  }
}`;

const EVENT_LOG_TABLES = {
  "workspace-event": "WORKSPACE_EVENT",
  pageview: "PAGEVIEW",
  "object-event": "OBJECT_EVENT",
  "usage-event": "USAGE_EVENT",
} as const;

type EventLogTable = (typeof EVENT_LOG_TABLES)[keyof typeof EVENT_LOG_TABLES];

export function registerEventLogsCommand(program: Command): void {
  const cmd = program.command("event-logs").description("Query enterprise event logs");
  applyGlobalOptions(cmd);

  const listCmd = cmd.command("list").description("List event logs");
  listCmd
    .requiredOption(
      "--table <table>",
      "Event log table: workspace-event, pageview, object-event, usage-event",
    )
    .option("--limit <count>", "Number of records to fetch", "100")
    .option("--cursor <cursor>", "Pagination cursor")
    .option("--event-type <type>", "Filter by event type")
    .option("--user-workspace-id <id>", "Filter by user workspace ID")
    .option("--record-id <id>", "Filter by record ID")
    .option("--object-metadata-id <id>", "Filter by object metadata ID")
    .option("--start <date>", "Filter start timestamp (ISO-8601)")
    .option("--end <date>", "Filter end timestamp (ISO-8601)")
    .option("--include-page-info", "Render records plus totalCount and pageInfo");
  applyGlobalOptions(listCmd);
  listCmd.action(async (options: EventLogsOptions, command: Command) => {
    const { globalOptions, services } = await createCommandContext(command);
    const input = buildEventLogsInput(options);
    const response = await services.api.post<GraphQLResponse<{ eventLogs: EventLogsResult }>>(
      endpoint,
      {
        query: EVENT_LOGS_QUERY,
        variables: { input },
      },
    );
    const data = assertGraphqlSuccess(response.data ?? {}, "Failed to query event logs.");
    const result = data.eventLogs ?? {
      records: [],
      totalCount: 0,
      pageInfo: { hasNextPage: false, endCursor: null },
    };

    await services.output.render(options.includePageInfo ? result : result.records, {
      format: globalOptions.output,
      query: globalOptions.query,
    });
  });
}

function buildEventLogsInput(options: EventLogsOptions): Record<string, unknown> {
  const input: Record<string, unknown> = {
    table: normalizeTable(options.table),
    first: parsePositiveInteger(options.limit ?? "100", "--limit"),
  };

  if (options.cursor) {
    input.after = options.cursor;
  }

  const filters = buildEventLogFilters(options);
  if (filters) {
    input.filters = filters;
  }

  return input;
}

function buildEventLogFilters(options: EventLogsOptions): Record<string, unknown> | undefined {
  const filters: Record<string, unknown> = {};

  if (options.eventType) {
    filters.eventType = options.eventType;
  }
  if (options.userWorkspaceId) {
    filters.userWorkspaceId = options.userWorkspaceId;
  }
  if (options.recordId) {
    filters.recordId = options.recordId;
  }
  if (options.objectMetadataId) {
    filters.objectMetadataId = options.objectMetadataId;
  }

  const dateRange: Record<string, string> = {};
  if (options.start) {
    dateRange.start = options.start;
  }
  if (options.end) {
    dateRange.end = options.end;
  }
  if (Object.keys(dateRange).length > 0) {
    filters.dateRange = dateRange;
  }

  return Object.keys(filters).length > 0 ? filters : undefined;
}

function normalizeTable(rawTable: string | undefined): EventLogTable {
  const normalized = rawTable?.toLowerCase();
  const table = normalized
    ? EVENT_LOG_TABLES[normalized as keyof typeof EVENT_LOG_TABLES]
    : undefined;

  if (!table) {
    throw new CliError(
      `Unsupported --table "${rawTable}". Expected one of: ${Object.keys(EVENT_LOG_TABLES).join(", ")}.`,
      "INVALID_ARGUMENTS",
    );
  }

  return table;
}

function parsePositiveInteger(rawValue: string, label: string): number {
  const parsed = Number.parseInt(rawValue, 10);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new CliError(`${label} must be a positive integer.`, "INVALID_ARGUMENTS");
  }

  return parsed;
}
