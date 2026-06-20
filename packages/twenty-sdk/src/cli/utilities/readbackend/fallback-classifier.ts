import { UnsupportedDbReadError } from "./types";

const RECOVERABLE_EXACT = new Set([
  "53300",
  "57014",
  "57P01",
  "57P02",
  "57P03",
  "42501",
  "42703",
  "42704",
  "42804",
  "42883",
  "42P01",
]);

const RECOVERABLE_PREFIX = ["08", "28", "57"];
const SCAN_SHAPE = /can(?:no|')t scan|cannot scan/i;

export function extractSqlState(error: unknown): string | undefined {
  const candidate = error as { code?: unknown; cause?: { code?: unknown } } | null;
  if (candidate && typeof candidate.code === "string") return candidate.code;
  if (candidate?.cause && typeof candidate.cause.code === "string") return candidate.cause.code;
  return undefined;
}

export function shouldFallbackToApi(error: unknown): boolean {
  if (error instanceof UnsupportedDbReadError) return true;

  const code = extractSqlState(error);
  if (code) {
    if (RECOVERABLE_EXACT.has(code)) return true;
    if (RECOVERABLE_PREFIX.some((prefix) => code.startsWith(prefix))) return true;
  }

  const message = error instanceof Error ? error.message : String(error ?? "");
  return SCAN_SHAPE.test(message);
}
