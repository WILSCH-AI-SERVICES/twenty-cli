import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";

import fs from "fs-extra";

import { ApiService } from "../api/services/api.service";
import { ConfigService } from "../config/services/config.service";
import { CliError } from "../errors/cli-error";

export type SchemaCacheKind = "core-openapi" | "metadata-openapi" | "graphql" | "metadata-objects";
export type SchemaCacheKindInput = SchemaCacheKind | "core" | "metadata" | "all";

export interface SchemaCacheServiceOptions {
  cacheRoot?: string;
}

export interface SchemaCacheOperationOptions {
  workspace?: string;
  kind?: SchemaCacheKindInput;
  now?: Date;
}

export interface SchemaCacheStatusOptions extends SchemaCacheOperationOptions {
  ttlMs?: number;
}

export interface SchemaCacheEntry {
  schemaVersion: 1;
  kind: SchemaCacheKind;
  baseUrl: string;
  workspace: string;
  fetchedAt: string;
  contentHash: string;
  sourceSchemaVersion?: string;
  schema: unknown;
}

export interface SchemaCacheEntrySummary {
  kind: SchemaCacheKind;
  cachePath: string;
  fetchedAt: string;
  contentHash: string;
  bytes: number;
}

export interface SchemaCacheStatusEntry {
  kind: SchemaCacheKind;
  exists: boolean;
  stale: boolean;
  cachePath: string;
  fetchedAt?: string;
  ageSeconds?: number;
  contentHash?: string;
  bytes?: number;
}

export interface SchemaCacheReport {
  cacheRoot: string;
  cacheDirectory: string;
  baseUrl: string;
  workspace: string;
}

export interface SchemaCacheRefreshReport extends SchemaCacheReport {
  refreshed: SchemaCacheEntrySummary[];
}

export interface SchemaCacheStatusReport extends SchemaCacheReport {
  staleAfterMs: number;
  entries: SchemaCacheStatusEntry[];
}

export interface SchemaCacheClearReport extends SchemaCacheReport {
  cleared: Array<{ kind: SchemaCacheKind; cachePath: string }>;
}

export const SCHEMA_CACHE_KINDS: SchemaCacheKind[] = [
  "core-openapi",
  "metadata-openapi",
  "graphql",
  "metadata-objects",
];
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

export class SchemaCacheService {
  private cacheRoot: string;

  constructor(
    private config: ConfigService,
    private api: Pick<ApiService, "request" | "post">,
    options: SchemaCacheServiceOptions = {},
  ) {
    this.cacheRoot = options.cacheRoot ?? path.join(os.homedir(), ".twenty", "schema-cache");
  }

  normalizeKind(kind: string | undefined = "all"): SchemaCacheKind[] {
    switch (kind) {
      case undefined:
      case "all":
        return [...SCHEMA_CACHE_KINDS];
      case "core":
      case "core-openapi":
        return ["core-openapi"];
      case "metadata":
      case "metadata-openapi":
        return ["metadata-openapi"];
      case "graphql":
        return ["graphql"];
      case "metadata-objects":
        return ["metadata-objects"];
      default:
        throw new CliError(
          `Unknown schema kind ${JSON.stringify(kind)}.`,
          "INVALID_ARGUMENTS",
          "Use one of: all, core-openapi, metadata-openapi, graphql, metadata-objects.",
        );
    }
  }

  async refresh(options: SchemaCacheOperationOptions = {}): Promise<SchemaCacheRefreshReport> {
    const context = await this.resolveCacheContext(options.workspace, true);
    const now = options.now ?? new Date();
    const kinds = this.normalizeKind(options.kind);
    const refreshed: SchemaCacheEntrySummary[] = [];

    await fs.ensureDir(context.cacheDirectory);

    for (const kind of kinds) {
      const schema = await this.fetchSchema(kind);
      const entry = this.createEntry(kind, context, schema, now);
      const cachePath = this.cachePath(context.cacheDirectory, kind);
      const serialized = JSON.stringify(entry, null, 2);
      await fs.writeFile(cachePath, serialized, "utf-8");
      refreshed.push({
        kind,
        cachePath,
        fetchedAt: entry.fetchedAt,
        contentHash: entry.contentHash,
        bytes: Buffer.byteLength(serialized, "utf-8"),
      });
    }

    return {
      cacheRoot: this.cacheRoot,
      cacheDirectory: context.cacheDirectory,
      baseUrl: context.baseUrl,
      workspace: context.workspace,
      refreshed,
    };
  }

  async status(options: SchemaCacheStatusOptions = {}): Promise<SchemaCacheStatusReport> {
    const context = await this.resolveCacheContext(options.workspace, false);
    const now = options.now ?? new Date();
    const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    const entries = await Promise.all(
      this.normalizeKind(options.kind).map((kind) =>
        this.readStatusEntry(context.cacheDirectory, kind, now, ttlMs),
      ),
    );

    return {
      cacheRoot: this.cacheRoot,
      cacheDirectory: context.cacheDirectory,
      baseUrl: context.baseUrl,
      workspace: context.workspace,
      staleAfterMs: ttlMs,
      entries,
    };
  }

