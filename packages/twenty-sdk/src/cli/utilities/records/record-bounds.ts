import { CliError } from "../errors/cli-error";

export const DEFAULT_ALL_PAGE_SIZE = 200;
export const MAX_ALL_PAGE_SIZE = 500;
export const DEFAULT_LIST_MAX_RECORDS = 10_000;
export const DEFAULT_FILE_EXPORT_MAX_RECORDS = 100_000;
export const MAX_EXPLICIT_RECORDS = 1_000_000;
export const DEFAULT_BATCH_UPDATE_CONCURRENCY = 4;
export const MAX_BATCH_UPDATE_CONCURRENCY = 10;

export function parseRecordPageSize(
  value: string | undefined,
  defaultValue?: number,
): number | undefined {
  if (value === undefined) {
    return defaultValue;
  }

  return parseBoundedInteger(value, "--limit", 1, MAX_ALL_PAGE_SIZE);
}

export function parseMaxRecords(value: string | undefined, defaultValue: number): number {
  if (value === undefined) {
    return defaultValue;
  }

  return parseBoundedInteger(value, "--max-records", 1, MAX_EXPLICIT_RECORDS);
}

export function parseBatchUpdateConcurrency(value: string | undefined): number {
  if (value === undefined) {
    return DEFAULT_BATCH_UPDATE_CONCURRENCY;
  }

  return parseBoundedInteger(value, "--concurrency", 1, MAX_BATCH_UPDATE_CONCURRENCY);
}

function parseBoundedInteger(value: string, optionName: string, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new CliError(
      `${optionName} must be an integer between ${min} and ${max}.`,
      "INVALID_ARGUMENTS",
    );
  }

  return parsed;
}
