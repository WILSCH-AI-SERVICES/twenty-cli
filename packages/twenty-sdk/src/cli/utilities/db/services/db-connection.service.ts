import { Pool, type PoolClient } from "pg";

export interface DbConnectionOptions {
  databaseUrl: string;
}

type VerifiedPoolConfig = ConstructorParameters<typeof Pool>[0] & {
  verify?: (client: PoolClient, callback: (error?: Error) => void) => void;
};

export class DbConnectionService {
  private pool: Pool | undefined;
  private boundUrl: string | undefined;
  private closed = false;

  static resolveStatementTimeoutMs(): number {
    const raw = process.env.TWENTY_DB_STATEMENT_TIMEOUT;
    if (!raw) return 5000;
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed < 100 || parsed > 120_000) return 5000;
    return parsed;
  }

  async withClient<T>(
    options: DbConnectionOptions,
    fn: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    if (this.closed) {
      throw new Error("DbConnectionService is closed");
    }
    const pool = this.ensurePool(options);
    const client = await pool.connect();
    try {
      return await fn(client);
    } finally {
      client.release();
    }
  }

  async ping(client: Pick<PoolClient, "query">): Promise<{ ok: true }> {
    await client.query("select 1");
    return { ok: true };
  }

  async close(): Promise<void> {
    this.closed = true;
    const pool = this.pool;
    this.pool = undefined;
    if (pool) {
      await pool.end();
    }
  }

  private ensurePool(options: DbConnectionOptions): Pool {
    if (this.pool && this.boundUrl === options.databaseUrl) {
      return this.pool;
    }
    if (this.pool) {
      throw new Error(
        "DbConnectionService is already bound to a different databaseUrl; create a new instance",
      );
    }
    const url = new URL(options.databaseUrl);
    const ssl =
      url.searchParams.get("sslmode") === "require" ? { rejectUnauthorized: false } : undefined;
    const max = resolvePoolMax();
    const statementTimeoutMs = DbConnectionService.resolveStatementTimeoutMs();
    const poolConfig: VerifiedPoolConfig = {
      connectionString: options.databaseUrl,
      ssl,
      max,
      idleTimeoutMillis: 1_000,
      allowExitOnIdle: true,
      verify: (client, callback) => {
        void (async () => {
          await client.query(`SET statement_timeout = ${statementTimeoutMs}`);
          await client.query("SET default_transaction_read_only = on");
        })().then(
          () => callback(undefined),
          (error: unknown) => callback(error instanceof Error ? error : new Error(String(error))),
        );
      },
    };
    this.pool = new Pool(poolConfig);
    // Swallow async pool errors; individual queries surface their own errors via withClient.
    this.pool.on("error", () => undefined);
    this.boundUrl = options.databaseUrl;
    return this.pool;
  }
}

function resolvePoolMax(): number {
  const raw = process.env.TWENTY_DB_POOL_MAX;
  if (!raw) return 4;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed < 1 || parsed > 16) return 4;
  return parsed;
}