  /**
   * Reads the cached schema body for `kind` if a non-stale entry exists.
   * Returns the inner `schema` payload (not the metadata wrapper) so callers
   * can hand it directly to their existing extractors.
   * Swallows all errors and returns `undefined` so the caller can fall back to HTTP.
   */
  async readFreshSchema(
    kind: SchemaCacheKind,
    options: SchemaCacheStatusOptions = {},
  ): Promise<unknown | undefined> {
    try {
      const context = await this.resolveCacheContext(options.workspace, false);
      const now = options.now ?? new Date();
      const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
      const cachePath = this.cachePath(context.cacheDirectory, kind);
      if (!(await fs.pathExists(cachePath))) return undefined;

      const entry = (await fs.readJson(cachePath)) as SchemaCacheEntry;
      if (entry.schemaVersion !== 1 || entry.kind !== kind) return undefined;

      const fetchedAtMs = Date.parse(entry.fetchedAt);
      if (Number.isNaN(fetchedAtMs)) return undefined;
      if (now.getTime() - fetchedAtMs > ttlMs) return undefined;

      return entry.schema;
    } catch {
      return undefined;
    }
  }

  async readSchemaSourceVersion(
    kind: SchemaCacheKind,
    options: SchemaCacheOperationOptions = {},
  ): Promise<string | undefined> {
    try {
      const context = await this.resolveCacheContext(options.workspace, false);
      const cachePath = this.cachePath(context.cacheDirectory, kind);
      if (!(await fs.pathExists(cachePath))) return undefined;

      const entry = (await fs.readJson(cachePath)) as SchemaCacheEntry;
      if (entry.schemaVersion !== 1 || entry.kind !== kind) return undefined;

      return typeof entry.sourceSchemaVersion === "string" && entry.sourceSchemaVersion.length > 0
        ? entry.sourceSchemaVersion
        : undefined;
    } catch {
      return undefined;
    }
  }

  async writeSchemaSourceVersion(
    kind: SchemaCacheKind,
    sourceSchemaVersion: string,
    options: SchemaCacheOperationOptions = {},
  ): Promise<void> {
    try {
      const context = await this.resolveCacheContext(options.workspace, false);
      const cachePath = this.cachePath(context.cacheDirectory, kind);
      if (!(await fs.pathExists(cachePath))) return;

      const entry = (await fs.readJson(cachePath)) as SchemaCacheEntry;
      if (entry.schemaVersion !== 1 || entry.kind !== kind) return;

      entry.sourceSchemaVersion = sourceSchemaVersion;
      await fs.writeFile(cachePath, JSON.stringify(entry, null, 2), "utf-8");
    } catch {
      // Cache metadata writes are best-effort, like schema body writes.
    }
  }

  /**
   * Persists `schema` for `kind` to the on-disk cache without performing an HTTP fetch.
   * Used to opportunistically populate the cache from runtime API responses.
   * Swallows errors so the caller's primary path is never broken by cache I/O failures.
   */
  async writeSchema(
    kind: SchemaCacheKind,
    schema: unknown,
    options: SchemaCacheOperationOptions = {},
  ): Promise<void> {
    try {
      const context = await this.resolveCacheContext(options.workspace, false);
      const now = options.now ?? new Date();
      await fs.ensureDir(context.cacheDirectory);
      const entry = this.createEntry(kind, context, schema, now);
      const cachePath = this.cachePath(context.cacheDirectory, kind);
      await fs.writeFile(cachePath, JSON.stringify(entry, null, 2), "utf-8");
    } catch {
      // Cache write failures must not surface to the runtime caller.
    }
  }

  async clear(options: SchemaCacheOperationOptions = {}): Promise<SchemaCacheClearReport> {
    const context = await this.resolveCacheContext(options.workspace, false);
    const cleared: Array<{ kind: SchemaCacheKind; cachePath: string }> = [];

    for (const kind of this.normalizeKind(options.kind)) {
      const cachePath = this.cachePath(context.cacheDirectory, kind);
      if (await fs.pathExists(cachePath)) {
        await fs.remove(cachePath);
        cleared.push({ kind, cachePath });
      }
    }

    if (
      (await fs.pathExists(context.cacheDirectory)) &&
      (await fs.readdir(context.cacheDirectory)).length === 0
    ) {
      await fs.remove(context.cacheDirectory);
    }

    return {
      cacheRoot: this.cacheRoot,
      cacheDirectory: context.cacheDirectory,
      baseUrl: context.baseUrl,
      workspace: context.workspace,
      cleared,
    };
  }

