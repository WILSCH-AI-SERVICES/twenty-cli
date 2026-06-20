import os from "node:os";
import path from "node:path";

import fs from "fs-extra";

import {
  SCHEMA_CACHE_KINDS,
  SchemaCacheEntry,
  SchemaCacheKind,
  normalizeSchemaCacheBaseUrl,
  schemaCacheDirectoryFor,
} from "./schema-cache.service";

export interface SchemaCacheReaderOptions {
  cacheRoot?: string;
  configPath?: string;
  env?: Record<string, string | undefined>;
}

export interface CachedSchemaContext {
  cacheRoot: string;
  cacheDirectory: string;
  baseUrl: string;
  workspace: string;
}

export interface CachedSchemaEntries {
  context: CachedSchemaContext;
  coreOpenApi?: SchemaCacheEntry;
  metadataOpenApi?: SchemaCacheEntry;
  graphql?: SchemaCacheEntry;
}

interface RawConfigFile {
  defaultWorkspace?: string;
  workspaces?: Record<string, { apiUrl?: string }>;
}

export function resolveCachedSchemaContext(
  options: SchemaCacheReaderOptions = {},
): CachedSchemaContext {
  const env = options.env ?? process.env;
  const configPath = options.configPath ?? path.join(os.homedir(), ".twenty", "config.json");
  const config = readConfigFile(configPath);
  const workspace = env.TWENTY_PROFILE ?? config?.defaultWorkspace ?? "default";
  const workspaceConfig = config?.workspaces?.[workspace];
  const apiUrl = env.TWENTY_BASE_URL ?? workspaceConfig?.apiUrl ?? "https://api.twenty.com";
  const baseUrl = normalizeBaseUrl(apiUrl);
  const cacheRoot = options.cacheRoot ?? path.join(os.homedir(), ".twenty", "schema-cache");

  return {
    cacheRoot,
    cacheDirectory: schemaCacheDirectoryFor(cacheRoot, baseUrl, workspace),
    baseUrl,
    workspace,
  };
}

export function readCachedSchemaEntries(
  options: SchemaCacheReaderOptions = {},
): CachedSchemaEntries {
  const context = resolveCachedSchemaContext(options);

  return {
    context,
    coreOpenApi: readCacheEntry(context.cacheDirectory, "core-openapi"),
    metadataOpenApi: readCacheEntry(context.cacheDirectory, "metadata-openapi"),
    graphql: readCacheEntry(context.cacheDirectory, "graphql"),
  };
}

function readCacheEntry(
  cacheDirectory: string,
  kind: SchemaCacheKind,
): SchemaCacheEntry | undefined {
  const entryPath = path.join(cacheDirectory, `${kind}.json`);
  if (!pathExistsSync(entryPath)) return undefined;

  const entry = readJsonSync<SchemaCacheEntry>(entryPath);
  if (!entry || entry.schemaVersion !== 1 || !SCHEMA_CACHE_KINDS.includes(entry.kind)) {
    return undefined;
  }
  return entry.kind === kind ? entry : undefined;
}

function readConfigFile(configPath: string): RawConfigFile | undefined {
  if (!pathExistsSync(configPath)) return undefined;

  return readJsonSync<RawConfigFile>(configPath);
}

function pathExistsSync(filePath: string): boolean {
  const exists = (fs as typeof fs & { pathExistsSync?: (path: string) => boolean }).pathExistsSync;
  return typeof exists === "function" ? exists(filePath) : false;
}

function readJsonSync<TValue>(filePath: string): TValue | undefined {
  const readJson = (fs as typeof fs & { readJsonSync?: (path: string) => unknown }).readJsonSync;
  if (typeof readJson !== "function") return undefined;

  try {
    return readJson(filePath) as TValue;
  } catch {
    return undefined;
  }
}

function normalizeBaseUrl(apiUrl: string): string {
  try {
    if (apiUrl.trim() === "") {
      throw new Error("Empty API URL");
    }
    return normalizeSchemaCacheBaseUrl(apiUrl);
  } catch {
    return normalizeSchemaCacheBaseUrl("https://api.twenty.com");
  }
}
