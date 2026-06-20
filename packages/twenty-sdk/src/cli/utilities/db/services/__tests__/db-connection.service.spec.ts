import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";

import { DbConnectionService } from "../db-connection.service";

vi.mock("pg", () => {
  const release = vi.fn();
  const query = vi.fn().mockResolvedValue({ rows: [] });
  const end = vi.fn().mockResolvedValue(undefined);
  const connect = vi.fn().mockResolvedValue({ release, query });
  const Pool = vi.fn().mockImplementation(function (this: unknown, options: unknown) {
    Object.assign(this as object, { connect, end, on: vi.fn() });
    return Object.assign(this as object, { options });
  });
  return { Pool, __mocks: { release, query, end, connect } };
});

const { __mocks } = (await import("pg")) as unknown as {
  __mocks: { release: any; query: any; end: any; connect: any };
};

describe("DbConnectionService.withClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    delete process.env.TWENTY_DB_STATEMENT_TIMEOUT;
  });

  it("acquires a client, runs the callback, and releases", async () => {
    const service = new DbConnectionService();
    const result = await service.withClient(
      { databaseUrl: "postgres://u:p@localhost:5432/db" },
      async (client) => {
        await client.query("select 1");
        return 42;
      },
    );

    expect(result).toBe(42);
    expect(__mocks.connect).toHaveBeenCalledTimes(1);
    expect(__mocks.query).toHaveBeenCalledWith("select 1");
    expect(__mocks.release).toHaveBeenCalledTimes(1);
  });

  it("releases the client even if the callback throws", async () => {
    const service = new DbConnectionService();
    await expect(
      service.withClient({ databaseUrl: "postgres://u:p@localhost:5432/db" }, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(__mocks.release).toHaveBeenCalled();
  });

  it("reuses the same pool across calls with identical URL", async () => {
    const service = new DbConnectionService();
    const url = { databaseUrl: "postgres://u:p@localhost:5432/db" };
    await service.withClient(url, async () => undefined);
    await service.withClient(url, async () => undefined);

    const PoolMock = (await import("pg")).Pool as unknown as { mock: { calls: unknown[] } };
    expect(PoolMock.mock.calls).toHaveLength(1);
  });

  it("close() ends the pool", async () => {
    const service = new DbConnectionService();
    await service.withClient(
      { databaseUrl: "postgres://u:p@localhost:5432/db" },
      async () => undefined,
    );
    await service.close();
    expect(__mocks.end).toHaveBeenCalledTimes(1);
  });

  it("rejects withClient after close", async () => {
    const service = new DbConnectionService();
    await service.withClient(
      { databaseUrl: "postgres://u:p@localhost:5432/db" },
      async () => undefined,
    );
    await service.close();
    await expect(
      service.withClient(
        { databaseUrl: "postgres://u:p@localhost:5432/db" },
        async () => undefined,
      ),
    ).rejects.toThrow(/closed/i);
  });

  it("sets statement_timeout and read-only before serving each new connection", async () => {
    process.env.TWENTY_DB_STATEMENT_TIMEOUT = "5000";
    const service = new DbConnectionService();
    await service.withClient(
      { databaseUrl: "postgres://u:p@localhost:5432/db" },
      async () => undefined,
    );

    const PoolMock = (await import("pg")).Pool as unknown as {
      mock: { calls: Array<[Record<string, unknown>]> };
    };
    const verify = PoolMock.mock.calls[0]?.[0].verify;
    expect(verify).toBeTypeOf("function");

    const fakeClient = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    const callback = vi.fn();
    await new Promise<void>((resolve) => {
      (verify as (client: typeof fakeClient, cb: (error?: Error) => void) => void)(
        fakeClient,
        (error?: Error) => {
          callback(error);
          resolve();
        },
      );
    });

    expect(callback).toHaveBeenCalledWith(undefined);
    const sql = fakeClient.query.mock.calls.map((call) => String(call[0]));
    expect(sql.some((statement) => /statement_timeout\s*=\s*5000/i.test(statement))).toBe(true);
    expect(sql.some((statement) => /default_transaction_read_only\s*=\s*on/i.test(statement))).toBe(
      true,
    );
  });

  it("fails connection verification when a safety rail cannot be applied", async () => {
    const service = new DbConnectionService();
    await service.withClient(
      { databaseUrl: "postgres://u:p@localhost:5432/db" },
      async () => undefined,
    );

    const PoolMock = (await import("pg")).Pool as unknown as {
      mock: { calls: Array<[Record<string, unknown>]> };
    };
    const verify = PoolMock.mock.calls[0]?.[0].verify as
      | ((client: { query: ReturnType<typeof vi.fn> }, cb: (error?: Error) => void) => void)
      | undefined;
    expect(verify).toBeTypeOf("function");

    const setupError = new Error("permission denied");
    const fakeClient = { query: vi.fn().mockRejectedValue(setupError) };
    const callback = vi.fn();
    await new Promise<void>((resolve) => {
      verify?.(fakeClient, (error?: Error) => {
        callback(error);
        resolve();
      });
    });

    expect(callback).toHaveBeenCalledWith(setupError);
  });
});

describe("DbConnectionService.resolveStatementTimeoutMs", () => {
  const KEY = "TWENTY_DB_STATEMENT_TIMEOUT";

  afterEach(() => {
    delete process.env[KEY];
  });

  it("defaults to 5000ms when unset", () => {
    delete process.env[KEY];
    expect(DbConnectionService.resolveStatementTimeoutMs()).toBe(5000);
  });

  it("parses a valid integer", () => {
    process.env[KEY] = "2500";
    expect(DbConnectionService.resolveStatementTimeoutMs()).toBe(2500);
  });

  it("falls back to default on garbage or out-of-range values", () => {
    process.env[KEY] = "not-a-number";
    expect(DbConnectionService.resolveStatementTimeoutMs()).toBe(5000);

    process.env[KEY] = "-5";
    expect(DbConnectionService.resolveStatementTimeoutMs()).toBe(5000);
  });
});
