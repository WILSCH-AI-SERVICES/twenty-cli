import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { Command } from "commander";
import fs from "fs-extra";
import type { Client } from "pg";

import {
  type BenchmarkFixture,
  DEFAULT_BENCHMARK_QUERY,
} from "../../utilities/db/services/db-benchmark-operations";
import {
  DEFAULT_BENCHMARK_ITERATIONS,
  DEFAULT_BENCHMARK_WARMUP,
  DbBenchmarkService,
} from "../../utilities/db/services/db-benchmark.service";
import {
  DbConfigResolverService,
  type ResolvedDbConfig,
} from "../../utilities/db/services/db-config-resolver.service";
import { DbConnectionService } from "../../utilities/db/services/db-connection.service";
import { buildDbCoverage, renderDbCoverageMarkdown } from "../../utilities/db/services/db-coverage";
import { DbMetadataPlannerService } from "../../utilities/db/services/db-metadata-planner.service";
import { buildOrderByForKeyset, quoteColumn } from "../../utilities/db/services/db-records-sql";
import {
  redactDbSecrets,
  redactDbProfile,
  redactDbProfiles,
} from "../../utilities/db/services/db-secret-redaction.service";
import {
  quoteIdentifier,
  quoteTableReference,
  type DbTableReference,
} from "../../utilities/db/services/db-sql-identifiers";
import type { DbDoctorSummary } from "../../utilities/db/services/db-status.service";
import { DbTableResolverService } from "../../utilities/db/services/db-table-resolver.service";
import { CliError } from "../../utilities/errors/cli-error";
import type { MetadataService } from "../../utilities/metadata/services/metadata.service";
import { ApiRecordsReadService } from "../../utilities/records/services/api-records-read.service";
import { createCommandContext } from "../../utilities/shared/context";
import { applyGlobalOptions } from "../../utilities/shared/global-options";
import { registerCommand } from "../../utilities/shared/register-command";

const execFileAsync = promisify(execFile);

interface DbProfileInitOptions {
  databaseUrl?: string;
  databaseSchema?: string;
  notes?: string;
}

interface DbBenchmarkCommandOptions {
  iterations?: string;
  warmup?: string;
  operation?: string[];
  outputFile?: string;
  object?: string;
  objectCommand?: string;
  recordId?: string;
  groupByField?: string;
  searchQuery?: string;
}

interface DbDoctorCommandOptions {
  strict?: boolean;
}

type DbExplainVariant = "list" | "list-with-includes" | "groupBy" | "search-union";

interface DbExplainCommandOptions {
  object?: string;
  variant?: string;
  include?: string;
  limit?: string;
  groupByField?: string;
  searchQuery?: string;
}

interface DbExplainQuery {
  variant: DbExplainVariant;
  object: string;
  limit: number;
  sql: string;
  params: unknown[];
}

function getRootCommand(command: Command): Command {
  let current = command;
  while (current.parent) {
    current = current.parent;
  }
  return current;
}

function collectCommandPaths(command: Command): string[] {
  const paths: string[] = [];
  collectCommandPathsInto(command, [], paths);
  return paths;
}

function collectCommandPathsInto(command: Command, prefix: string[], paths: string[]): void {
  for (const child of command.commands) {
    if (child.name() === "help" || child.name().startsWith("completion")) {
      continue;
    }

    const childPath = [...prefix, child.name()];
    paths.push(childPath.join(" "));
    collectCommandPathsInto(child, childPath, paths);
  }
}

function toLightDoctor(status: DbDoctorSummary): Record<string, unknown> {
  return {
    ok: status.ok,
    cfg: status.configured,
    rch: status.connection?.ok ?? false,
    ssl: status.effectiveSslmode,
    ...(status.resolvedSchema ? { sch: status.resolvedSchema } : {}),
    ...(status.resources ? { res: status.resources } : {}),
    ...(status.warnings.length > 0 ? { wrn: status.warnings } : {}),
  };
}

