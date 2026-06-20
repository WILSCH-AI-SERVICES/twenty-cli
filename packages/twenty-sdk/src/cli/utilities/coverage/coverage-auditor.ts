import path from "node:path";
import fs from "fs-extra";
import type { Command } from "commander";

export interface CoverageCompareOptions {
  upstreamPath: string;
  cliRoot?: string;
  baselinePath?: string;
}

export interface CoverageGap {
  surface: "core-rest" | "metadata-rest" | "graphql";
  name: string;
  upstreamPath: string;
  suggestedCommand: string;
}

export interface CoverageBaselineEntry {
  surface: CoverageGap["surface"];
  name: string;
  reason?: string;
}

export interface CoverageAllowedGap extends CoverageGap {
  reason?: string;
}

export interface CoverageReport {
  status: "ok" | "missing_coverage";
  upstreamPath: string;
  baselinePath?: string;
  summary: Record<string, number>;
  missing: CoverageGap[];
  allowedMissing: CoverageAllowedGap[];
  unexpectedMissing: CoverageGap[];
  unusedBaseline: CoverageBaselineEntry[];
  notes: string[];
  _cli?: { message: string };
}

export interface MetadataResource {
  name: string;
  commandName: string;
}

export interface GraphqlOperationNames {
  Query: string[];
  Mutation: string[];
}

interface CoverageRequirement {
  surface: CoverageGap["surface"];
  name: string;
  upstreamPath: string;
  suggestedCommand: string;
  commandPath?: string[];
  sourceLiteral?: string;
}

interface CliSourceFile {
  filePath: string;
  source: string;
}

const OPEN_API_SERVICE_PATH =
  "packages/twenty-server/src/engine/core-modules/open-api/open-api.service.ts";
const GRAPHQL_SCHEMA_PATH = "packages/twenty-client-sdk/src/metadata/generated/schema.graphql";
const METADATA_OPERATIONS = ["list", "get", "create", "update", "delete"] as const;
const CORE_OPERATIONS = [
  "list",
  "get",
  "create",
  "update",
  "delete",
  "destroy",
  "restore",
  "batch-create",
  "batch-update",
  "batch-delete",
  "find-duplicates",
  "group-by",
  "merge",
] as const;
const RAW_GRAPHQL_NOTE =
  "Raw GraphQL is available through twenty raw graphql, but raw fallback is not counted as first-class GraphQL coverage.";

