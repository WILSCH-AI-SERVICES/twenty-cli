import { Command } from "commander";

import { CliError } from "../../utilities/errors/cli-error";
import { SearchResult } from "../../utilities/search/services/search.service";
import { createCommandContext } from "../../utilities/shared/context";
import { applyGlobalOptions } from "../../utilities/shared/global-options";
import { readJsonInput } from "../../utilities/shared/io";
import { singularize } from "../../utilities/shared/parse";

export function registerSearchCommand(program: Command): void {
  const cmd = program
    .command("search")
    .description("Full-text search across all records")
    .argument("<query>", "Search query")
    .option("--limit <number>", "Maximum results", "20")
    .option("--objects <list>", "Comma-separated object names to include (singular or plural)")
    .option("--exclude <list>", "Comma-separated object names to exclude (singular or plural)")
    .option("--cursor <cursor>", "Pagination cursor for the next page")
    .option("--include-page-info", "Include top-level pageInfo in output")
    .option("--filter <json>", "JSON filter object")
    .option("--filter-file <path>", "JSON filter file (use - for stdin)");

  applyGlobalOptions(cmd);

  cmd.action(async (query: string, options: SearchOptions, command: Command) => {
    const { globalOptions, services } = await createCommandContext(command);
    const filter = await parseSearchFilter(options.filter, options.filterFile);

    const response = await services.search.search({
      query,
      limit: parseInt(options.limit, 10),
      objects: parseObjectNames(options.objects),
      excludeObjects: parseObjectNames(options.exclude),
      after: options.cursor,
      filter,
    });

    const output = options.includePageInfo
      ? response
      : globalOptions.output === "text"
        ? formatTextSearchResults(response.data, query)
        : response.data;

    await services.output.render(output, {
      format: globalOptions.output,
      query: globalOptions.query,
    });
  });
}

interface SearchOptions {
  limit: string;
  objects?: string;
  exclude?: string;
  cursor?: string;
  includePageInfo?: boolean;
  filter?: string;
  filterFile?: string;
}

async function parseSearchFilter(
  data?: string,
  filePath?: string,
): Promise<Record<string, unknown> | undefined> {
  const filter = await readJsonInput(data, filePath);
  if (filter == null) {
    return undefined;
  }

  if (typeof filter !== "object" || Array.isArray(filter)) {
    throw new CliError("Search filter must be a JSON object.", "INVALID_ARGUMENTS");
  }

  const record = filter as Record<string, unknown>;

  validateSearchFilter(record);

  return record;
}

const SEARCH_FILTER_FIELDS = new Set(["id", "createdAt", "updatedAt", "deletedAt"]);
const SEARCH_FILTER_LOGICAL_KEYS = new Set(["and", "or", "not"]);
const SEARCH_FILTER_OPERATORS = new Set(["eq", "gt", "gte", "in", "lt", "lte", "neq", "is"]);

export function validateSearchFilter(filter: Record<string, unknown>, path = "filter"): void {
  for (const [key, value] of Object.entries(filter)) {
    if (SEARCH_FILTER_LOGICAL_KEYS.has(key)) {
      validateSearchLogicalFilter(key, value, `${path}.${key}`);
      continue;
    }

    if (!SEARCH_FILTER_FIELDS.has(key)) {
      throw new CliError(
        `Search filter field ${JSON.stringify(key)} is not supported. Search filter only supports and/or/not plus id, createdAt, updatedAt, and deletedAt.`,
        "INVALID_ARGUMENTS",
      );
    }

    if (!isRecord(value)) {
      throw new CliError(
        `Search filter field ${JSON.stringify(key)} must be an object of operators.`,
        "INVALID_ARGUMENTS",
      );
    }

    for (const operator of Object.keys(value)) {
      if (!SEARCH_FILTER_OPERATORS.has(operator)) {
        throw new CliError(
          `Search filter operator ${JSON.stringify(operator)} is not supported. Search filter only supports eq, gt, gte, in, lt, lte, neq, and is.`,
          "INVALID_ARGUMENTS",
        );
      }
    }
  }
}

function validateSearchLogicalFilter(key: string, value: unknown, path: string): void {
  if (key === "not") {
    if (!isRecord(value)) {
      throw new CliError(`${path} must be a JSON object.`, "INVALID_ARGUMENTS");
    }
    validateSearchFilter(value, path);
    return;
  }

  if (!Array.isArray(value)) {
    throw new CliError(`${path} must be an array of JSON objects.`, "INVALID_ARGUMENTS");
  }

  value.forEach((entry, index) => {
    if (!isRecord(entry)) {
      throw new CliError(`${path}[${index}] must be a JSON object.`, "INVALID_ARGUMENTS");
    }
    validateSearchFilter(entry, `${path}[${index}]`);
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseObjectNames(raw?: string): string[] | undefined {
  if (!raw) {
    return undefined;
  }

  const names = raw
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean)
    .map((name) => singularize(name.toLowerCase()));

  return names.length > 0 ? names : undefined;
}

function formatTextSearchResults(
  results: SearchResult[],
  query: string,
): Array<Record<string, string>> {
  return rankSearchResults(results, query).map((result) => ({
    name: result.label,
    title: result.objectLabelSingular,
    id: result.recordId,
    object: result.objectNameSingular,
  }));
}

function rankSearchResults(results: SearchResult[], query: string): SearchResult[] {
  return results
    .map((result, index) => ({
      result,
      index,
      tier: getSearchMatchTier(result.label, query),
    }))
    .sort((left, right) => {
      if (right.tier !== left.tier) {
        return right.tier - left.tier;
      }

      if (right.result.tsRankCD !== left.result.tsRankCD) {
        return right.result.tsRankCD - left.result.tsRankCD;
      }

      if (right.result.tsRank !== left.result.tsRank) {
        return right.result.tsRank - left.result.tsRank;
      }

      return left.index - right.index;
    })
    .map((entry) => entry.result);
}

function getSearchMatchTier(label: string, query: string): number {
  const normalizedLabel = normalizeSearchPhrase(label);
  const normalizedQuery = normalizeSearchPhrase(query);

  if (!normalizedLabel || !normalizedQuery) {
    return 0;
  }

  if (normalizedLabel === normalizedQuery) {
    return 4;
  }

  if (normalizedLabel.startsWith(`${normalizedQuery} `)) {
    return 3;
  }

  if (normalizedLabel.split(" ").includes(normalizedQuery)) {
    return 2;
  }

  if (normalizedLabel.includes(normalizedQuery)) {
    return 1;
  }

  return 0;
}

function normalizeSearchPhrase(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}