async function buildDbExplainQuery(
  client: Pick<Client, "query">,
  target: ResolvedDbConfig,
  metadata: MetadataService,
  options: DbExplainCommandOptions,
): Promise<DbExplainQuery> {
  const objectName = options.object ?? "people";
  const variant = parseExplainVariant(options.variant);
  const limit = parsePositiveInteger(options.limit ?? "20", "--limit");
  const planner = new DbMetadataPlannerService(metadata);
  const tableResolver = new DbTableResolverService();

  switch (variant) {
    case "list":
      return await buildListExplainQuery(client, target, planner, tableResolver, objectName, limit);
    case "list-with-includes":
      return await buildListWithIncludesExplainQuery(
        client,
        target,
        planner,
        tableResolver,
        objectName,
        options.include,
        limit,
      );
    case "groupBy":
      return await buildGroupByExplainQuery(
        client,
        target,
        planner,
        tableResolver,
        objectName,
        options.groupByField ?? "createdAt",
        limit,
      );
    case "search-union":
      return await buildSearchUnionExplainQuery(
        client,
        target,
        planner,
        tableResolver,
        objectName,
        options.searchQuery ?? DEFAULT_BENCHMARK_QUERY,
        limit,
      );
  }
}

async function buildListExplainQuery(
  client: Pick<Client, "query">,
  target: ResolvedDbConfig,
  planner: DbMetadataPlannerService,
  tableResolver: DbTableResolverService,
  objectName: string,
  limit: number,
): Promise<DbExplainQuery> {
  const plan = await planner.planObject(objectName);
  const table = await tableResolver.resolve(client, target, plan.tableName);
  const orderBy = buildOrderByForKeyset("id", "asc");

  return {
    variant: "list",
    object: objectName,
    limit,
    sql: `
      select to_jsonb(t) as "rowData"
      from ${quoteTableReference(table)} as t
      ${orderBy}
      limit $1
    `,
    params: [limit + 1],
  };
}

async function buildListWithIncludesExplainQuery(
  client: Pick<Client, "query">,
  target: ResolvedDbConfig,
  planner: DbMetadataPlannerService,
  tableResolver: DbTableResolverService,
  objectName: string,
  include: string | undefined,
  limit: number,
): Promise<DbExplainQuery> {
  if (!include) {
    throw new CliError(
      "db explain --variant list-with-includes requires --include.",
      "INVALID_ARGUMENTS",
    );
  }

  const plan = await planner.planObject(objectName, { include });
  const table = await tableResolver.resolve(client, target, plan.tableName);
  const includeTables: Array<{ joinColumnName: string; table: DbTableReference }> = [];
  for (const relationPlan of plan.includes) {
    includeTables.push({
      joinColumnName: relationPlan.joinColumnName,
      table: await tableResolver.resolve(client, target, relationPlan.tableName),
    });
  }

  const includeSelectFragments = includeTables
    .map(
      (_, index) =>
        `, to_jsonb(${quoteIdentifier(`rel_${index}`)}) as ${quoteIdentifier(`rel_${index}`)}`,
    )
    .join("");
  const includeJoinFragments = includeTables
    .map(
      (includeTable, index) => `
        left join lateral (
          select * from ${quoteTableReference(includeTable.table)} as r
          where r."id" = t.${quoteIdentifier(includeTable.joinColumnName)}
          limit 1
        ) as ${quoteIdentifier(`rel_${index}`)} on true`,
    )
    .join("");
  const orderBy = buildOrderByForKeyset("id", "asc");

  return {
    variant: "list-with-includes",
    object: objectName,
    limit,
    sql: `
      select to_jsonb(t) as "rowData"${includeSelectFragments}
      from ${quoteTableReference(table)} as t
      ${includeJoinFragments}
      ${orderBy}
      limit $1
    `,
    params: [limit + 1],
  };
}

async function buildGroupByExplainQuery(
  client: Pick<Client, "query">,
  target: ResolvedDbConfig,
  planner: DbMetadataPlannerService,
  tableResolver: DbTableResolverService,
  objectName: string,
  field: string,
  limit: number,
): Promise<DbExplainQuery> {
  const plan = await planner.planObject(objectName);
  const table = await tableResolver.resolve(client, target, plan.tableName);
  const groupByColumn = quoteColumn(field);

  return {
    variant: "groupBy",
    object: objectName,
    limit,
    sql: `
      select ${groupByColumn} as ${quoteIdentifier("group_0")}, count(*)::text as "countNotEmptyId"
      from ${quoteTableReference(table)} as t
      group by ${groupByColumn}
      order by ${groupByColumn} asc nulls first
      limit $1
    `,
    params: [limit],
  };
}

