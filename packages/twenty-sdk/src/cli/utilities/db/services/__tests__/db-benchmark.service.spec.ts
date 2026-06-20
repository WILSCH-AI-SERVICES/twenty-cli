import { describe, expect, it, vi } from "vitest";

import {
  DbBenchmarkService,
  computeTimingFromSamples,
  getDefaultBenchmarkOptions,
} from "../db-benchmark.service";

describe("getDefaultBenchmarkOptions", () => {
  it("default options use 30 iterations and 3 warmup", () => {
    const defaults = getDefaultBenchmarkOptions();
    expect(defaults.iterations).toBe(30);
    expect(defaults.warmup).toBe(3);
  });
});

describe("computeTimingFromSamples", () => {
  it("computes p50, p95, p99 from samplesMs", () => {
    const samples = Array.from({ length: 100 }, (_, index) => index + 1);
    const timing = computeTimingFromSamples(samples);
    expect(timing.p50Ms).toBe(51);
    expect(timing.p95Ms).toBe(96);
    expect(timing.p99Ms).toBe(100);
  });

  it("aliases medianMs to p50Ms", () => {
    const timing = computeTimingFromSamples([10, 20, 30, 40, 50]);
    expect(timing.medianMs).toBe(timing.p50Ms);
  });

  it("captures min, max, and the original samples", () => {
    const samples = [9, 1, 5, 3, 7];
    const timing = computeTimingFromSamples(samples);
    expect(timing.minMs).toBe(1);
    expect(timing.maxMs).toBe(9);
    expect(timing.samplesMs).toEqual(samples);
  });
});

describe("DbBenchmarkService", () => {
  it("runs strict api and db variants", async () => {
    const calls: string[][] = [];
    const service = new DbBenchmarkService({
      run: vi.fn(async (args: string[]) => {
        calls.push(args);
        return { data: [{ id: "1" }] };
      }),
    });

    const result = await service.run({
      iterations: 2,
      warmup: 1,
      operationKeys: ["api-list"],
      fixture: { object: "people" },
    });

    expect(result.operations[0]).toMatchObject({ key: "api-list", status: "ok" });
    expect(calls.some((args) => args.includes("--rs") && args.includes("api"))).toBe(true);
    expect(calls.some((args) => args.includes("--rs") && args.includes("db"))).toBe(true);
  });

  it("skips operations with missing fixtures", async () => {
    const service = new DbBenchmarkService({ run: vi.fn() });

    const result = await service.run({
      iterations: 1,
      warmup: 0,
      operationKeys: ["api-get"],
      fixture: { object: "people" },
    });

    expect(result.operations[0]).toMatchObject({
      key: "api-get",
      status: "skipped",
      skipReason: "Missing fixture: recordId",
    });
  });

  it("redacts database URLs from failed operation errors", async () => {
    const service = new DbBenchmarkService({
      run: vi
        .fn()
        .mockRejectedValue(new Error("failed postgresql://reader:secret@db.example.com/twenty")),
    });

    const result = await service.run({
      iterations: 1,
      warmup: 0,
      operationKeys: ["api-list"],
      fixture: { object: "people" },
    });

    expect(result.operations[0]).toMatchObject({
      status: "failed",
      error: "failed postgresql://reader:***@db.example.com/twenty",
    });
  });

  it("captures one cold sample (no warmup) plus the warm batch", async () => {
    const runner = { run: vi.fn().mockResolvedValue({ data: [{ id: "1" }] }) };
    const service = new DbBenchmarkService(runner);

    const result = await service.run({
      iterations: 5,
      warmup: 2,
      operationKeys: ["api-list"],
      fixture: { object: "people" },
    });

    const op = result.operations[0];
    expect(op?.status).toBe("ok");
    expect(op?.api?.coldMs).toBeTypeOf("number");
    expect(op?.api?.coldMs).toBeGreaterThanOrEqual(0);
    expect(op?.db?.coldMs).toBeTypeOf("number");
    expect(op?.api?.samplesMs).toHaveLength(5);
    expect(op?.db?.samplesMs).toHaveLength(5);
    // 1 cold + 2 warmup + 5 measured per source × 2 sources = 16 calls.
    expect(runner.run).toHaveBeenCalledTimes(16);
  });

  it("emits dbToApiRatio = db / api with p-values on each timing", async () => {
    const service = new DbBenchmarkService({
      run: vi.fn(async () => ({ data: [{ id: "1" }] })),
    });

    const result = await service.run({
      iterations: 3,
      warmup: 0,
      operationKeys: ["api-list"],
      fixture: { object: "people" },
    });

    const op = result.operations[0];
    expect(op?.status).toBe("ok");
    expect(op?.dbToApiRatio).toBeTypeOf("number");
    expect(op?.api?.p50Ms).toBeTypeOf("number");
    expect(op?.api?.p95Ms).toBeTypeOf("number");
    expect(op?.api?.p99Ms).toBeTypeOf("number");
    expect(op?.db?.p50Ms).toBeTypeOf("number");
    expect(op).not.toHaveProperty("speedup");
    if (op?.api && op.db) {
      expect(op.dbToApiRatio).toBeCloseTo(op.db.medianMs / op.api.medianMs, 5);
    }
  });

  it("rejects unknown operation keys", async () => {
    const service = new DbBenchmarkService({ run: vi.fn() });

    await expect(
      service.run({
        iterations: 1,
        warmup: 0,
        operationKeys: ["typo"],
        fixture: { object: "people" },
      }),
    ).rejects.toThrow('Unknown benchmark operation "typo".');
  });
});
