import os from "node:os";
import path from "node:path";

import fs from "fs-extra";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { readCachedSchemaEntries, resolveCachedSchemaContext } from "../schema-cache-reader";
import { SchemaCacheService } from "../schema-cache.service";

function createConfigService(apiUrl = "https://crm.acme.com") {
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
    request: vi.fn(async ({ url }: { url: string }) => ({
      data: {
        openapi: "3.1.0",
        paths:
          url === "/rest/open-api/core"
            ? { "/people": {}, "/people/{id}": {} }
            : { "/metadata/views": {}, "/metadata/views/{id}": {} },
      },
    })),
    post: vi.fn(async () => ({ data: { data: { __schema: { types: [] } } } })),
  };
}

describe("schema cache reader", () => {
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "twenty-schema-cache-reader-"));
  });

  afterEach(async () => {
    await fs.remove(tempRoot);
  });

  it("resolves cached schema context from environment without leaking URL query params", () => {
    const context = resolveCachedSchemaContext({
      cacheRoot: tempRoot,
      env: {
        TWENTY_BASE_URL: "https://crm.acme.com?token=secret",
        TWENTY_PROFILE: "default",
      },
    });

    expect(context).toEqual(
      expect.objectContaining({
        baseUrl: "https://crm.acme.com/",
        workspace: "default",
      }),
    );
    expect(context.cacheDirectory).toMatch(tempRoot);
    expect(context.cacheDirectory).not.toContain("secret");
  });

  it("resolves cached schema context from the config file when env is absent", async () => {
    const configPath = path.join(tempRoot, "config.json");
    await fs.writeJson(configPath, {
      defaultWorkspace: "main",
      workspaces: {
        main: {
          apiUrl: "https://api.example.com?token=secret",
        },
      },
    });

    const context = resolveCachedSchemaContext({
      cacheRoot: tempRoot,
      configPath,
      env: {},
    });

    expect(context.baseUrl).toBe("https://api.example.com/");
    expect(context.workspace).toBe("main");
  });

  it("matches cache service workspace fallback when config has no default workspace", async () => {
    const configPath = path.join(tempRoot, "config.json");
    await fs.writeJson(configPath, {
      workspaces: {
        main: {
          apiUrl: "https://api.example.com",
        },
      },
    });

    const context = resolveCachedSchemaContext({
      cacheRoot: tempRoot,
      configPath,
      env: {},
    });

    expect(context.baseUrl).toBe("https://api.twenty.com/");
    expect(context.workspace).toBe("default");
  });

  it("falls back to the default base URL when cached config input is malformed", () => {
    const context = resolveCachedSchemaContext({
      cacheRoot: tempRoot,
      env: {
        TWENTY_BASE_URL: "not a url",
        TWENTY_PROFILE: "default",
      },
    });

    expect(context.baseUrl).toBe("https://api.twenty.com/");
    expect(context.workspace).toBe("default");
  });

  it("reads cached schema entries written by the cache service", async () => {
    const service = new SchemaCacheService(
      createConfigService() as any,
      createApiService() as any,
      {
        cacheRoot: tempRoot,
      },
    );
    await service.refresh();

    const entries = readCachedSchemaEntries({
      cacheRoot: tempRoot,
      env: {
        TWENTY_BASE_URL: "https://crm.acme.com",
        TWENTY_PROFILE: "default",
      },
    });

    expect(entries.context.workspace).toBe("default");
    expect(entries.coreOpenApi?.schema).toEqual(
      expect.objectContaining({
        paths: { "/people": {}, "/people/{id}": {} },
      }),
    );
    expect(entries.metadataOpenApi?.schema).toEqual(
      expect.objectContaining({
        paths: { "/metadata/views": {}, "/metadata/views/{id}": {} },
      }),
    );
    expect(entries.graphql?.schema).toEqual({ data: { __schema: { types: [] } } });
  });

  it("returns an empty entry set when the cache directory does not exist", () => {
    const entries = readCachedSchemaEntries({
      cacheRoot: tempRoot,
      env: {
        TWENTY_BASE_URL: "https://smoke.example.com",
        TWENTY_PROFILE: "default",
      },
    });

    expect(entries.coreOpenApi).toBeUndefined();
    expect(entries.metadataOpenApi).toBeUndefined();
    expect(entries.graphql).toBeUndefined();
  });
});