async function buildSearchUnionExplainQuery(
  client: Pick<Client, "query">,
  target: ResolvedDbConfig,
  planner: DbMetadataPlannerService,
  tableResolver: DbTableResolverService,
  objectName: string,
  searchQuery: string,
  limit: number,
): Promise<DbExplainQuery> {
  const plan = await planner.planObject(objectName);
  const table = await tableResolver.resolve(client, target, plan.tableName);

  return {
    variant: "search-union",
    object: objectName,
    limit,
    sql: `
      select $1::text as "objectName", t."id"::text as "recordId"
      from ${quoteTableReference(table)} as t
      where t."searchVector" @@ websearch_to_tsquery('simple', $2)
      order by ts_rank(t."searchVector", websearch_to_tsquery('simple', $2)) desc
      limit $3
    `,
    params: [objectName, searchQuery, limit + 1],
  };
}

function parseExplainVariant(value: string | undefined): DbExplainVariant {
  const candidate = value ?? "list";
  switch (candidate) {
    case "list":
    case "list-with-includes":
    case "groupBy":
    case "search-union":
      return candidate;
    default:
      throw new CliError(
        `Unsupported db explain variant ${JSON.stringify(value)}.`,
        "INVALID_ARGUMENTS",
        "Use one of: list, list-with-includes, groupBy, search-union.",
      );
  }
}

function extractExplainPlan(rows: Array<Record<string, unknown>>): unknown {
  const firstRow = rows[0];
  if (!firstRow) {
    return [];
  }

  return firstRow["QUERY PLAN"] ?? Object.values(firstRow)[0] ?? [];
}

function resolveProfileName(
  explicitName: string | undefined,
  envName: string | undefined,
  statusName: string | undefined,
): string | undefined {
  return explicitName || envName || statusName;
}