  private async fetchSchema(kind: SchemaCacheKind): Promise<unknown> {
    if (kind === "core-openapi") {
      return (await this.api.request({ method: "get", url: "/rest/open-api/core" })).data;
    }
    if (kind === "metadata-openapi") {
      return (await this.api.request({ method: "get", url: "/rest/open-api/metadata" })).data;
    }
    if (kind === "metadata-objects") {
      return (await this.api.request({ method: "get", url: "/rest/metadata/objects" })).data;
    }

    return (await this.api.post("/graphql", { query: GRAPHQL_INTROSPECTION_QUERY })).data;
  }

  private createEntry(
    kind: SchemaCacheKind,
    context: SchemaCacheContext,
    schema: unknown,
    now: Date,
  ): SchemaCacheEntry {
    const normalizedSchema = schema ?? null;

    return {
      schemaVersion: 1,
      kind,
      baseUrl: context.baseUrl,
      workspace: context.workspace,
      fetchedAt: now.toISOString(),
      contentHash: hashJson(normalizedSchema),
      schema: normalizedSchema,
    };
  }

  private async readStatusEntry(
    cacheDirectory: string,
    kind: SchemaCacheKind,
    now: Date,
    ttlMs: number,
  ): Promise<SchemaCacheStatusEntry> {
    const cachePath = this.cachePath(cacheDirectory, kind);
    if (!(await fs.pathExists(cachePath))) {
      return {
        kind,
        exists: false,
        stale: true,
        cachePath,
      };
    }

    const [entry, stat] = await Promise.all([
      fs.readJson(cachePath) as Promise<SchemaCacheEntry>,
      fs.stat(cachePath),
    ]);
    const fetchedAtMs = Date.parse(entry.fetchedAt);
    const ageSeconds = Number.isNaN(fetchedAtMs)
      ? undefined
      : Math.max(0, Math.floor((now.getTime() - fetchedAtMs) / 1000));

    return {
      kind,
      exists: true,
      stale: ageSeconds === undefined ? true : ageSeconds * 1000 > ttlMs,
      cachePath,
      fetchedAt: entry.fetchedAt,
      ...(ageSeconds !== undefined ? { ageSeconds } : {}),
      contentHash: entry.contentHash,
      bytes: stat.size,
    };
  }

  private async resolveCacheContext(
    workspaceOverride: string | undefined,
    requireAuth: boolean,
  ): Promise<SchemaCacheContext> {
    const resolved = await this.config.resolveApiConfig({
      workspace: workspaceOverride,
      requireAuth,
      missingAuthSuggestion:
        "Set TWENTY_API_TOKEN or run twenty auth login before refreshing schemas.",
    });
    const baseUrl = normalizeSchemaCacheBaseUrl(resolved.apiUrl);
    const workspace = resolved.workspace ?? workspaceOverride ?? "default";
    const cacheDirectory = schemaCacheDirectoryFor(this.cacheRoot, baseUrl, workspace);

    return {
      baseUrl,
      workspace,
      cacheDirectory,
    };
  }

  private cachePath(cacheDirectory: string, kind: SchemaCacheKind): string {
    return path.join(cacheDirectory, `${kind}.json`);
  }
}

interface SchemaCacheContext {
  baseUrl: string;
  workspace: string;
  cacheDirectory: string;
}

export function normalizeSchemaCacheBaseUrl(apiUrl: string): string {
  const url = new URL(apiUrl);
  url.username = "";
  url.password = "";
  url.search = "";
  url.hash = "";
  if (!url.pathname.endsWith("/")) {
    url.pathname = `${url.pathname}/`;
  }
  return url.toString();
}

export function schemaCacheDirectoryFor(
  cacheRoot: string,
  baseUrl: string,
  workspace: string,
): string {
  return path.join(cacheRoot, hashText(`${baseUrl}\0${workspace}`));
}

function hashJson(value: unknown): string {
  return hashText(JSON.stringify(value) ?? "null");
}

function hashText(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export const GRAPHQL_INTROSPECTION_QUERY = `
query IntrospectionQuery {
  __schema {
    queryType { name }
    mutationType { name }
    subscriptionType { name }
    types {
      ...FullType
    }
    directives {
      name
      description
      locations
      args {
        ...InputValue
      }
    }
  }
}

fragment FullType on __Type {
  kind
  name
  description
  fields(includeDeprecated: true) {
    name
    description
    args {
      ...InputValue
    }
    type {
      ...TypeRef
    }
    isDeprecated
    deprecationReason
  }
  inputFields {
    ...InputValue
  }
  interfaces {
    ...TypeRef
  }
  enumValues(includeDeprecated: true) {
    name
    description
    isDeprecated
    deprecationReason
  }
  possibleTypes {
    ...TypeRef
  }
}

fragment InputValue on __InputValue {
  name
  description
  type { ...TypeRef }
  defaultValue
}

fragment TypeRef on __Type {
  kind
  name
  ofType {
    kind
    name
    ofType {
      kind
      name
      ofType {
        kind
        name
        ofType {
          kind
          name
        }
      }
    }
  }
}
`;
