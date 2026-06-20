import { performance } from "node:perf_hooks";

import { CliError } from "../../errors/cli-error";
import {
  BENCHMARK_OPERATIONS,
  type BenchmarkFixture,
  type BenchmarkOperation,
  type BenchmarkSource,
} from "./db-benchmark-operations";
import { redactDbSecrets } from "./db-secret-redaction.service";

export interface DbBenchmarkOptions {
  iterations: number;
  warmup: number;
  fixture: BenchmarkFixture;
  operationKeys?: string[];
}

export const DEFAULT_BENCHMARK_ITERATIONS = 30;
export const DEFAULT_BENCHMARK_WARMUP = 3;

export function getDefaultBenchmarkOptions(): {
  iterations: number;
  warmup: number;
} {
  return {
    iterations: DEFAULT_BENCHMARK_ITERATIONS,
    warmup: DEFAULT_BENCHMARK_WARMUP,
  };
}

export interface DbBenchmarkCommandRunner {
  run(args: string[]): Promise<unknown>;
}

export interface DbBenchmarkTiming {
  medianMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  minMs: number;
  maxMs: number;
  samplesMs: number[];
  coldMs?: number;
}

export interface DbBenchmarkOperationResult {
  key: string;
  label: string;
  status: "ok" | "skipped" | "failed";
  skipReason?: string;
  api?: DbBenchmarkTiming;
  db?: DbBenchmarkTiming;
  dbToApiRatio?: number;
  comparable?: boolean;
  error?: string;
}

export function computeTimingFromSamples(samples: number[]): DbBenchmarkTiming {
  const sorted = [...samples].sort((left, right) => left - right);
  const pick = (quantile: number): number => {
    if (sorted.length === 0) return 0;
    const index = Math.min(sorted.length - 1, Math.floor(sorted.length * quantile));
    return sorted[index] ?? 0;
  };
  const median = pick(0.5);
  return {
    medianMs: median,
    p50Ms: median,
    p95Ms: pick(0.95),
    p99Ms: pick(0.99),
    minMs: sorted[0] ?? 0,
    maxMs: sorted[sorted.length - 1] ?? 0,
    samplesMs: samples,
  };
}

export class DbBenchmarkService {
  constructor(private readonly runner: DbBenchmarkCommandRunner) {}

  async run(options: DbBenchmarkOptions): Promise<{ operations: DbBenchmarkOperationResult[] }> {
    const operations = selectOperations(options.operationKeys);
    const results: DbBenchmarkOperationResult[] = [];

    for (const operation of operations) {
      const missing = operation.requires.filter((key) => !options.fixture[key]);
      if (missing.length > 0) {
        results.push({
          key: operation.key,
          label: operation.label,
          status: "skipped",
          skipReason: `Missing fixture: ${missing.join(", ")}`,
        });
        continue;
      }

      try {
        const api = await this.measure(operation, "api", options);
        const db = await this.measure(operation, "db", options);
        results.push({
          key: operation.key,
          label: operation.label,
          status: "ok",
          api: api.timing,
          db: db.timing,
          dbToApiRatio: db.timing.medianMs / api.timing.medianMs,
          comparable: stableJson(api.lastResult) === stableJson(db.lastResult),
        });
      } catch (error) {
        results.push({
          key: operation.key,
          label: operation.label,
          status: "failed",
          error:
            redactDbSecrets(error instanceof Error ? error.message : undefined) ??
            "Benchmark operation failed.",
        });
      }
    }

    return { operations: results };
  }

  private async measure(
    operation: BenchmarkOperation,
    source: BenchmarkSource,
    options: DbBenchmarkOptions,
  ): Promise<{ timing: DbBenchmarkTiming; lastResult: unknown }> {
    const coldStartedAt = performance.now();
    let lastResult = await this.runner.run(operation.buildArgs(source, options.fixture));
    const coldMs = performance.now() - coldStartedAt;

    for (let index = 0; index < options.warmup; index += 1) {
      lastResult = await this.runner.run(operation.buildArgs(source, options.fixture));
    }

    const samplesMs: number[] = [];
    for (let index = 0; index < options.iterations; index += 1) {
      const startedAt = performance.now();
      lastResult = await this.runner.run(operation.buildArgs(source, options.fixture));
      samplesMs.push(performance.now() - startedAt);
    }

    return {
      lastResult,
      timing: { ...computeTimingFromSamples(samplesMs), coldMs },
    };
  }
}

function selectOperations(keys?: string[]): BenchmarkOperation[] {
  if (!keys || keys.length === 0) return BENCHMARK_OPERATIONS;
  const selected = new Set(keys);
  const validKeys = new Set(BENCHMARK_OPERATIONS.map((operation) => operation.key));
  const unknown = [...selected].filter((key) => !validKeys.has(key));
  if (unknown.length > 0) {
    throw new CliError(
      `Unknown benchmark operation "${unknown.join(", ")}". Valid operations: ${[...validKeys].join(
        ", ",
      )}.`,
      "INVALID_ARGUMENTS",
    );
  }
  return BENCHMARK_OPERATIONS.filter((operation) => selected.has(operation.key));
}

function stableJson(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, sortJson(child)]),
  );
}
