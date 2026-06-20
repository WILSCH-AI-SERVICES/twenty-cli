import { Command } from "commander";

import { CliError } from "../errors/cli-error";
import { parseBatchUpdateConcurrency, parseRecordPageSize } from "../records/record-bounds";
import { parseArrayPayload, parseBody } from "../shared/body";
import { requireYes } from "../shared/confirmation";
import { createCommandContext } from "../shared/context";
import { readJsonInput } from "../shared/io";
import { mergeSets } from "../shared/parse";
import type {
  DynamicMetadataOperation,
  DynamicRecordOperation,
} from "./schema-command-materializer";

interface DynamicCommandOptions {
  limit?: string;
  cursor?: string;
  filter?: string;
  sort?: string;
  order?: string;
  include?: string;
  data?: string;
  file?: string;
  set?: string[];
  ids?: string;
  field?: string;
  object?: string;
  view?: string;
  yes?: boolean;
  totalCount?: boolean;
  concurrency?: string;
}

interface DynamicRecordsService {
  batchUpdate(
    object: string,
    records: Record<string, unknown>[],
    options?: { concurrency?: number },
  ): Promise<unknown>;
  updateMany(
    object: string,
    data: Record<string, unknown>,
    options: { filter: string },
  ): Promise<unknown>;
}

export async function runRecordOperation(
  command: Command,
  object: string,
  operation: DynamicRecordOperation,
  id: string | undefined,
): Promise<void> {
  const { globalOptions, services } = await createCommandContext(command);
  const options = command.opts() as DynamicCommandOptions;
  let result: unknown;

  switch (operation) {
    case "list":
      result = await services.records.list(object, buildListOptions(options));
      break;
    case "get":
      assertId(id, "record");
      result = await services.records.get(object, id, { include: options.include });
      break;
    case "create":
      result = await services.records.create(
        object,
        await parseBody(options.data, options.file, options.set),
      );
      break;
    case "update":
      assertId(id, "record");
      result = await services.records.update(
        object,
        id,
        await parseBody(options.data, options.file, options.set),
      );
      break;
    case "delete":
      assertId(id, "record");
      requireYes(options, "Delete");
      result = await services.records.delete(object, id);
      break;
    case "destroy":
      if (id) {
        requireYes(options, "Destroy");
        result = await services.records.destroy(object, id);
      } else {
        const filter = resolveBulkFilter(options);
        requireYes(options, "Destroy");
        result = await services.records.destroyMany(object, { filter });
      }
      break;
    case "restore":
      if (id) {
        result = await services.records.restore(object, id);
      } else {
        result = await services.records.restoreMany(object, { filter: resolveBulkFilter(options) });
      }
      break;
    case "batch-create":
      result = await services.records.batchCreate(
        object,
        (await parseArrayPayload(options.data, options.file)) as Record<string, unknown>[],
      );
      break;
    case "batch-update":
      result = await runBatchUpdate(object, options, services.records);
      break;
    case "batch-delete":
      requireYes(options, "Batch delete");
      result = await services.records.batchDelete(object, await parseBatchDeleteIds(options));
      break;
    case "group-by":
      result = await services.records.groupBy(object, await buildGroupByPayload(options));
      break;
    case "find-duplicates":
      result = await services.records.findDuplicates(
        object,
        await parseBody(options.data, options.file, options.set),
      );
      break;
    case "merge":
      result = await services.records.merge(
        object,
        await parseBody(options.data, options.file, options.set),
      );
      break;
  }

  await services.output.render(result, {
    format: globalOptions.output,
    query: globalOptions.query,
  });
}

export async function runMetadataOperation(
  command: Command,
  resource: string,
  operation: DynamicMetadataOperation,
  id: string | undefined,
): Promise<void> {
  const { globalOptions, services } = await createCommandContext(command);
  const options = command.opts() as DynamicCommandOptions;
  const basePath = `/rest/metadata/${resource}`;
  let result: unknown;

  switch (operation) {
    case "list":
      result = (await services.api.get(basePath, { params: metadataQueryParams(options) })).data;
      break;
    case "get":
      assertId(id, "metadata resource");
      result = (await services.api.get(`${basePath}/${id}`)).data;
      break;
    case "create":
      result = (
        await services.api.post(basePath, await parseBody(options.data, options.file, options.set))
      ).data;
      break;
    case "update":
      assertId(id, "metadata resource");
      result = (
        await services.api.patch(
          `${basePath}/${id}`,
          await parseBody(options.data, options.file, options.set),
        )
      ).data;
      break;
    case "delete":
      assertId(id, "metadata resource");
      result = (await services.api.delete(`${basePath}/${id}`)).data;
      break;
  }

  await services.output.render(result ?? null, {
    format: globalOptions.output,
    query: globalOptions.query,
  });
}

