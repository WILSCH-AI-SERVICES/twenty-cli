import { describe, expect, it, vi } from "vitest";

import { ReadBackendService } from "../read-backend.service";
import { DbConnectionError, SourceTracker, UnsupportedDbReadError } from "../types";

describe("ReadBackendService", () => {
  it("uses API search when the resolved target is not db", async () => {
    const apiSearch = {
      search: vi.fn().mockResolvedValue({ data: [{ recordId: "api-1" }] }),
    };
    const resolver = {
      resolve: vi.fn().mockResolvedValue({ mode: "api", source: "none", workspace: "ws" }),
    };
    const dbSearch = {
      search: vi.fn(),
    };

    const service = new ReadBackendService(resolver as never, apiSearch as never, undefined, {
      search: dbSearch as never,
    });
    const result = await service.runSearch({ query: "john" });

    expect(resolver.resolve).toHaveBeenCalledWith({ workspace: undefined, readSource: undefined });
    expect(apiSearch.search).toHaveBeenCalledWith({ query: "john" });
    expect(dbSearch.search).not.toHaveBeenCalled();
    expect(result).toEqual({ data: [{ recordId: "api-1" }] });
  });

  it("auto routes search DB-first when a DB target resolves", async () => {
    const target = {
      mode: "db",
      source: "env",
      workspace: "ws",
      databaseUrl: "postgresql://db.example.com:5432/twenty",
    };
    const apiSearch = {
      search: vi.fn().mockResolvedValue({ data: [{ recordId: "api-1" }] }),
    };
    const resolver = {
      resolve: vi.fn().mockResolvedValue(target),
    };
    const dbSearch = {
      search: vi.fn().mockResolvedValue({ data: [{ recordId: "db-1" }] }),
    };

    const service = new ReadBackendService(resolver as never, apiSearch as never, undefined, {
      search: dbSearch as never,
    });
    const result = await service.runSearch({ query: "john" });

    expect(dbSearch.search).toHaveBeenCalledWith(target, { query: "john" });
    expect(apiSearch.search).not.toHaveBeenCalled();
    expect(result).toEqual({ data: [{ recordId: "db-1" }] });
  });

  it("marks the source tracker as db after a successful DB read", async () => {
    const tracker = new SourceTracker();
    const target = {
      mode: "db",
      source: "env",
      workspace: "ws",
      databaseUrl: "postgresql://db.example.com:5432/twenty",
    };
    const apiSearch = {
      search: vi.fn(),
    };
    const resolver = {
      resolve: vi.fn().mockResolvedValue(target),
    };
    const dbSearch = {
      search: vi.fn().mockResolvedValue({ data: [{ recordId: "db-1" }] }),
    };

    const service = new ReadBackendService(
      resolver as never,
      apiSearch as never,
      undefined,
      { search: dbSearch as never },
      { sourceTracker: tracker },
    );

    await service.runSearch({ query: "Jane" });

    expect(tracker.outputSource()).toBe("db");
  });

  it("agent mode uses DB search by default", async () => {
    const target = {
      mode: "db",
      source: "env",
      workspace: "ws",
      databaseUrl: "postgresql://db.example.com:5432/twenty",
    };
    const apiSearch = {
      search: vi.fn().mockResolvedValue({ data: [{ recordId: "api-1" }] }),
    };
    const resolver = {
      resolve: vi.fn().mockResolvedValue(target),
    };
    const dbSearch = { search: vi.fn().mockResolvedValue({ data: [{ recordId: "db-1" }] }) };

    const service = new ReadBackendService(
      resolver as never,
      apiSearch as never,
      undefined,
      {
        search: dbSearch as never,
      },
      { agentMode: true },
    );
    const result = await service.runSearch({ query: "john" });

    expect(dbSearch.search).toHaveBeenCalledWith(target, { query: "john" });
    expect(apiSearch.search).not.toHaveBeenCalled();
    expect(result).toEqual({ data: [{ recordId: "db-1" }] });
  });

  it("uses DB search when read source is strict db", async () => {
    const target = {
      mode: "db",
      source: "env",
      workspace: "ws",
      databaseUrl: "postgresql://db.example.com:5432/twenty",
    };
    const apiSearch = {
      search: vi.fn(),
    };
    const resolver = {
      resolve: vi.fn().mockResolvedValue(target),
    };
    const dbSearch = {
      search: vi.fn().mockResolvedValue({ data: [{ recordId: "db-1" }] }),
    };

    const service = new ReadBackendService(
      resolver as never,
      apiSearch as never,
      undefined,
      {
        search: dbSearch as never,
      },
      { readSource: "db" },
    );
    const result = await service.runSearch({ query: "john" });

    expect(dbSearch.search).toHaveBeenCalledWith(target, { query: "john" });
    expect(apiSearch.search).not.toHaveBeenCalled();
    expect(result).toEqual({ data: [{ recordId: "db-1" }] });
  });

  it("does not fall back when read source is strict db", async () => {
    const dbError = new UnsupportedDbReadError("unsupported");
    const target = {
      mode: "db",
      source: "env",
      workspace: "ws",
      databaseUrl: "postgresql://db.example.com:5432/twenty",
    };
    const apiSearch = {
      search: vi.fn().mockResolvedValue({ data: [{ recordId: "api-1" }] }),
    };
    const resolver = {
      resolve: vi.fn().mockResolvedValue(target),
    };
    const dbSearch = {
      search: vi.fn().mockRejectedValue(dbError),
    };

    const service = new ReadBackendService(
      resolver as never,
      apiSearch as never,
      undefined,
      {
        search: dbSearch as never,
      },
      { readSource: "db" },
    );

    await expect(service.runSearch({ query: "john" })).rejects.toBe(dbError);
    expect(apiSearch.search).not.toHaveBeenCalled();
  });

  it("passes read source to the db config resolver", async () => {
    const apiSearch = {
      search: vi.fn().mockResolvedValue({ data: [{ recordId: "api-1" }] }),
    };
    const resolver = {
      resolve: vi.fn().mockResolvedValue({ mode: "api", source: "override", workspace: "ws" }),
    };

    const service = new ReadBackendService(
      resolver as never,
      apiSearch as never,
      undefined,
      {},
      { workspace: "ws", readSource: "db" },
    );

    await service.runSearch({ query: "john" });

    expect(resolver.resolve).toHaveBeenCalledWith({ workspace: "ws", readSource: "db" });
  });

  it("agent mode uses DB records reads by default", async () => {
    const target = {
      mode: "db",
      source: "env",
      workspace: "ws",
      databaseUrl: "postgresql://db.example.com:5432/twenty",
    };
    const resolver = {
      resolve: vi.fn().mockResolvedValue(target),
    };
    const apiSearch = {
      search: vi.fn(),
    };
    const apiRecords = {
      list: vi.fn().mockResolvedValue({ data: [{ id: "api-1" }] }),
      listAll: vi.fn(),
      get: vi.fn(),
      groupBy: vi.fn(),
    };
    const dbRecords = {
      list: vi.fn().mockResolvedValue({ data: [{ id: "db-1" }] }),
    };

    const service = new ReadBackendService(
      resolver as never,
      apiSearch as never,
      apiRecords as never,
      { records: dbRecords as never },
      { agentMode: true },
    );
    const result = await service.list("people", { limit: 1 });

    expect(dbRecords.list).toHaveBeenCalledWith(target, "people", { limit: 1 });
    expect(apiRecords.list).not.toHaveBeenCalled();
    expect(result).toEqual({ data: [{ id: "db-1" }] });
  });

  it("uses DB records reads when read source is strict db", async () => {
    const target = {
      mode: "db",
      source: "env",
      workspace: "ws",
      databaseUrl: "postgresql://db.example.com:5432/twenty",
    };
    const resolver = {
      resolve: vi.fn().mockResolvedValue(target),
    };
    const apiSearch = {
      search: vi.fn(),
    };
    const apiRecords = {
      list: vi.fn(),
      listAll: vi.fn(),
      get: vi.fn(),
      groupBy: vi.fn(),
    };
    const dbRecords = {
      list: vi.fn().mockResolvedValue({ data: [{ id: "db-1" }] }),
    };

    const service = new ReadBackendService(
      resolver as never,
      apiSearch as never,
      apiRecords as never,
      { records: dbRecords as never },
      { readSource: "db" },
    );
    const result = await service.list("people", { limit: 1 });

    expect(dbRecords.list).toHaveBeenCalledWith(target, "people", { limit: 1 });
    expect(apiRecords.list).not.toHaveBeenCalled();
    expect(result).toEqual({ data: [{ id: "db-1" }] });
  });

  it("auto routes records DB-first when a DB target resolves", async () => {
    const target = {
      mode: "db",
      source: "env",
      workspace: "ws",
      databaseUrl: "postgresql://db.example.com:5432/twenty",
    };
    const resolver = {
      resolve: vi.fn().mockResolvedValue(target),
    };
    const apiSearch = {
      search: vi.fn(),
    };
    const apiRecords = {
      list: vi.fn().mockResolvedValue({ data: [{ id: "api-1" }] }),
      listAll: vi.fn(),
      get: vi.fn(),
      groupBy: vi.fn(),
    };
    const dbRecords = {
      list: vi.fn().mockResolvedValue({ data: [{ id: "db-1" }] }),
    };

    const service = new ReadBackendService(
      resolver as never,
      apiSearch as never,
      apiRecords as never,
      { records: dbRecords as never },
    );
    const result = await service.list("people", { limit: 1 });

    expect(dbRecords.list).toHaveBeenCalledWith(target, "people", { limit: 1 });
    expect(apiRecords.list).not.toHaveBeenCalled();
    expect(result).toEqual({ data: [{ id: "db-1" }] });
  });

  it("auto falls back to API records reads on a recoverable DB error", async () => {
    const dbError = new DbConnectionError("schema drift", {
      cause: Object.assign(new Error("undefined column"), { code: "42703" }),
    });
    const target = {
      mode: "db",
      source: "env",
      workspace: "ws",
      databaseUrl: "postgresql://db.example.com:5432/twenty",
    };
    const resolver = {
      resolve: vi.fn().mockResolvedValue(target),
    };
    const apiSearch = {
      search: vi.fn(),
    };
    const apiRecords = {
      list: vi.fn().mockResolvedValue({ data: [{ id: "api-1" }] }),
      listAll: vi.fn(),
      get: vi.fn(),
      groupBy: vi.fn(),
    };
    const dbRecords = {
      list: vi.fn().mockRejectedValue(dbError),
    };

    const service = new ReadBackendService(
      resolver as never,
      apiSearch as never,
      apiRecords as never,
      { records: dbRecords as never },
    );
    const result = await service.list("people", { limit: 1 });

    expect(dbRecords.list).toHaveBeenCalledWith(target, "people", { limit: 1 });
    expect(apiRecords.list).toHaveBeenCalledWith("people", { limit: 1 });
    expect(result).toEqual({ data: [{ id: "api-1" }] });
  });

  it("records fallback details and marks api on a recoverable DB error", async () => {
    const tracker = new SourceTracker();
    const dbError = new DbConnectionError("schema drift", {
      cause: Object.assign(new Error("undefined column"), { code: "42703" }),
    });
    const target = {
      mode: "db",
      source: "env",
      workspace: "ws",
      databaseUrl: "postgresql://db.example.com:5432/twenty",
    };
    const resolver = {
      resolve: vi.fn().mockResolvedValue(target),
    };
    const apiSearch = {
      search: vi.fn(),
    };
    const apiRecords = {
      list: vi.fn().mockResolvedValue({ data: [{ id: "api-1" }] }),
      listAll: vi.fn(),
      get: vi.fn(),
      groupBy: vi.fn(),
    };
    const dbRecords = {
      list: vi.fn().mockRejectedValue(dbError),
    };

    const service = new ReadBackendService(
      resolver as never,
      apiSearch as never,
      apiRecords as never,
      { records: dbRecords as never },
      { sourceTracker: tracker },
    );

    await service.list("people", { limit: 1 });

    expect(tracker.outputSource()).toBe("api");
    expect(tracker.lastFallbackReason).toContain("42703");
  });

  it("auto rethrows fatal DB errors without falling back", async () => {
    const dbError = new DbConnectionError("fatal db error", {
      cause: Object.assign(new Error("unique violation"), { code: "23505" }),
    });
    const target = {
      mode: "db",
      source: "env",
      workspace: "ws",
      databaseUrl: "postgresql://db.example.com:5432/twenty",
    };
    const resolver = {
      resolve: vi.fn().mockResolvedValue(target),
    };
    const apiSearch = {
      search: vi.fn(),
    };
    const apiRecords = {
      list: vi.fn().mockResolvedValue({ data: [{ id: "api-1" }] }),
      listAll: vi.fn(),
      get: vi.fn(),
      groupBy: vi.fn(),
    };
    const dbRecords = {
      list: vi.fn().mockRejectedValue(dbError),
    };

    const service = new ReadBackendService(
      resolver as never,
      apiSearch as never,
      apiRecords as never,
      { records: dbRecords as never },
    );

    await expect(service.list("people", { limit: 1 })).rejects.toBe(dbError);
    expect(apiRecords.list).not.toHaveBeenCalled();
  });

  it("does not fall back to API records reads when read source is strict db", async () => {
    const dbError = new UnsupportedDbReadError("unsupported include");
    const target = {
      mode: "db",
      source: "profile",
      workspace: "ws",
      databaseUrl: "postgresql://db.example.com:5432/twenty",
      profileName: "readonly",
    };
    const resolver = {
      resolve: vi.fn().mockResolvedValue(target),
    };
    const apiSearch = {
      search: vi.fn(),
    };
    const apiRecords = {
      list: vi.fn().mockResolvedValue({ data: [{ id: "api-1" }] }),
      listAll: vi.fn(),
      get: vi.fn(),
      groupBy: vi.fn(),
    };
    const dbRecords = {
      list: vi.fn().mockRejectedValue(dbError),
    };

    const service = new ReadBackendService(
      resolver as never,
      apiSearch as never,
      apiRecords as never,
      { records: dbRecords as never },
      { readSource: "db" },
    );
    await expect(service.list("people", { include: "company" })).rejects.toBe(dbError);

    expect(dbRecords.list).toHaveBeenCalledWith(target, "people", { include: "company" });
    expect(apiRecords.list).not.toHaveBeenCalled();
  });
});
