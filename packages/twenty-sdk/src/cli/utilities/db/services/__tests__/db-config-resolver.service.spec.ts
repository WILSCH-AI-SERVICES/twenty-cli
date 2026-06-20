import { afterEach, describe, expect, it, vi } from "vitest";

import { DbConfigResolverService } from "../db-config-resolver.service";

describe("DbConfigResolverService", () => {
  afterEach(() => {
    delete process.env.TWENTY_INTERNAL_READ_BACKEND;
    delete process.env.TWENTY_DATABASE_URL;
    delete process.env.TWENTY_DATABASE_PASSWORD;
    delete process.env.TWENTY_DATABASE_SCHEMA;
    vi.clearAllMocks();
  });

  it("forces api when readSource is api", async () => {
    process.env.TWENTY_DATABASE_URL = "postgresql://env-user:env-pass@db.example.com:5432/twenty";

    const dbProfiles = {
      resolveWorkspace: vi.fn().mockResolvedValue("prod"),
      getActiveProfile: vi.fn().mockResolvedValue({
        name: "staging",
        workspace: "prod",
        databaseUrl: "postgresql://profile-user:profile-pass@db.example.com:5432/twenty_staging",
      }),
    };

    const resolver = new DbConfigResolverService(dbProfiles as never);

    await expect(resolver.resolve({ workspace: "prod", readSource: "api" })).resolves.toEqual({
      workspace: "prod",
      mode: "api",
      source: "override",
    });
    expect(dbProfiles.getActiveProfile).not.toHaveBeenCalled();
  });

  it("throws when readSource is db and no db config exists", async () => {
    const resolver = new DbConfigResolverService({
      resolveWorkspace: vi.fn().mockResolvedValue("prod"),
      getActiveProfile: vi.fn().mockResolvedValue(undefined),
    } as never);

    await expect(resolver.resolve({ workspace: "prod", readSource: "db" })).rejects.toThrow(
      "No DB URL resolved for --read-source db.",
    );
  });

  it("prefers TWENTY_DATABASE_URL over the saved active db profile", async () => {
    process.env.TWENTY_DATABASE_URL = "postgresql://env-user:env-pass@db.example.com:5432/twenty";
    process.env.TWENTY_DATABASE_SCHEMA = "workspace_env";

    const resolver = new DbConfigResolverService({
      resolveWorkspace: vi.fn().mockResolvedValue("prod"),
      getActiveProfile: vi.fn().mockResolvedValue({
        name: "staging",
        workspace: "prod",
        databaseUrl: "postgresql://profile-user:profile-pass@db.example.com:5432/twenty_staging",
      }),
    } as never);

    await expect(resolver.resolve({ workspace: "prod" })).resolves.toEqual({
      workspace: "prod",
      mode: "db",
      source: "env",
      databaseUrl: "postgresql://env-user:env-pass@db.example.com:5432/twenty",
      databaseSchema: "workspace_env",
    });
  });

  it("uses the saved active db profile when no env database url is set", async () => {
    process.env.TWENTY_DATABASE_PASSWORD = "env-pass";
    process.env.TWENTY_DATABASE_SCHEMA = "workspace_override";
    const resolver = new DbConfigResolverService({
      resolveWorkspace: vi.fn().mockResolvedValue("prod"),
      getActiveProfile: vi.fn().mockResolvedValue({
        name: "staging",
        workspace: "prod",
        databaseUrl: "postgresql://profile-user@db.example.com:5432/twenty_staging",
        databaseSchema: "workspace_profile",
      }),
    } as never);

    await expect(resolver.resolve({ workspace: "prod" })).resolves.toEqual({
      workspace: "prod",
      mode: "db",
      source: "profile",
      databaseUrl: "postgresql://profile-user:env-pass@db.example.com:5432/twenty_staging",
      databaseSchema: "workspace_override",
      profileName: "staging",
    });
  });

  it("prefers TWENTY_DATABASE_URL over profile env password composition", async () => {
    process.env.TWENTY_DATABASE_URL = "postgresql://env-user:env-pass@db.example.com:5432/twenty";
    process.env.TWENTY_DATABASE_PASSWORD = "profile-env-pass";

    const resolver = new DbConfigResolverService({
      resolveWorkspace: vi.fn().mockResolvedValue("prod"),
      getActiveProfile: vi.fn().mockResolvedValue({
        name: "staging",
        workspace: "prod",
        databaseUrl: "postgresql://profile-user@db.example.com:5432/twenty_staging",
      }),
    } as never);

    await expect(resolver.resolve({ workspace: "prod" })).resolves.toMatchObject({
      source: "env",
      databaseUrl: "postgresql://env-user:env-pass@db.example.com:5432/twenty",
    });
  });

  it("ignores legacy cached profile passwords when resolving profile urls", async () => {
    const resolver = new DbConfigResolverService({
      resolveWorkspace: vi.fn().mockResolvedValue("prod"),
      getActiveProfile: vi.fn().mockResolvedValue({
        name: "staging",
        workspace: "prod",
        databaseUrl: "postgresql://profile-user@db.example.com:5432/twenty_staging",
        cachedPassword: "legacy-secret",
      }),
    } as never);

    await expect(resolver.resolve({ workspace: "prod" })).resolves.toEqual({
      workspace: "prod",
      mode: "db",
      source: "profile",
      databaseUrl: "postgresql://profile-user@db.example.com:5432/twenty_staging",
      databaseSchema: undefined,
      profileName: "staging",
    });
  });

  it("uses the saved active profile schema when no env schema is set", async () => {
    const resolver = new DbConfigResolverService({
      resolveWorkspace: vi.fn().mockResolvedValue("prod"),
      getActiveProfile: vi.fn().mockResolvedValue({
        name: "staging",
        workspace: "prod",
        databaseUrl: "postgresql://profile-user:profile-pass@db.example.com:5432/twenty_staging",
        databaseSchema: "workspace_profile",
      }),
    } as never);

    await expect(resolver.resolve({ workspace: "prod" })).resolves.toEqual({
      workspace: "prod",
      mode: "db",
      source: "profile",
      databaseUrl: "postgresql://profile-user@db.example.com:5432/twenty_staging",
      databaseSchema: "workspace_profile",
      profileName: "staging",
    });
  });

  it("falls back to api mode when no db configuration exists", async () => {
    const resolver = new DbConfigResolverService({
      resolveWorkspace: vi.fn().mockResolvedValue("prod"),
      getActiveProfile: vi.fn().mockResolvedValue(undefined),
    } as never);

    await expect(resolver.resolve({ workspace: "prod" })).resolves.toEqual({
      workspace: "prod",
      mode: "api",
      source: "none",
    });
  });
});
