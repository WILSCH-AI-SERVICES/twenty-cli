import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DbConfigResolverService } from "../db-config-resolver.service";
import { DbProfileService } from "../db-profile.service";
import { DbStatusService } from "../db-status.service";

describe("DbStatusService", () => {
  beforeEach(() => {
    delete process.env.TWENTY_INTERNAL_READ_BACKEND;
    delete process.env.TWENTY_DATABASE_URL;
    delete process.env.TWENTY_DATABASE_PASSWORD;
    delete process.env.TWENTY_DATABASE_SCHEMA;
  });

  afterEach(() => {
    delete process.env.TWENTY_INTERNAL_READ_BACKEND;
    delete process.env.TWENTY_DATABASE_URL;
    delete process.env.TWENTY_DATABASE_PASSWORD;
    delete process.env.TWENTY_DATABASE_SCHEMA;
    vi.clearAllMocks();
  });

  it("reports env db configuration as the active db-first source", async () => {
    const resolver = new DbConfigResolverService({
      resolveWorkspace: vi.fn().mockResolvedValue("prod"),
      getActiveProfile: vi.fn().mockResolvedValue(undefined),
    } as never);

    process.env.TWENTY_DATABASE_URL = "postgresql://db.example.com:5432/twenty";
    const service = new DbStatusService(resolver);

    await expect(service.getStatus({ workspace: "prod" })).resolves.toEqual({
      workspace: "prod",
      configured: true,
      mode: "db",
      source: "env",
    });
  });

  it("reports the active saved profile when db-first reads come from profile config", async () => {
    const service = new DbStatusService(
      new DbConfigResolverService({
        resolveWorkspace: vi.fn().mockResolvedValue("prod"),
        getActiveProfile: vi.fn().mockResolvedValue({
          name: "staging",
          workspace: "prod",
          databaseUrl: "postgresql://db.example.com:5432/twenty",
        }),
      } as never),
    );

    await expect(service.getStatus({ workspace: "prod" })).resolves.toEqual({
      workspace: "prod",
      configured: true,
      mode: "db",
      source: "profile",
      profileName: "staging",
    });
  });

  it("reports api mode when the internal backend override disables db-first reads", async () => {
    const service = new DbStatusService({
      resolve: vi.fn().mockResolvedValue({
        workspace: "prod",
        mode: "api",
        source: "override",
        profileName: "staging",
      }),
    } as never);

    await expect(service.getStatus({ workspace: "prod" })).resolves.toEqual({
      workspace: "prod",
      configured: false,
      mode: "api",
      source: "override",
      profileName: "staging",
    });
  });

  it("passes read-source through to db config resolution", async () => {
    const resolver = {
      resolve: vi.fn().mockResolvedValue({
        workspace: "prod",
        mode: "api",
        source: "override",
      }),
    };
    const service = new DbStatusService(resolver as never);

    await service.getStatus({ workspace: "prod", readSource: "api" });
    await service.doctor({ workspace: "prod", readSource: "db" });

    expect(resolver.resolve).toHaveBeenNthCalledWith(1, {
      workspace: "prod",
      readSource: "api",
    });
    expect(resolver.resolve).toHaveBeenNthCalledWith(2, {
      workspace: "prod",
      readSource: "db",
    });
  });

  it("redacts embedded database URLs in doctor error messages", async () => {
    const connection = {
      withClient: vi
        .fn()
        .mockRejectedValue(new Error("failed postgresql://reader:secret@db.example.com/twenty")),
      ping: vi.fn(),
    };
    const service = new DbStatusService(
      new DbConfigResolverService({
        resolveWorkspace: vi.fn().mockResolvedValue("prod"),
        getActiveProfile: vi.fn().mockResolvedValue({
          name: "staging",
          workspace: "prod",
          databaseUrl: "postgresql://reader:secret@db.example.com/twenty",
        }),
      } as never),
      connection as never,
    );

    await expect(service.doctor({ workspace: "prod" })).resolves.toMatchObject({
      connection: {
        message: "failed postgresql://reader:***@db.example.com/twenty",
      },
    });
  });

  it("reports api mode when no db configuration exists", async () => {
    const service = new DbStatusService(
      new DbConfigResolverService({
        resolveWorkspace: vi.fn().mockResolvedValue("prod"),
        getActiveProfile: vi.fn().mockResolvedValue(undefined),
      } as never),
    );

    await expect(service.getStatus({ workspace: "prod" })).resolves.toEqual({
      workspace: "prod",
      configured: false,
      mode: "api",
      source: "none",
    });
  });

  it("uses the resolver workspace even when no workspace option is passed", async () => {
    const resolveWorkspace = vi.fn().mockResolvedValue("resolved-workspace");
    const service = new DbStatusService(
      new DbConfigResolverService({
        resolveWorkspace,
        getActiveProfile: vi.fn().mockResolvedValue({
          name: "readonly",
          workspace: "resolved-workspace",
          databaseUrl: "postgresql://db.example.com:5432/twenty",
        }),
      } as never),
    );

    await expect(service.getStatus()).resolves.toEqual({
      workspace: "resolved-workspace",
      configured: true,
      mode: "db",
      source: "profile",
      profileName: "readonly",
    });
    expect(resolveWorkspace).toHaveBeenCalledWith(undefined);
  });

  it("doctors the resolved db connection with a redacted database URL", async () => {
    const client = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
    };
    const connection = {
      withClient: vi
        .fn()
        .mockImplementation(async (_options: unknown, fn: (c: typeof client) => Promise<unknown>) =>
          fn(client),
        ),
      ping: vi.fn().mockResolvedValue({ ok: true }),
    };
    const service = new DbStatusService(
      new DbConfigResolverService({
        resolveWorkspace: vi.fn().mockResolvedValue("prod"),
        getActiveProfile: vi.fn().mockResolvedValue({
          name: "staging",
          workspace: "prod",
          databaseUrl: "postgresql://reader:secret@db.example.com:5432/twenty?sslmode=require",
        }),
      } as never),
      connection as never,
    );

    await expect(service.doctor({ workspace: "prod" })).resolves.toMatchObject({
      workspace: "prod",
      configured: true,
      mode: "db",
      source: "profile",
      profileName: "staging",
      databaseUrl: "postgresql://reader@db.example.com:5432/twenty?sslmode=require",
      ok: true,
      checkedAt: expect.any(String),
      connection: { ok: true },
    });
    expect(connection.withClient).toHaveBeenCalledWith(
      {
        databaseUrl: "postgresql://reader@db.example.com:5432/twenty?sslmode=require",
      },
      expect.any(Function),
    );
    expect(connection.ping).toHaveBeenCalledWith(client);
  });

  it("doctor reports effective sslmode and connect-timeout presence", async () => {
    const client = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
    };
    const connection = {
      withClient: vi
        .fn()
        .mockImplementation(async (_options: unknown, fn: (c: typeof client) => Promise<unknown>) =>
          fn(client),
        ),
      ping: vi.fn().mockResolvedValue({ ok: true }),
    };
    const service = new DbStatusService(
      new DbConfigResolverService({
        resolveWorkspace: vi.fn().mockResolvedValue("prod"),
        getActiveProfile: vi.fn().mockResolvedValue({
          name: "staging",
          workspace: "prod",
          databaseUrl:
            "postgresql://reader:secret@db.example.com:5432/twenty?sslmode=require&connect_timeout=5",
        }),
      } as never),
      connection as never,
      {
        resolve: vi.fn().mockResolvedValue({ schemaName: "workspace_test", tableName: "person" }),
      } as never,
    );

    await expect(service.doctor({ workspace: "prod" })).resolves.toMatchObject({
      effectiveSslmode: "require",
      sslmodeSource: "url",
      hasConnectTimeout: true,
      warnings: [],
    });
  });

  it("doctor reports the resolved workspace schema and per-resource readability", async () => {
    const client = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
    };
    const connection = {
      withClient: vi
        .fn()
        .mockImplementation(async (_options: unknown, fn: (c: typeof client) => Promise<unknown>) =>
          fn(client),
        ),
      ping: vi.fn().mockResolvedValue({ ok: true }),
    };
    const tableResolver = {
      resolve: vi
        .fn()
        .mockImplementation(async (_client: unknown, _target: unknown, tableName: string) => {
          if (tableName === "company") {
            throw new Error("missing table");
          }
          return { schemaName: "workspace_test", tableName };
        }),
    };
    const service = new DbStatusService(
      new DbConfigResolverService({
        resolveWorkspace: vi.fn().mockResolvedValue("prod"),
        getActiveProfile: vi.fn().mockResolvedValue({
          name: "staging",
          workspace: "prod",
          databaseUrl: "postgresql://reader:secret@db.example.com:5432/twenty",
        }),
      } as never),
      connection as never,
      tableResolver as never,
    );

    await expect(service.doctor({ workspace: "prod" })).resolves.toMatchObject({
      resolvedSchema: "workspace_test",
      resources: expect.arrayContaining([
        { name: "people", readable: true },
        { name: "companies", readable: false, reason: "missing table" },
      ]),
    });
  });

  it("reports doctor failure without connecting when no db url is resolved", async () => {
    const connection = {
      withClient: vi.fn(),
      ping: vi.fn(),
    };
    const service = new DbStatusService(
      new DbConfigResolverService({
        resolveWorkspace: vi.fn().mockResolvedValue("prod"),
        getActiveProfile: vi.fn().mockResolvedValue(undefined),
      } as never),
      connection as never,
    );

    await expect(service.doctor({ workspace: "prod" })).resolves.toMatchObject({
      workspace: "prod",
      configured: false,
      mode: "api",
      source: "none",
      ok: false,
      checkedAt: expect.any(String),
      connection: {
        ok: false,
        errorCode: "DB_NOT_CONFIGURED",
      },
    });
    expect(connection.withClient).not.toHaveBeenCalled();
  });

  it("reports doctor connection errors with a redacted database URL", async () => {
    const connection = {
      withClient: vi.fn().mockRejectedValue(new Error("password authentication failed")),
      ping: vi.fn(),
    };
    const service = new DbStatusService(
      new DbConfigResolverService({
        resolveWorkspace: vi.fn().mockResolvedValue("prod"),
        getActiveProfile: vi.fn().mockResolvedValue({
          name: "staging",
          workspace: "prod",
          databaseUrl: "postgresql://reader:secret@db.example.com/twenty",
        }),
      } as never),
      connection as never,
    );

    await expect(service.doctor({ workspace: "prod" })).resolves.toMatchObject({
      databaseUrl: "postgresql://reader@db.example.com/twenty",
      ok: false,
      connection: {
        ok: false,
        errorCode: "DB_CONNECTION_FAILED",
        message: "password authentication failed",
      },
    });
  });

  it("opens and pings the selected db profile with an env-backed password", async () => {
    process.env.TWENTY_DATABASE_PASSWORD = "env-secret";
    const configService = {
      resolveApiConfig: vi.fn().mockResolvedValue({ workspace: "demo" }),
      getDbProfile: vi.fn().mockResolvedValue({
        name: "prod",
        workspace: "demo",
        databaseUrl: "postgresql://reader@db.example.com/twenty",
        credentialSource: "manual",
      }),
      saveDbProfile: vi.fn().mockResolvedValue(undefined),
    };
    const client = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
    };
    const connection = {
      withClient: vi
        .fn()
        .mockImplementation(async (_options: unknown, fn: (c: typeof client) => Promise<unknown>) =>
          fn(client),
        ),
      ping: vi.fn().mockResolvedValue({ ok: true }),
    };
    const service = new DbProfileService(configService as never, connection as never);

    await service.test("demo", "prod");

    expect(connection.withClient).toHaveBeenCalledWith(
      {
        databaseUrl: "postgresql://reader:env-secret@db.example.com/twenty",
      },
      expect.any(Function),
    );
    expect(connection.ping).toHaveBeenCalledWith(client);
    expect(configService.saveDbProfile).toHaveBeenCalledWith(
      "demo",
      expect.objectContaining({
        name: "prod",
        lastValidatedAt: expect.any(String),
      }),
    );
  });
});