export function registerDbCommand(program: Command): void {
  const db = program.command("db").description("Manage db-first read profiles and diagnostics");
  applyGlobalOptions(db);

  const statusCmd = db.command("status").description("Show db-first read diagnostics");
  applyGlobalOptions(statusCmd);
  statusCmd.action(async (_options: unknown, command: Command) => {
    const { globalOptions, services } = await createCommandContext(command);
    const status = await services.dbStatus.getStatus({
      workspace: globalOptions.workspace,
      readSource: globalOptions.readSource,
    });

    await services.output.render(status, {
      format: globalOptions.output,
      query: globalOptions.query,
    });
  });

  const doctorCmd = db
    .command("doctor")
    .description("Connect to the resolved DB URL and show redacted diagnostics")
    .option("--strict", "Set a non-zero exit code when db diagnostics are unhealthy");
  applyGlobalOptions(doctorCmd);
  doctorCmd.action(async (options: DbDoctorCommandOptions, command: Command) => {
    const { globalOptions, services } = await createCommandContext(command);
    const status = await services.dbStatus.doctor({
      workspace: globalOptions.workspace,
      readSource: globalOptions.readSource,
    });

    if (options.strict && !status.ok) {
      process.exitCode = 1;
    }

    const light = Boolean(globalOptions.light);

    await services.output.render(light ? toLightDoctor(status) : status, {
      format: globalOptions.output,
      query: globalOptions.query,
      ...(light ? { light: false } : {}),
    });
  });

  const benchmarkCmd = db
    .command("benchmark")
    .description("Benchmark strict API reads against strict DB reads")
    .option("--iterations <number>", "Measured iterations", String(DEFAULT_BENCHMARK_ITERATIONS))
    .option("--warmup <number>", "Warmup iterations", String(DEFAULT_BENCHMARK_WARMUP))
    .option("--operation <key>", "Operation key to run", collect)
    .option("--output-file <path>", "Write JSON benchmark report")
    .option("--object <object>", "Record object to benchmark", "people")
    .option("--object-command <command>", "Cached records command name")
    .option("--record-id <id>", "Record ID for get benchmarks")
    .option("--group-by-field <field>", "Field for group-by benchmarks", "createdAt")
    .option("--search-query <query>", "Search query", DEFAULT_BENCHMARK_QUERY);
  applyGlobalOptions(benchmarkCmd);
  benchmarkCmd.action(async (options: DbBenchmarkCommandOptions, command: Command) => {
    const { globalOptions, services } = await createCommandContext(command);
    const iterations = parsePositiveInteger(options.iterations, "--iterations");
    const warmup = parseNonNegativeInteger(options.warmup, "--warmup");
    const fixture = await resolveBenchmarkFixture(services, options);
    const benchmark = new DbBenchmarkService({ run: runCliSubcommand });
    const report = await benchmark.run({
      iterations,
      warmup,
      operationKeys: options.operation,
      fixture,
    });

    if (options.outputFile) {
      await fs.writeFile(options.outputFile, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    }

    await services.output.render(report, {
      format: globalOptions.output,
      query: globalOptions.query,
    });
  });

  const coverageCmd = db.command("coverage").description("Show direct-DB read coverage by command");
  applyGlobalOptions(coverageCmd);
  coverageCmd.action(async (_options: unknown, command: Command) => {
    const { globalOptions, services } = await createCommandContext(command);
    const report = buildDbCoverage(collectCommandPaths(getRootCommand(command)));

    if (globalOptions.output === "markdown") {
      await services.output.render(renderDbCoverageMarkdown(report), {
        format: "markdown",
        query: globalOptions.query,
      });
      return;
    }

    if (globalOptions.light) {
      await services.output.render(
        report.items.map((item) => ({
          cmd: item.command,
          st: item.status,
          pri: item.priority,
        })),
        {
          format: globalOptions.output,
          query: globalOptions.query,
        },
      );
      return;
    }

    await services.output.render(report, {
      format: globalOptions.output,
      query: globalOptions.query,
      full: true,
      light: false,
    });
  });

  const explainCmd = db
    .command("explain")
    .description("Run EXPLAIN ANALYZE for a direct-DB read query")
    .option("--object <object>", "Record object to explain", "people")
    .option(
      "--variant <variant>",
      "Query variant: list, list-with-includes, groupBy, search-union",
      "list",
    )
    .option("--include <relations>", "Comma-separated MANY_TO_ONE includes for list-with-includes")
    .option("--limit <number>", "Result limit", "20")
    .option("--group-by-field <field>", "Field for groupBy variant", "createdAt")
    .option(
      "--search-query <query>",
      "Search query for search-union variant",
      DEFAULT_BENCHMARK_QUERY,
    );
  applyGlobalOptions(explainCmd);
  explainCmd.action(async (options: DbExplainCommandOptions, command: Command) => {
    const { globalOptions, services } = await createCommandContext(command);
    const resolver = new DbConfigResolverService(services.dbProfiles);
    const target = await resolver.resolve({
      workspace: globalOptions.workspace,
      readSource: "db",
    });

    if (!target.databaseUrl) {
      throw new CliError(
        "No DB URL resolved for db explain.",
        "INVALID_ARGUMENTS",
        "Set TWENTY_DATABASE_URL or select a db profile with `twenty db profile use <name>`.",
      );
    }

    const connection = new DbConnectionService();
    try {
      const report = await connection.withClient(
        { databaseUrl: target.databaseUrl },
        async (client) => {
          const explainQuery = await buildDbExplainQuery(
            client,
            target,
            services.metadata as MetadataService,
            options,
          );
          const startedAt = Date.now();
          const result = await client.query(
            `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${explainQuery.sql}`,
            explainQuery.params,
          );
          const durationMs = Date.now() - startedAt;

          return {
            operation: "db explain",
            variant: explainQuery.variant,
            object: explainQuery.object,
            limit: explainQuery.limit,
            durationMs,
            plan: extractExplainPlan(result.rows),
          };
        },
      );

      await services.output.render(report, {
        format: globalOptions.output,
        query: globalOptions.query,
      });
    } catch (error) {
      if (error instanceof CliError) {
        throw error;
      }
      throw new CliError(
        redactDbSecrets(
          error instanceof Error ? error.message : String(error ?? "DB explain failed."),
        ) ?? "DB explain failed.",
        "DB_EXPLAIN_FAILED",
      );
    } finally {
      await connection.close();
    }
  });

  const profileCmd = db.command("profile").description("cached db profiles");
  applyGlobalOptions(profileCmd);

  registerCommand(profileCmd, "init", "Initialize a db profile", (command) => {
    command.argument("<name>", "Profile name");
    command.option("--database-url <url>", "Database URL");
    command.option("--database-schema <schema>", "Twenty workspace database schema");
    command.option("--notes <text>", "Profile notes");
    applyGlobalOptions(command);
    command.action(async (name: string, options: DbProfileInitOptions, actionCommand: Command) => {
      const { globalOptions, services } = await createCommandContext(actionCommand);
      const databaseUrl = options.databaseUrl ?? process.env.TWENTY_DATABASE_URL;
      const databaseSchema = normalizeOptionalText(
        options.databaseSchema ?? process.env.TWENTY_DATABASE_SCHEMA,
      );

      if (!databaseUrl) {
        throw new CliError(
          "Missing database URL.",
          "INVALID_ARGUMENTS",
          "Provide --database-url or set TWENTY_DATABASE_URL.",
        );
      }

      const profile = await services.dbProfiles.initProfile({
        workspace: globalOptions.workspace,
        name,
        databaseUrl,
        ...(databaseSchema ? { databaseSchema } : {}),
        notes: options.notes,
      });

      await services.output.render(redactDbProfile(profile), {
        format: globalOptions.output,
        query: globalOptions.query,
      });
    });
  });

  registerCommand(profileCmd, "list", "List db profiles", (command) => {
    applyGlobalOptions(command);
    command.action(async (_options: unknown, actionCommand: Command) => {
      const { globalOptions, services } = await createCommandContext(actionCommand);
      const profiles = await services.dbProfiles.listProfiles(globalOptions.workspace);

      await services.output.render(redactDbProfiles(profiles), {
        format: globalOptions.output,
        query: globalOptions.query,
      });
    });
  });

  registerCommand(profileCmd, "show", "Show a db profile", (command) => {
    command.argument("[name]", "Profile name");
    applyGlobalOptions(command);
    command.action(async (name: string | undefined, _options: unknown, actionCommand: Command) => {
      const { globalOptions, services } = await createCommandContext(actionCommand);
      const envName = process.env.TWENTY_DB_PROFILE;
      const resolvedStatus =
        name || envName
          ? undefined
          : await services.dbStatus.getStatus({ workspace: globalOptions.workspace });
      const resolvedName = resolveProfileName(name, envName, resolvedStatus?.profileName);

      if (!resolvedName) {
        throw new CliError(
          "No DB profile selected.",
          "INVALID_ARGUMENTS",
          'Use "twenty db profile use <name>" or set TWENTY_DB_PROFILE.',
        );
      }

      const profile = await services.dbProfiles.getProfile(globalOptions.workspace, resolvedName);

      await services.output.render(redactDbProfile(profile), {
        format: globalOptions.output,
        query: globalOptions.query,
      });
    });
  });

  registerCommand(profileCmd, "use", "Set the active db profile", (command) => {
    command.argument("<name>", "Profile name");
    applyGlobalOptions(command);
    command.action(async (name: string, _options: unknown, actionCommand: Command) => {
      const { globalOptions, services } = await createCommandContext(actionCommand);
      const profile = await services.dbProfiles.setActiveProfile(globalOptions.workspace, name);

      await services.output.render(redactDbProfile(profile), {
        format: globalOptions.output,
        query: globalOptions.query,
      });
    });
  });

  registerCommand(profileCmd, "test", "Test a db profile", (command) => {
    command.argument("[name]", "Profile name");
    applyGlobalOptions(command);
    command.action(async (name: string | undefined, _options: unknown, actionCommand: Command) => {
      const { globalOptions, services } = await createCommandContext(actionCommand);
      const resolved = await resolveDbProfileSelection(services, globalOptions.workspace, name);
      const profile = await services.dbProfiles.test(globalOptions.workspace, resolved);

      await services.output.render(redactDbProfile(profile), {
        format: globalOptions.output,
        query: globalOptions.query,
      });
    });
  });

  registerCommand(profileCmd, "refresh-creds", "Refresh db credentials", (command) => {
    command.argument("[name]", "Profile name");
    applyGlobalOptions(command);
    command.action(async (name: string | undefined, _options: unknown, actionCommand: Command) => {
      const { globalOptions, services } = await createCommandContext(actionCommand);
      const resolved = await resolveDbProfileSelection(services, globalOptions.workspace, name);
      const profile = await services.dbProfiles.refreshCreds(globalOptions.workspace, resolved);

      await services.output.render(redactDbProfile(profile), {
        format: globalOptions.output,
        query: globalOptions.query,
      });
    });
  });

  registerCommand(profileCmd, "remove", "Remove a db profile", (command) => {
    command.argument("<name>", "Profile name");
    applyGlobalOptions(command);
    command.action(async (name: string, _options: unknown, actionCommand: Command) => {
      const { globalOptions, services } = await createCommandContext(actionCommand);
      await services.dbProfiles.removeProfile(globalOptions.workspace, name);

      await services.output.render(
        {
          workspace: globalOptions.workspace,
          name,
          removed: true,
        },
        {
          format: globalOptions.output,
          query: globalOptions.query,
        },
      );
    });
  });
}

function normalizeOptionalText(value: string | undefined): string | undefined {
  const trimmed = value?.trim();

  return trimmed ? trimmed : undefined;
}

async function resolveDbProfileSelection(
  services: Awaited<ReturnType<typeof createCommandContext>>["services"],
  workspace: string | undefined,
  explicitName: string | undefined,
): Promise<string> {
  if (explicitName) {
    return explicitName;
  }

  const envName = process.env.TWENTY_DB_PROFILE;
  if (envName) {
    return envName;
  }

  const status = await services.dbStatus.getStatus({ workspace });
  if (status.profileName) {
    return status.profileName;
  }

  throw new CliError(
    "No DB profile selected.",
    "INVALID_ARGUMENTS",
    'Use "twenty db profile use <name>" or set TWENTY_DB_PROFILE.',
  );
}

function collect(value: string, previous: string[] = []): string[] {
  return previous.concat([value]);
}

function parsePositiveInteger(value: string | undefined, name: string): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new CliError(`${name} must be greater than 0.`, "INVALID_ARGUMENTS");
  }
  return parsed;
}

