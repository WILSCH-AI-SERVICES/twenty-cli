import { describe, expect, it, vi } from "vitest";

import { UnsupportedDbReadError } from "../../../readbackend/types";
import { DbTableResolverService } from "../db-table-resolver.service";

const BASE_TARGET = {
  mode: "db",
  source: "env",
  workspace: "default",
  databaseUrl: "postgresql://reader:secret@db.example.com:5432/twenty",
} as const;

describe("DbTableResolverService", () => {
  it("uses an explicitly resolved database schema without extra metadata queries", async () => {
    const client = {
      query: vi.fn(),
    };
    const service = new DbTableResolverService();

    await expect(
      service.resolve(
        client as never,
        {
          ...BASE_TARGET,
          databaseSchema: "workspace_test",
        },
        "person",
      ),
    ).resolves.toEqual({
      schemaName: "workspace_test",
      tableName: "person",
    });
    expect(client.query).not.toHaveBeenCalled();
  });

  it("discovers the single active workspace schema from core metadata", async () => {
    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [{ schemaName: "workspace_a9ks4i9ukbvan2rrs6bhfk8pj" }],
        })
        .mockResolvedValueOnce({ rows: [{ tableName: "person" }, { tableName: "company" }] }),
    };
    const service = new DbTableResolverService();

    await expect(service.resolve(client as never, BASE_TARGET, "person")).resolves.toEqual({
      schemaName: "workspace_a9ks4i9ukbvan2rrs6bhfk8pj",
      tableName: "person",
    });
    expect(client.query).toHaveBeenCalledTimes(2);
  });

  it("memoizes the workspace schema and table-set across resolves on the same connection", async () => {
    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [{ schemaName: "workspace_a9ks4i9ukbvan2rrs6bhfk8pj" }],
        })
        .mockResolvedValueOnce({
          rows: [{ tableName: "person" }, { tableName: "company" }, { tableName: "task" }],
        }),
    };
    const service = new DbTableResolverService();

    await expect(service.resolve(client as never, BASE_TARGET, "person")).resolves.toEqual({
      schemaName: "workspace_a9ks4i9ukbvan2rrs6bhfk8pj",
      tableName: "person",
    });
    await expect(service.resolve(client as never, BASE_TARGET, "company")).resolves.toEqual({
      schemaName: "workspace_a9ks4i9ukbvan2rrs6bhfk8pj",
      tableName: "company",
    });
    await expect(service.resolve(client as never, BASE_TARGET, "task")).resolves.toEqual({
      schemaName: "workspace_a9ks4i9ukbvan2rrs6bhfk8pj",
      tableName: "task",
    });
    // Two queries total: one for the workspace schema, one for the table set.
    // Subsequent resolves are served from the in-process cache.
    expect(client.query).toHaveBeenCalledTimes(2);
  });

  it("falls back to a single schema containing the requested table", async () => {
    const client = {
      query: vi
        .fn()
        .mockRejectedValueOnce(new Error("core unavailable"))
        .mockResolvedValueOnce({
          rows: [{ schemaName: "workspace_fallback" }],
        }),
    };
    const service = new DbTableResolverService();

    await expect(service.resolve(client as never, BASE_TARGET, "favorite")).resolves.toEqual({
      schemaName: "workspace_fallback",
      tableName: "favorite",
    });
  });

  it("requires explicit schema configuration when table discovery is ambiguous", async () => {
    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [{ schemaName: "workspace_one" }, { schemaName: "workspace_two" }],
        })
        .mockResolvedValueOnce({
          rows: [{ schemaName: "workspace_one" }, { schemaName: "workspace_two" }],
        }),
    };
    const service = new DbTableResolverService();

    await expect(service.resolve(client as never, BASE_TARGET, "person")).rejects.toBeInstanceOf(
      UnsupportedDbReadError,
    );
  });
});
