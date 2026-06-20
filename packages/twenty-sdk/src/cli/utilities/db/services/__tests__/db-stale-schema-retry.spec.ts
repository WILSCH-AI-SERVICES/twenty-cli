import { describe, expect, it, vi } from "vitest";

import { withStaleSchemaRetry } from "../db-stale-schema-retry";

describe("withStaleSchemaRetry", () => {
  it("returns the result on success", async () => {
    const result = await withStaleSchemaRetry({ resetMemo: vi.fn(), clearDisk: vi.fn() }, () =>
      Promise.resolve(42),
    );
    expect(result).toBe(42);
  });

  it("on 42703 flushes caches and retries once", async () => {
    const resetMemo = vi.fn();
    const clearDisk = vi.fn().mockResolvedValue(undefined);
    let attempt = 0;
    const result = await withStaleSchemaRetry({ resetMemo, clearDisk }, async () => {
      attempt += 1;
      if (attempt === 1) {
        const err = new Error("column missing") as Error & { code?: string };
        err.code = "42703";
        throw err;
      }
      return "ok";
    });
    expect(result).toBe("ok");
    expect(resetMemo).toHaveBeenCalledTimes(1);
    expect(clearDisk).toHaveBeenCalledWith({ kind: "metadata-objects" });
    expect(attempt).toBe(2);
  });

  it("on 42P01 flushes caches and retries once", async () => {
    let attempt = 0;
    const result = await withStaleSchemaRetry(
      { resetMemo: vi.fn(), clearDisk: vi.fn().mockResolvedValue(undefined) },
      async () => {
        attempt += 1;
        if (attempt === 1) {
          const err = new Error("relation missing") as Error & { code?: string };
          err.code = "42P01";
          throw err;
        }
        return "ok";
      },
    );
    expect(result).toBe("ok");
    expect(attempt).toBe(2);
  });

  it("retries when stale code is on error.cause", async () => {
    let attempt = 0;
    const result = await withStaleSchemaRetry(
      { resetMemo: vi.fn(), clearDisk: vi.fn().mockResolvedValue(undefined) },
      async () => {
        attempt += 1;
        if (attempt === 1) {
          const cause = Object.assign(new Error("inner"), { code: "42703" });
          const wrapped = new Error("wrapped") as Error & { cause?: unknown };
          wrapped.cause = cause;
          throw wrapped;
        }
        return "ok";
      },
    );
    expect(result).toBe("ok");
    expect(attempt).toBe(2);
  });

  it("does not retry beyond once", async () => {
    const fn = vi.fn().mockRejectedValue(Object.assign(new Error("nope"), { code: "42P01" }));
    await expect(
      withStaleSchemaRetry(
        { resetMemo: vi.fn(), clearDisk: vi.fn().mockResolvedValue(undefined) },
        fn,
      ),
    ).rejects.toMatchObject({ code: "42P01" });
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("does not retry on unrelated errors", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("network down"));
    await expect(
      withStaleSchemaRetry({ resetMemo: vi.fn(), clearDisk: vi.fn() }, fn),
    ).rejects.toThrow("network down");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("proactively clears caches before the read when the schema version probe changes", async () => {
    const resetMemo = vi.fn();
    const clearDisk = vi.fn().mockResolvedValue(undefined);
    const fn = vi.fn().mockResolvedValue("ok");

    const result = await withStaleSchemaRetry(
      {
        resetMemo,
        clearDisk,
        readDiskSchemaVersion: vi.fn().mockResolvedValue("version-1"),
        writeDiskSchemaVersion: vi.fn().mockResolvedValue(undefined),
        probeLiveSchemaVersion: vi.fn().mockResolvedValue("version-2"),
      },
      fn,
    );

    expect(result).toBe("ok");
    expect(resetMemo).toHaveBeenCalledTimes(1);
    expect(clearDisk).toHaveBeenCalledWith({ kind: "metadata-objects" });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("keeps the cached metadata snapshot when the schema version probe is unchanged", async () => {
    const resetMemo = vi.fn();
    const clearDisk = vi.fn().mockResolvedValue(undefined);
    const fn = vi.fn().mockResolvedValue("ok");

    await withStaleSchemaRetry(
      {
        resetMemo,
        clearDisk,
        readDiskSchemaVersion: vi.fn().mockResolvedValue("version-1"),
        writeDiskSchemaVersion: vi.fn().mockResolvedValue(undefined),
        probeLiveSchemaVersion: vi.fn().mockResolvedValue("version-1"),
      },
      fn,
    );

    expect(resetMemo).not.toHaveBeenCalled();
    expect(clearDisk).not.toHaveBeenCalled();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("stores the first live schema version when the cached metadata has no probe", async () => {
    const writeDiskSchemaVersion = vi.fn().mockResolvedValue(undefined);

    await withStaleSchemaRetry(
      {
        resetMemo: vi.fn(),
        clearDisk: vi.fn(),
        readDiskSchemaVersion: vi.fn().mockResolvedValue(undefined),
        writeDiskSchemaVersion,
        probeLiveSchemaVersion: vi.fn().mockResolvedValue("version-1"),
      },
      () => Promise.resolve("ok"),
    );

    expect(writeDiskSchemaVersion).toHaveBeenCalledWith({ kind: "metadata-objects" }, "version-1");
  });
});
