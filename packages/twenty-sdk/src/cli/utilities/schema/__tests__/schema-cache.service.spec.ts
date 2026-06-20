import os from "node:os";
import path from "node:path";

import fs from "fs-extra";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SCHEMA_CACHE_KINDS, SchemaCacheService } from "../schema-cache.service";

function createConfigService(apiUrl = "https://crm.acme.com?token=secret-token") {
  return {
    resolveApiConfig: vi.fn().mockResolvedValue({
      apiUrl,
      apiKey: "secret-token",
      workspace: "default",
    }),
  };
}

function createApiService() {
  return {
    request: vi.fn(async ({ url }: { url: string }) => {
      if (url === "/rest/metadata/objects") {
        return {
          data: {
            data: {
              objects: {
                edges: [{ node: { id: "obj-1", nameSingular: "person", namePlural: "people" } }],
              },
            },
          },
        };
      }
      return {
        data: {
          openapi: "3.1.0",
          info: { title: url === "/rest/open-api/core" ? "Core" : "Metadata" },
        },
      };
    }),
    post: vi.fn(async () => ({
      data: {
        data: {
          __schema: {
            queryType: { name: "Query" },
            mutationType: { name: "Mutation" },
            types: [],
          },
        },
      },
    })),
  };
}

describe("SchemaCacheService", () => {
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "twenty-schema-cache-"));
  });

  afterEach(async () => {
    await fs.remove(tempRoot);
  });

  it("refreshes all schema kinds into token-safe cache entries", async () => {
    const config = createConfigService();
    const api = createApiService();
    const service = new SchemaCacheService(config as any, api as any, { cacheRoot: tempRoot });

    const report = await service.refresh({ workspace: "default" });

    expect(config.resolveApiConfig).toHaveBeenCalledWith({
      workspace: "default",
      requireAuth: true,
      missingAuthSuggestion: expect.any(String),
    });
    expect(api.request).toHaveBeenCalledWith({ method: "get", url: "/rest/open-api/core" });
    expect(api.request).toHaveBeenCalledWith({ method: "get", url: "/rest/open-api/metadata" });
    expect(api.request).toHaveBeenCalledWith({ method: "get", url: "/rest/metadata/objects" });
    expect(api.post).toHaveBeenCalledWith(
      "/graphql",
      expect.objectContaining({
        query: expect.stringContaining("IntrospectionQuery"),
      }),
    );
    expect(report.workspace).toBe("default");
    expect(report.baseUrl).toBe("https://crm.acme.com/");
    expect(report.refreshed.map((entry) => entry.kind).sort()).toEqual([
      "core-openapi",
      "graphql",
      "metadata-objects",
      "metadata-openapi",
    ]);
    expect(report.refreshed.every((entry) => entry.contentHash.length === 64)).toBe(true);

    const files = await fs.readdir(report.cacheDirectory);
    expect(files.sort()).toEqual([
      "core-openapi.json",
      "graphql.json",
      "metadata-objects.json",
      "metadata-openapi.json",
    ]);

    const coreEntry = await fs.readJson(path.join(report.cacheDirectory, "core-openapi.json"));
    expect(coreEntry).toEqual(
      expect.objectContaining({
        schemaVersion: 1,
        kind: "core-openapi",
        baseUrl: "https://crm.acme.com/",
        workspace: "default",
        contentHash: report.refreshed.find((entry) => entry.kind === "core-openapi")?.contentHash,
        schema: {
          openapi: "3.1.0",
          info: { title: "Core" },
        },
      }),
    );
    expect(JSON.stringify(coreEntry)).not.toContain("secret-token");
  });

  it("refreshes one schema kind when requested", async () => {
    const config = createConfigService("https://crm.acme.com");
    const api = createApiService();
    const service = new SchemaCacheService(config as any, api as any, { cacheRoot: tempRoot });

    const report = await service.refresh({ kind: "metadata-openapi" });

    expect(report.refreshed.map((entry) => entry.kind)).toEqual(["metadata-openapi"]);
    expect(api.request).toHaveBeenCalledTimes(1);
    expect(api.request).toHaveBeenCalledWith({ method: "get", url: "/rest/open-api/metadata" });
    expect(api.post).not.toHaveBeenCalled();
  });

  it("reports missing, present, and stale cache status without fetching schemas", async () => {
    const config = createConfigService("https://crm.acme.com");
    const api = createApiService();
    const service = new SchemaCacheService(config as any, api as any, { cacheRoot: tempRoot });

    await service.refresh({
      kind: "core-openapi",
      now: new Date("2026-04-25T00:00:00.000Z"),
    });

    const status = await service.status({
      now: new Date("2026-04-26T12:00:00.000Z"),
      ttlMs: 24 * 60 * 60 * 1000,
    });

    expect(api.request).toHaveBeenCalledTimes(1);
    expect(api.post).not.toHaveBeenCalled();
    expect(status.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "core-openapi",
          exists: true,
          stale: true,
          ageSeconds: 129600,
        }),
        expect.objectContaining({
          kind: "metadata-openapi",
          exists: false,
          stale: true,
        }),
        expect.objectContaining({
          kind: "graphql",
          exists: false,
          stale: true,
        }),
        expect.objectContaining({
          kind: "metadata-objects",
          exists: false,
          stale: true,
        }),
      ]),
    );
  });

  it("clears one schema kind or all cached schemas for the active profile", async () => {
    const config = createConfigService("https://crm.acme.com");
    const api = createApiService();
    const service = new SchemaCacheService(config as any, api as any, { cacheRoot: tempRoot });

    await service.refresh();

    const clearOne = await service.clear({ kind: "graphql" });
    expect(clearOne.cleared.map((entry) => entry.kind)).toEqual(["graphql"]);
    expect((await service.status()).entries.find((entry) => entry.kind === "graphql")?.exists).toBe(
      false,
    );

    const clearAll = await service.clear();
    expect(clearAll.cleared.map((entry) => entry.kind).sort()).toEqual([
      "core-openapi",
      "metadata-objects",
      "metadata-openapi",
    ]);
    expect(await fs.pathExists(clearAll.cacheDirectory)).toBe(false);
  });

  it("normalizes schema kind aliases", async () => {
    const service = new SchemaCacheService(
      createConfigService() as any,
      createApiService() as any,
      {
        cacheRoot: tempRoot,
      },
    );

    expect(service.normalizeKind("all")).toEqual([
      "core-openapi",
      "metadata-openapi",
      "graphql",
      "metadata-objects",
    ]);
    expect(service.normalizeKind("core")).toEqual(["core-openapi"]);
    expect(service.normalizeKind("metadata")).toEqual(["metadata-openapi"]);
    expect(service.normalizeKind("graphql")).toEqual(["graphql"]);
    expect(service.normalizeKind("metadata-objects")).toEqual(["metadata-objects"]);
    expect(() => service.normalizeKind("unknown")).toThrow("Unknown schema kind");
  });

  describe('"metadata-objects" kind', () => {
    it("is included in SCHEMA_CACHE_KINDS", () => {
      expect(SCHEMA_CACHE_KINDS).toContain("metadata-objects");
    });

    it("refresh fetches /rest/metadata/objects and stores the response", async () => {
      const config = createConfigService("https://crm.acme.com");
      const api = createApiService();
      const service = new SchemaCacheService(config as any, api as any, { cacheRoot: tempRoot });

      const report = await service.refresh({ kind: "metadata-objects" });

      expect(report.refreshed.map((entry) => entry.kind)).toEqual(["metadata-objects"]);
      expect(api.request).toHaveBeenCalledTimes(1);
      expect(api.request).toHaveBeenCalledWith({
        method: "get",
        url: "/rest/metadata/objects",
      });
      expect(api.post).not.toHaveBeenCalled();

      const cacheFile = path.join(report.cacheDirectory, "metadata-objects.json");
      expect(await fs.pathExists(cacheFile)).toBe(true);

      const entry = await fs.readJson(cacheFile);
      expect(entry).toEqual(
        expect.objectContaining({
          schemaVersion: 1,
          kind: "metadata-objects",
          baseUrl: "https://crm.acme.com/",
          workspace: "default",
          schema: {
            data: {
              objects: {
                edges: [{ node: { id: "obj-1", nameSingular: "person", namePlural: "people" } }],
              },
            },
          },
        }),
      );
    });

    it("stores and reads the source schema version alongside the cached objects", async () => {
      const config = createConfigService("https://crm.acme.com");
      const api = createApiService();
      const service = new SchemaCacheService(config as any, api as any, { cacheRoot: tempRoot });

      const report = await service.refresh({ kind: "metadata-objects" });
      await service.writeSchemaSourceVersion("metadata-objects", "version-1");

      expect(await service.readSchemaSourceVersion("metadata-objects")).toBe("version-1");

      const cacheFile = path.join(report.cacheDirectory, "metadata-objects.json");
      const entry = await fs.readJson(cacheFile);
      expect(entry.sourceSchemaVersion).toBe("version-1");
    });
  });
});