function parseNonNegativeInteger(value: string | undefined, name: string): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new CliError(`${name} must be 0 or greater.`, "INVALID_ARGUMENTS");
  }
  return parsed;
}

async function resolveBenchmarkFixture(
  services: Awaited<ReturnType<typeof createCommandContext>>["services"],
  options: DbBenchmarkCommandOptions,
): Promise<BenchmarkFixture> {
  const object = options.object ?? "people";
  const fixture: BenchmarkFixture = {
    object,
    objectCommand: options.objectCommand ?? object,
    recordId: options.recordId,
    groupByField: options.groupByField ?? "createdAt",
    query: options.searchQuery ?? DEFAULT_BENCHMARK_QUERY,
  };

  if (fixture.recordId) {
    return fixture;
  }

  try {
    const apiRecords = new ApiRecordsReadService(services.api);
    const response = await apiRecords.list(object, { limit: 1 });
    const first = response.data[0];
    if (isRecord(first) && typeof first.id === "string" && first.id.length > 0) {
      fixture.recordId = first.id;
    }
  } catch {
    // Missing fixture discovery should skip dependent benchmark operations, not fail all benchmarks.
  }

  return fixture;
}

async function runCliSubcommand(args: string[]): Promise<unknown> {
  const cliPath = process.argv[1];
  if (!cliPath) {
    throw new CliError("Cannot locate CLI entrypoint for benchmark.", "INVALID_ARGUMENTS");
  }

  try {
    const { stdout } = await execFileAsync(process.execPath, [cliPath, ...args], {
      env: process.env,
      maxBuffer: 50 * 1024 * 1024,
    });
    const trimmed = stdout.trim();
    return trimmed ? JSON.parse(trimmed) : null;
  } catch (error) {
    if (isExecError(error)) {
      const stderr = redactDbSecrets(error.stderr)?.trim();
      const stdout = redactDbSecrets(error.stdout)?.trim();
      const detail = stderr || stdout || redactDbSecrets(error.message) || error.message;
      throw new CliError(`Benchmark command failed: ${detail}`, "UNKNOWN");
    }
    throw error;
  }
}

function isExecError(error: unknown): error is Error & { stdout: string; stderr: string } {
  return (
    error instanceof Error &&
    "stdout" in error &&
    typeof (error as { stdout?: unknown }).stdout === "string" &&
    "stderr" in error &&
    typeof (error as { stderr?: unknown }).stderr === "string"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