export function extractMetadataResourcesFromSource(source: string): MetadataResource[] {
  const resources = new Map<string, MetadataResource>();
  const namePluralPattern = /namePlural\s*:\s*["'`]([A-Za-z0-9_]+)["'`]/g;

  for (const match of source.matchAll(namePluralPattern)) {
    const name = match[1];
    if (name === undefined) continue;
    resources.set(name, {
      name,
      commandName: camelToKebab(name),
    });
  }

  return Array.from(resources.values()).sort((left, right) => {
    const leftIndex = source.indexOf(left.name);
    const rightIndex = source.indexOf(right.name);
    return leftIndex - rightIndex;
  });
}

export function parseGraphqlOperationNames(schema: string): GraphqlOperationNames {
  return {
    Query: parseGraphqlTypeFields(schema, "Query"),
    Mutation: parseGraphqlTypeFields(schema, "Mutation"),
  };
}

export async function compareCoverage(options: CoverageCompareOptions): Promise<CoverageReport> {
  const upstreamPath = path.resolve(options.upstreamPath);
  const baselinePath = options.baselinePath ? path.resolve(options.baselinePath) : undefined;
  const cliRoot = options.cliRoot
    ? path.resolve(options.cliRoot)
    : path.resolve(__dirname, "../..");
  const openApiServicePath = path.join(upstreamPath, OPEN_API_SERVICE_PATH);
  const graphqlSchemaPath = path.join(upstreamPath, GRAPHQL_SCHEMA_PATH);

  await assertExpectedFile(openApiServicePath);
  await assertExpectedFile(graphqlSchemaPath);

  const [openApiSource, graphqlSchema, commandPaths, cliSources, baselineEntries] =
    await Promise.all([
      fs.readFile(openApiServicePath, "utf-8"),
      fs.readFile(graphqlSchemaPath, "utf-8"),
      getCliCommandPaths(),
      readTypeScriptSources(cliRoot),
      readCoverageBaseline(baselinePath),
    ]);

  const metadataResources = extractMetadataResourcesFromSource(openApiSource);
  const graphqlOperations = parseGraphqlOperationNames(graphqlSchema);
  const requirements = [
    ...buildCoreRestRequirements(),
    ...buildMetadataRestRequirements(metadataResources),
    ...buildGraphqlRequirements(graphqlOperations),
  ];
  const missing = requirements
    .filter((requirement) => !isRequirementCovered(requirement, commandPaths, cliSources))
    .map(({ surface, name, upstreamPath, suggestedCommand }) => ({
      surface,
      name,
      upstreamPath,
      suggestedCommand,
    }))
    .sort(compareGap);
  const { allowedMissing, unexpectedMissing, unusedBaseline } = applyCoverageBaseline(
    missing,
    baselineEntries,
  );
  const summary = buildSummary(
    requirements,
    missing,
    allowedMissing,
    unexpectedMissing,
    unusedBaseline,
  );
  const notes = commandPaths.has("raw graphql") ? [RAW_GRAPHQL_NOTE] : [];

  return {
    status: unexpectedMissing.length === 0 ? "ok" : "missing_coverage",
    upstreamPath,
    ...(baselinePath ? { baselinePath } : {}),
    summary,
    missing,
    allowedMissing,
    unexpectedMissing,
    unusedBaseline,
    notes,
    _cli: {
      message:
        unexpectedMissing.length === 0
          ? buildOkMessage(allowedMissing.length)
          : `${unexpectedMissing.length} unexpected coverage gaps found (${allowedMissing.length} allowed).`,
    },
  };
}

function parseGraphqlTypeFields(schema: string, typeName: "Query" | "Mutation"): string[] {
  const withoutComments = schema.replace(/#[^\n\r]*/g, "");
  const fields: string[] = [];
  const typePattern = new RegExp(`(?:extend\\s+)?type\\s+${typeName}\\b[^{}]*\\{`, "g");

  for (const match of withoutComments.matchAll(typePattern)) {
    const blockStart = (match.index ?? 0) + match[0].length;
    const block = readBraceBlock(withoutComments, blockStart);
    fields.push(...parseTopLevelGraphqlFields(block));
  }

  return Array.from(new Set(fields)).sort();
}

function readBraceBlock(source: string, startIndex: number): string {
  let depth = 1;
  let index = startIndex;

  while (index < source.length && depth > 0) {
    const char = source[index];
    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;
    index += 1;
  }

  return source.slice(startIndex, index - 1);
}

function parseTopLevelGraphqlFields(block: string): string[] {
  const withoutArguments = stripParenthesizedSections(block);
  const fields: string[] = [];

  for (const line of withoutArguments.split(/\r?\n/)) {
    const fieldMatch = line.trim().match(/^([_A-Za-z][_0-9A-Za-z]*)\s*:/);
    const fieldName = fieldMatch?.[1];
    if (fieldName !== undefined) fields.push(fieldName);
  }

  return fields;
}

function stripParenthesizedSections(source: string): string {
  let depth = 0;
  let result = "";

  for (const char of source) {
    if (char === "(") {
      depth += 1;
      continue;
    }
    if (char === ")") {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (depth === 0) result += char;
  }

  return result;
}

function buildCoreRestRequirements(): CoverageRequirement[] {
  const requirements = CORE_OPERATIONS.map((operation) => ({
    surface: "core-rest" as const,
    name: `records.${operation}`,
    upstreamPath: coreRestUpstreamPath(operation),
    suggestedCommand: `twenty api ${operation} <object>`,
    commandPath: ["api", operation],
  }));

  requirements.push({
    surface: "core-rest",
    name: "dashboards.duplicate",
    upstreamPath: "/dashboards/{id}/duplicate",
    suggestedCommand: "twenty dashboards duplicate <dashboardId>",
    commandPath: ["dashboards", "duplicate"],
  });

  return requirements;
}

function buildMetadataRestRequirements(resources: MetadataResource[]): CoverageRequirement[] {
  return resources.flatMap((resource) =>
    METADATA_OPERATIONS.map((operation) => {
      const commandPath = metadataCommandPath(resource.commandName, operation);
      const needsId = operation === "get" || operation === "update" || operation === "delete";

      return {
        surface: "metadata-rest" as const,
        name: `${resource.name}.${operation}`,
        upstreamPath: `/metadata/${resource.name}${needsId ? "/{id}" : ""}`,
        suggestedCommand: `twenty ${commandPath.join(" ")}${needsId ? " <id>" : ""}`,
        commandPath,
      };
    }),
  );
}

function buildGraphqlRequirements(operations: GraphqlOperationNames): CoverageRequirement[] {
  return (["Query", "Mutation"] as const).flatMap((kind) =>
    operations[kind].map((operation) => ({
      surface: "graphql" as const,
      name: `${kind}.${operation}`,
      upstreamPath: `type ${kind} { ${operation} }`,
      suggestedCommand: `twenty graphql ${operation}`,
      sourceLiteral: operation,
    })),
  );
}

function metadataCommandPath(commandName: string, operation: string): string[] {
  if (commandName === "api-keys") return ["api-keys", operation];
  if (commandName === "webhooks") return ["webhooks", operation];
  return ["api-metadata", commandName, operation];
}

function isRequirementCovered(
  requirement: CoverageRequirement,
  commandPaths: Set<string>,
  cliSources: CliSourceFile[],
): boolean {
  if (requirement.surface === "graphql") {
    return Boolean(
      hasDynamicGraphqlOperationExecutor(commandPaths, cliSources) ||
      (requirement.sourceLiteral && hasFirstClassGraphqlLiteral(requirement, cliSources)),
    );
  }

  if (!requirement.commandPath) return false;
  return commandPaths.has(requirement.commandPath.join(" "));
}

function hasDynamicGraphqlOperationExecutor(
  commandPaths: Set<string>,
  cliSources: CliSourceFile[],
): boolean {
  if (!commandPaths.has("graphql")) return false;

  return cliSources.some((file) => {
    const normalizedPath = file.filePath.split(path.sep).join("/");
    const isGraphqlCommandSource =
      normalizedPath.endsWith("commands/graphql/graphql.command.ts") ||
      normalizedPath.endsWith("commands/graphql/graphql.command.js");

    return (
      isGraphqlCommandSource &&
      /(?:\.|^)argument\(\s*["'`]<operation>/.test(file.source) &&
      file.source.includes("buildGraphqlOperationDocument")
    );
  });
}

function hasFirstClassGraphqlLiteral(
  requirement: CoverageRequirement,
  cliSources: CliSourceFile[],
): boolean {
  return cliSources.some((file) => {
    return Boolean(
      requirement.sourceLiteral &&
      extractStringLiteralContents(file.source).some((literal) =>
        hasGraphqlFieldToken(literal, requirement.sourceLiteral as string),
      ),
    );
  });
}

function extractStringLiteralContents(source: string): string[] {
  const literals: string[] = [];
  const stringPattern = /(["'`])((?:\\[\s\S]|(?!\1)[\s\S])*?)\1/g;

  for (const match of source.matchAll(stringPattern)) {
    const literal = match[2];
    if (literal !== undefined) literals.push(literal);
  }

  return literals;
}

function hasGraphqlFieldToken(source: string, operation: string): boolean {
  return new RegExp(`(^|[^_0-9A-Za-z])${escapeRegExp(operation)}([^_0-9A-Za-z]|$)`).test(source);
}

function buildSummary(
  requirements: CoverageRequirement[],
  missing: CoverageGap[],
  allowedMissing: CoverageAllowedGap[],
  unexpectedMissing: CoverageGap[],
  unusedBaseline: CoverageBaselineEntry[],
): Record<string, number> {
  const summary: Record<string, number> = {};

  for (const surface of ["core-rest", "metadata-rest", "graphql"] as const) {
    const total = requirements.filter((requirement) => requirement.surface === surface).length;
    const missingCount = missing.filter((gap) => gap.surface === surface).length;
    summary[`${surface}:total`] = total;
    summary[`${surface}:covered`] = total - missingCount;
    summary[`${surface}:missing`] = missingCount;
  }
  summary.total = requirements.length;
  summary.covered = requirements.length - missing.length;
  summary.missing = missing.length;
  summary["missing:allowed"] = allowedMissing.length;
  summary["missing:unexpected"] = unexpectedMissing.length;
  summary["baseline:unused"] = unusedBaseline.length;

  return summary;
}

async function readCoverageBaseline(
  baselinePath: string | undefined,
): Promise<CoverageBaselineEntry[]> {
  if (!baselinePath) return [];
  if (!(await fs.pathExists(baselinePath))) {
    throw new Error(`Missing coverage baseline file: ${baselinePath}`);
  }

  const rawBaseline = await fs.readJson(baselinePath);
  if (!isRecord(rawBaseline) || !Array.isArray(rawBaseline.allowedMissing)) {
    throw new Error("Invalid coverage baseline: expected allowedMissing array.");
  }

  return rawBaseline.allowedMissing.map((entry, index) => normalizeBaselineEntry(entry, index));
}

function normalizeBaselineEntry(entry: unknown, index: number): CoverageBaselineEntry {
  if (!isRecord(entry) || typeof entry.surface !== "string" || typeof entry.name !== "string") {
    throw new Error(`Invalid coverage baseline entry at allowedMissing[${index}].`);
  }
  if (!isCoverageSurface(entry.surface)) {
    throw new Error(`Invalid coverage baseline entry surface at allowedMissing[${index}].`);
  }
  if (entry.name.trim() === "") {
    throw new Error(`Invalid coverage baseline entry name at allowedMissing[${index}].`);
  }
  if (entry.reason !== undefined && typeof entry.reason !== "string") {
    throw new Error(`Invalid coverage baseline entry reason at allowedMissing[${index}].`);
  }

  return {
    surface: entry.surface,
    name: entry.name,
    ...(typeof entry.reason === "string" ? { reason: entry.reason } : {}),
  };
}

function isCoverageSurface(value: string): value is CoverageGap["surface"] {
  return value === "core-rest" || value === "metadata-rest" || value === "graphql";
}

function applyCoverageBaseline(
  missing: CoverageGap[],
  baselineEntries: CoverageBaselineEntry[],
): {
  allowedMissing: CoverageAllowedGap[];
  unexpectedMissing: CoverageGap[];
  unusedBaseline: CoverageBaselineEntry[];
} {
  const baselineByKey = new Map(baselineEntries.map((entry) => [coverageGapKey(entry), entry]));
  const usedBaselineKeys = new Set<string>();
  const allowedMissing: CoverageAllowedGap[] = [];
  const unexpectedMissing: CoverageGap[] = [];

  for (const gap of missing) {
    const key = coverageGapKey(gap);
    const baselineEntry = baselineByKey.get(key);
    if (!baselineEntry) {
      unexpectedMissing.push(gap);
      continue;
    }

    usedBaselineKeys.add(key);
    allowedMissing.push({
      ...gap,
      ...(baselineEntry.reason ? { reason: baselineEntry.reason } : {}),
    });
  }

  const unusedBaseline = baselineEntries
    .filter((entry) => !usedBaselineKeys.has(coverageGapKey(entry)))
    .sort(compareBaselineEntry);

  return {
    allowedMissing: allowedMissing.sort(compareGap),
    unexpectedMissing: unexpectedMissing.sort(compareGap),
    unusedBaseline,
  };
}

function coverageGapKey(entry: Pick<CoverageBaselineEntry, "surface" | "name">): string {
  return `${entry.surface}\0${entry.name}`;
}

function buildOkMessage(allowedCount: number): string {
  if (allowedCount === 0) {
    return "All audited first-class surfaces are covered.";
  }

  return `No unexpected coverage gaps found (${allowedCount} allowed).`;
}

async function getCliCommandPaths(): Promise<Set<string>> {
  const [{ buildProgram }, { buildHelpJson }] = await Promise.all([
    import("../../program"),
    import("../../help"),
  ]);
  const program = buildProgram();
  buildHelpJson(program, []);

  const paths = new Set<string>();
  collectCommandPaths(program, [], paths);
  return paths;
}

function collectCommandPaths(command: Command, prefix: string[], paths: Set<string>): void {
  for (const child of command.commands) {
    const childPath = [...prefix, child.name()];
    paths.add(childPath.join(" "));
    collectCommandPaths(child, childPath, paths);
  }
}

async function readTypeScriptSources(root: string): Promise<CliSourceFile[]> {
  if (!(await fs.pathExists(root))) return [];

  return readIncludedTypeScriptSources(root, root);
}

async function readIncludedTypeScriptSources(
  root: string,
  currentPath: string,
): Promise<CliSourceFile[]> {
  if (shouldSkipSourcePath(root, currentPath)) return [];

  const entries = await fs.readdir(currentPath, { withFileTypes: true });
  const sources = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) return readIncludedTypeScriptSources(root, entryPath);
      if (shouldSkipSourcePath(root, entryPath)) return [];
      if (entry.isFile() && isScannableSourceFile(entry.name)) {
        return [{ filePath: entryPath, source: await fs.readFile(entryPath, "utf-8") }];
      }
      return [];
    }),
  );

  return sources.flat().sort((left, right) => left.filePath.localeCompare(right.filePath));
}

function shouldSkipSourcePath(root: string, filePath: string): boolean {
  const relativePath = path.relative(root, filePath).split(path.sep).join("/");

  if (relativePath === "") return false;
  if (relativePath.includes("/__tests__/") || relativePath.startsWith("__tests__/")) return true;
  if (relativePath.endsWith(".spec.ts") || relativePath.endsWith(".test.ts")) return true;
  if (relativePath === "help.ts" || relativePath.startsWith("help/")) return true;
  if (relativePath === "commands/raw/graphql.command.ts") return true;

  const isDirectory = !path.extname(relativePath);
  if (isDirectory) {
    return !(
      relativePath === "commands" ||
      relativePath.startsWith("commands/") ||
      relativePath === "utilities" ||
      relativePath.startsWith("utilities/")
    );
  }

  return !(relativePath.startsWith("commands/") || relativePath.startsWith("utilities/"));
}

function isScannableSourceFile(fileName: string): boolean {
  return fileName.endsWith(".ts") || fileName.endsWith(".js");
}

async function assertExpectedFile(filePath: string): Promise<void> {
  if (!(await fs.pathExists(filePath))) {
    throw new Error(`Missing expected upstream file: ${filePath}`);
  }
}

function coreRestUpstreamPath(operation: (typeof CORE_OPERATIONS)[number]): string {
  const paths: Record<(typeof CORE_OPERATIONS)[number], string> = {
    list: "/{object}",
    get: "/{object}/{id}",
    create: "/{object}",
    update: "/{object}/{id}",
    delete: "/{object}/{id}",
    destroy: "/{object}/{id}",
    restore: "/restore/{object}/{id}",
    "batch-create": "/batch/{object}",
    "batch-update": "/batch/{object}",
    "batch-delete": "/batch/{object}",
    "find-duplicates": "/{object}/duplicates",
    "group-by": "/{object}/groupBy",
    merge: "/{object}/merge",
  };

  return paths[operation];
}

function camelToKebab(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/_/g, "-")
    .toLowerCase();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function compareGap(left: CoverageGap, right: CoverageGap): number {
  return (
    left.surface.localeCompare(right.surface) ||
    left.name.localeCompare(right.name) ||
    left.upstreamPath.localeCompare(right.upstreamPath)
  );
}

function compareBaselineEntry(left: CoverageBaselineEntry, right: CoverageBaselineEntry): number {
  return left.surface.localeCompare(right.surface) || left.name.localeCompare(right.name);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
