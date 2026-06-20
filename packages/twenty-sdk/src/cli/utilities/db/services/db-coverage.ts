export type DbCoverageStatus =
  | "db_backed_read"
  | "partial_db_read"
  | "api_only_read"
  | "api_only_mutation"
  | "local_only"
  | "raw_api_escape_hatch";

export type DbCoverageBackend = "db" | "api" | "mixed" | "local";
export type DbCoveragePriority = "P0" | "P1" | "P2" | "P3" | "P4";

export interface DbCoverageEntry {
  command: string;
  family: string;
  status: DbCoverageStatus;
  currentBackend: DbCoverageBackend;
  targetBackend: Exclude<DbCoverageBackend, "mixed">;
  priority: DbCoveragePriority;
  blocker?: string;
}

export interface DbCoverageReport {
  items: DbCoverageEntry[];
  meta: {
    total: number;
    statuses: Record<DbCoverageStatus, number>;
    priorities: Record<DbCoveragePriority, number>;
  };
}

const DB_READ_COMMANDS = new Set(["api list", "api get", "search"]);
const RAW_ESCAPE_COMMANDS = new Set(["api raw", "raw graphql", "raw rest", "graphql"]);
const LOCAL_ONLY_PREFIXES = ["auth", "coverage", "db", "help", "mcp", "schema"];
const MUTATION_OPERATIONS =
  /\b(batch-create|batch-delete|batch-update|create|delete|destroy|execute|merge|publish|restore|revoke|update)\b/;
const READ_OPERATIONS = /\b(find|find-duplicates|get|group-by|list|logs|packages|search|source)\b/;

const ZERO_STATUSES: Record<DbCoverageStatus, number> = {
  db_backed_read: 0,
  partial_db_read: 0,
  api_only_read: 0,
  api_only_mutation: 0,
  local_only: 0,
  raw_api_escape_hatch: 0,
};

const ZERO_PRIORITIES: Record<DbCoveragePriority, number> = {
  P0: 0,
  P1: 0,
  P2: 0,
  P3: 0,
  P4: 0,
};

export function buildDbCoverage(commands: string[]): DbCoverageReport {
  const items = commands.map(buildDbCoverageEntry);
  const statuses = { ...ZERO_STATUSES };
  const priorities = { ...ZERO_PRIORITIES };

  for (const item of items) {
    statuses[item.status] += 1;
    priorities[item.priority] += 1;
  }

  return {
    items,
    meta: {
      total: items.length,
      statuses,
      priorities,
    },
  };
}

export function renderDbCoverageMarkdown(report: DbCoverageReport): string {
  const columns = ["command", "status", "current", "target", "priority", "blocker"];
  return [
    `| ${columns.join(" | ")} |`,
    `| ${columns.map(() => "---").join(" | ")} |`,
    ...report.items
      .map((item) =>
        [
          item.command,
          item.status,
          item.currentBackend,
          item.targetBackend,
          item.priority,
          item.blocker ?? "",
        ]
          .map(formatMarkdownCell)
          .join(" | "),
      )
      .map((row) => `| ${row} |`),
  ].join("\n");
}

function buildDbCoverageEntry(command: string): DbCoverageEntry {
  const status = classifyCommand(command);
  const family = command.split(" ")[0] ?? command;
  const entry: DbCoverageEntry = {
    command,
    family,
    status,
    currentBackend: currentBackendForStatus(status),
    targetBackend: targetBackendForStatus(status),
    priority: priorityForStatus(status),
  };
  const blocker = blockerForStatus(status);

  return blocker === undefined ? entry : { ...entry, blocker };
}

function classifyCommand(command: string): DbCoverageStatus {
  if (DB_READ_COMMANDS.has(command)) {
    return "db_backed_read";
  }

  if (RAW_ESCAPE_COMMANDS.has(command)) {
    return "raw_api_escape_hatch";
  }

  if (
    LOCAL_ONLY_PREFIXES.some((prefix) => command === prefix || command.startsWith(`${prefix} `))
  ) {
    return "local_only";
  }

  if (MUTATION_OPERATIONS.test(command)) {
    return "api_only_mutation";
  }

  if (READ_OPERATIONS.test(command)) {
    return "api_only_read";
  }

  return "api_only_read";
}

function currentBackendForStatus(status: DbCoverageStatus): DbCoverageBackend {
  if (status === "db_backed_read") {
    return "db";
  }

  if (status === "partial_db_read") {
    return "mixed";
  }

  if (status === "local_only") {
    return "local";
  }

  return "api";
}

function targetBackendForStatus(status: DbCoverageStatus): Exclude<DbCoverageBackend, "mixed"> {
  if (status === "local_only") {
    return "local";
  }

  if (status === "api_only_mutation" || status === "raw_api_escape_hatch") {
    return "api";
  }

  return "db";
}

function priorityForStatus(status: DbCoverageStatus): DbCoveragePriority {
  if (status === "api_only_read") {
    return "P1";
  }

  if (status === "partial_db_read") {
    return "P2";
  }

  return "P4";
}

function blockerForStatus(status: DbCoverageStatus): string | undefined {
  return status === "api_only_read" ? "no db reader implemented" : undefined;
}

function formatMarkdownCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}
