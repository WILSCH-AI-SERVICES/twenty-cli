import { CliError } from "../../../utilities/errors/cli-error";
import { readJsonInput } from "../../../utilities/shared/io";
import { parseKeyValuePairs } from "../../../utilities/shared/parse";
import { ApiOperationContext } from "./types";

export async function runGroupByOperation(ctx: ApiOperationContext): Promise<void> {
  let payload: unknown | undefined;
  const params = parseKeyValuePairs(ctx.options.param);

  if (ctx.options.data || ctx.options.file) {
    const rawPayload = await readJsonInput(ctx.options.data, ctx.options.file);
    payload = normalizeGroupByPayload(rawPayload);
  } else if (ctx.options.field) {
    payload = { groupBy: [{ [ctx.options.field]: true }] };
  }

  if (ctx.options.filter) {
    payload = mergeGroupByFilter(payload, ctx.options.filter);
  }

  const normalized = normalizeGroupByAggregate(payload, params);

  const response = await ctx.services.records.groupBy(
    ctx.object,
    normalized.payload,
    Object.keys(normalized.params).length ? normalized.params : undefined,
  );
  await ctx.services.output.render(response, {
    format: ctx.globalOptions.output,
    query: ctx.globalOptions.query,
  });
}

function normalizeGroupByPayload(payload: unknown): unknown {
  if (Array.isArray(payload)) {
    return { groupBy: payload };
  }

  if (typeof payload !== "object" || payload === null) {
    return payload;
  }

  const record = payload as Record<string, unknown>;
  if (typeof record.groupBy === "string") {
    return {
      ...record,
      groupBy: [{ [record.groupBy]: true }],
    };
  }

  return payload;
}

function mergeGroupByFilter(payload: unknown, filter: string): unknown {
  if (payload == null) {
    return { filter };
  }

  if (typeof payload !== "object" || Array.isArray(payload)) {
    return payload;
  }

  const record = payload as Record<string, unknown>;
  if (record.filter === undefined) {
    return {
      ...record,
      filter,
    };
  }

  return payload;
}

export function normalizeGroupByAggregate(
  payload: unknown,
  params: Record<string, string[]>,
): { payload: unknown; params: Record<string, string[]> } {
  const nextParams: Record<string, string[]> = { ...params };
  let nextPayload = payload;

  const payloadRecord =
    payload && typeof payload === "object" && !Array.isArray(payload)
      ? { ...(payload as Record<string, unknown>) }
      : undefined;

  const payloadAggregate = payloadRecord?.aggregate;

  if (payloadRecord && payloadAggregate !== undefined) {
    nextPayload = { ...payloadRecord };
    delete (nextPayload as Record<string, unknown>).aggregate;
    nextParams.aggregate = [JSON.stringify(normalizeAggregateEntries(payloadAggregate))];
  }

  if (nextParams.aggregate && nextParams.aggregate.length > 0) {
    nextParams.aggregate = [JSON.stringify(normalizeAggregateEntries(nextParams.aggregate))];
  }

  return { payload: nextPayload, params: nextParams };
}

function normalizeAggregateEntries(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.flatMap((entry) => normalizeAggregateEntries(entry));
  }

  if (typeof raw !== "string") {
    throw new CliError(
      `Invalid aggregate ${JSON.stringify(raw)} (expected string or string array).`,
      "INVALID_ARGUMENTS",
    );
  }

  const trimmed = raw.trim();

  if (!trimmed) {
    throw new CliError('Invalid aggregate "" (expected non-empty value).', "INVALID_ARGUMENTS");
  }

  if (trimmed.startsWith("[")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      throw new CliError(
        `Invalid aggregate ${JSON.stringify(raw)} (expected JSON string array).`,
        "INVALID_ARGUMENTS",
      );
    }

    if (!Array.isArray(parsed) || parsed.some((entry) => typeof entry !== "string")) {
      throw new CliError(
        `Invalid aggregate ${JSON.stringify(raw)} (expected JSON string array).`,
        "INVALID_ARGUMENTS",
      );
    }

    return parsed.map((entry) => normalizeAggregateAlias(entry));
  }

  return [normalizeAggregateAlias(trimmed)];
}

function normalizeAggregateAlias(value: string): string {
  return value === "totalCount" ? "countNotEmptyId" : value;
}
