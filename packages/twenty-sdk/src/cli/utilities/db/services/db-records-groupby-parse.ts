import { UnsupportedDbReadError } from "../../readbackend/types";
import type { GroupByParams } from "../../records/services/api-records-read.service";

export interface SupportedDbGroupByRequest {
  fields: string[];
  aggregateField?: "countNotEmptyId";
  filter?: string;
  limit: number;
}

const DEFAULT_GROUP_BY_LIMIT = 50;

export function parseSupportedGroupByRequest(
  payload?: unknown,
  params?: GroupByParams,
): SupportedDbGroupByRequest {
  const payloadRecord = asRecord(payload);

  if (!payloadRecord) {
    throw new UnsupportedDbReadError("DB groupBy requires a payload with groupBy fields.");
  }

  assertSupportedGroupByPayloadKeys(payloadRecord);
  assertSupportedGroupByParamsKeys(params);

  const fields = parseGroupByFields(payloadRecord.groupBy);
  const payloadFilter = parseGroupByPayloadFilter(payloadRecord.filter);
  const paramsFilter = parseSingleStringParam(params, "filter");

  if (payloadFilter && paramsFilter) {
    throw new UnsupportedDbReadError("DB groupBy does not support both payload and param filters.");
  }

  return {
    fields,
    aggregateField: parseGroupByAggregate(params),
    filter: payloadFilter ?? paramsFilter,
    limit: parseGroupByLimit(params),
  };
}

function assertSupportedGroupByPayloadKeys(payload: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(payload)) {
    if (value === undefined) {
      continue;
    }

    if (key === "groupBy" || key === "filter") {
      continue;
    }

    throw new UnsupportedDbReadError(
      `DB groupBy does not support payload key ${JSON.stringify(key)}.`,
    );
  }
}

function assertSupportedGroupByParamsKeys(params?: GroupByParams): void {
  if (!params) {
    return;
  }

  for (const [key, value] of Object.entries(params)) {
    if (!Array.isArray(value) || value.length === 0) {
      continue;
    }

    if (key === "filter" || key === "limit" || key === "aggregate") {
      continue;
    }

    throw new UnsupportedDbReadError(`DB groupBy does not support param ${JSON.stringify(key)}.`);
  }
}

function parseGroupByFields(groupBy: unknown): string[] {
  if (!Array.isArray(groupBy) || groupBy.length === 0) {
    throw new UnsupportedDbReadError("DB groupBy requires a non-empty groupBy array.");
  }

  return groupBy.map((entry) => parseGroupByFieldEntry(entry));
}

function parseGroupByFieldEntry(entry: unknown): string {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    throw new UnsupportedDbReadError("DB groupBy only supports simple field entries.");
  }

  const fields = Object.entries(entry as Record<string, unknown>).filter(
    ([, value]) => value !== undefined,
  );

  if (fields.length !== 1) {
    throw new UnsupportedDbReadError("DB groupBy only supports one field per groupBy entry.");
  }

  const [fieldName, enabled] = fields[0]!;

  if (enabled !== true) {
    throw new UnsupportedDbReadError(
      `DB groupBy does not support advanced field definition for ${JSON.stringify(fieldName)}.`,
    );
  }

  return fieldName;
}

function parseGroupByPayloadFilter(filter: unknown): string | undefined {
  if (filter === undefined) {
    return undefined;
  }

  if (typeof filter !== "string") {
    throw new UnsupportedDbReadError("DB groupBy only supports string filters.");
  }

  return filter;
}

function parseGroupByAggregate(params?: GroupByParams): "countNotEmptyId" | undefined {
  const aggregate = parseSingleStringParam(params, "aggregate");

  if (aggregate === undefined) {
    return undefined;
  }

  const normalizedFields = normalizeAggregateFields(aggregate);

  if (normalizedFields.length !== 1 || normalizedFields[0] !== "countNotEmptyId") {
    throw new UnsupportedDbReadError(
      `DB groupBy only supports aggregate ${JSON.stringify("countNotEmptyId")}.`,
    );
  }

  return "countNotEmptyId";
}

function parseGroupByLimit(params?: GroupByParams): number {
  const rawLimit = parseSingleStringParam(params, "limit");

  if (rawLimit === undefined) {
    return DEFAULT_GROUP_BY_LIMIT;
  }

  if (!/^\d+$/.test(rawLimit)) {
    throw new UnsupportedDbReadError(
      `DB groupBy does not support limit ${JSON.stringify(rawLimit)}.`,
    );
  }

  const limit = Number(rawLimit);

  if (!Number.isFinite(limit) || limit < 1) {
    throw new UnsupportedDbReadError(
      `DB groupBy does not support limit ${JSON.stringify(rawLimit)}.`,
    );
  }

  return Math.floor(limit);
}

function parseSingleStringParam(
  params: GroupByParams | undefined,
  key: string,
): string | undefined {
  const values = params?.[key];

  if (!values || values.length === 0) {
    return undefined;
  }

  if (values.length !== 1) {
    throw new UnsupportedDbReadError(
      `DB groupBy does not support multiple values for ${JSON.stringify(key)}.`,
    );
  }

  return values[0];
}

function normalizeAggregateFields(raw: string): string[] {
  const trimmed = raw.trim();

  if (!trimmed) {
    return [];
  }

  if (trimmed === "totalCount") {
    return ["countNotEmptyId"];
  }

  if (!trimmed.startsWith("[")) {
    return [trimmed];
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new UnsupportedDbReadError(
      `DB groupBy could not parse aggregate ${JSON.stringify(raw)} as a JSON string array.`,
    );
  }

  if (!Array.isArray(parsed) || parsed.some((entry) => typeof entry !== "string")) {
    throw new UnsupportedDbReadError(
      `DB groupBy could not parse aggregate ${JSON.stringify(raw)} as a JSON string array.`,
    );
  }

  return parsed.map((entry) => (entry === "totalCount" ? "countNotEmptyId" : entry));
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  return value as Record<string, unknown>;
}