function buildListOptions(
  options: DynamicCommandOptions,
): Record<string, string | number | boolean | undefined> {
  return {
    limit: parseRecordPageSize(options.limit),
    cursor: options.cursor,
    filter: options.filter,
    sort: options.sort,
    order: options.order,
    totalCount: options.totalCount === true ? true : undefined,
  };
}

async function runBatchUpdate(
  object: string,
  options: DynamicCommandOptions,
  records: DynamicRecordsService,
): Promise<unknown> {
  const rawPayload = await readJsonInput(options.data, options.file);
  const concurrency = parseBatchUpdateConcurrency(options.concurrency);

  if (Array.isArray(rawPayload) && !options.set?.length) {
    return records.batchUpdate(object, rawPayload as Record<string, unknown>[], { concurrency });
  }

  return records.updateMany(object, requireObjectPayload(rawPayload, options.set), {
    filter: resolveBulkFilter(options),
  });
}

function requireObjectPayload(
  payload: unknown | undefined,
  sets: string[] | undefined,
): Record<string, unknown> {
  const merged = mergeOptionalSets(payload, sets);
  if (merged == null) {
    throw new CliError("Missing JSON payload; use --data, --file, or --set.", "INVALID_ARGUMENTS");
  }
  if (!isRecord(merged)) {
    throw new CliError("Payload must be a JSON object.", "INVALID_ARGUMENTS");
  }
  return merged;
}

async function parseBatchDeleteIds(options: DynamicCommandOptions): Promise<string[]> {
  const optionIds = parseOptionalIds(options.ids);
  if (optionIds.length > 0) return optionIds;

  const payload = await readJsonInput(options.data, options.file);
  if (payload == null) {
    throw new CliError("Missing JSON payload; use --data, --file, or --ids.", "INVALID_ARGUMENTS");
  }
  if (!Array.isArray(payload)) {
    throw new CliError("Batch payload must be a JSON array.", "INVALID_ARGUMENTS");
  }

  const ids = payload.map((value) => String(value).trim()).filter(Boolean);
  if (ids.length === 0) {
    throw new CliError("No valid IDs provided.", "INVALID_ARGUMENTS");
  }
  return ids;
}

function resolveBulkFilter(options: DynamicCommandOptions): string {
  if (options.filter?.trim()) {
    return options.filter.trim();
  }

  const ids = parseOptionalIds(options.ids);
  if (ids.length > 0) {
    return `id[in]:[${ids.join(",")}]`;
  }

  throw new CliError("Missing record ID.", "INVALID_ARGUMENTS");
}

async function buildGroupByPayload(options: DynamicCommandOptions): Promise<unknown> {
  const hasPayload = Boolean(options.data || options.file || options.set?.length);
  let payload: unknown | undefined;

  if (hasPayload) {
    const rawPayload = await readJsonInput(options.data, options.file);
    payload = normalizeGroupByPayload(mergeOptionalSets(rawPayload, options.set));
  } else if (options.field) {
    payload = { groupBy: [{ [options.field]: true }] };
  }

  if (options.filter) {
    payload = mergeGroupByFilter(payload, options.filter);
  }

  if (payload == null) {
    throw new CliError(
      "Missing group-by payload; use --field, --data, --file, or --set.",
      "INVALID_ARGUMENTS",
    );
  }

  return payload;
}

function mergeOptionalSets(payload: unknown | undefined, sets: string[] | undefined): unknown {
  if (!sets?.length) return payload;
  if (payload != null && (typeof payload !== "object" || Array.isArray(payload))) {
    throw new CliError("Payload must be a JSON object when using --set.", "INVALID_ARGUMENTS");
  }
  return mergeSets((payload ?? {}) as Record<string, unknown>, sets);
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
  if (record.filter !== undefined) {
    return payload;
  }

  return {
    ...record,
    filter,
  };
}

function metadataQueryParams(options: DynamicCommandOptions): Record<string, string> {
  return Object.fromEntries(
    Object.entries({
      object: options.object,
      view: options.view,
    }).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}

function assertId(id: string | undefined, label: string): asserts id is string {
  if (!id) throw new CliError(`Missing ${label} ID.`, "INVALID_ARGUMENTS");
}

function parseOptionalIds(value: string | undefined): string[] {
  return (
    value
      ?.split(",")
      .map((id) => id.trim())
      .filter(Boolean) ?? []
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
