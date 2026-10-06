/**
 * The house's refusal, at the one surface every write leaves through
 * (DaveX2001/deliverable-tracking#3266).
 *
 * Every request the CLI sends to the instance passes `guardWrite` before it leaves the
 * machine (see `createHttpClient`). The guard reads the request for what it would write —
 * whichever route built it: the record commands and their batch, upsert, import and merge
 * forms (REST), `graphql` and `raw graphql` (a GraphQL document), `raw rest` (either), and
 * `mcp exec` (an MCP tool call) — and refuses, naming what is missing, any write that would
 * leave on the instance:
 *
 *   - a Task whose note is outside the one shape (`task-note.ts`), including a Task
 *     written with no note at all;
 *   - a Task done whose note does not end in its proof line, dated the day of the close;
 *   - an Opportunity at CLOSED_WON or CLOSED_LOST whose `whyStopped` carries no address,
 *     including one created already closed.
 *
 * The guard judges the record as it would stand after the write: an update that names only
 * some fields is merged with the stored record, read fresh before the write is sent. A
 * write it cannot judge one record at a time — a filter-wide update touching a guarded
 * field, a merge of Tasks or Opportunities — is refused outright, so that no route is left
 * where a malformed note or a bare close slips through unread.
 *
 * Out of reach here: writes the instance makes by itself (workflows, logic functions,
 * the mail sync). They do not leave through this tool, and the design names their
 * refusal as a later question (Twenty as the System of Record, Part 4).
 */
import { Kind, parse, valueFromASTUntyped, type DocumentNode, type ValueNode } from "graphql";

import { CliError } from "../errors/cli-error";
import { checkTaskNote, isAddress, todaysDayMonths } from "./task-note";

export type GuardedObject = "task" | "opportunity";

export type IntendedWrite =
  | { object: GuardedObject; kind: "create"; data: unknown; upsert: boolean }
  | { object: GuardedObject; kind: "update"; id: unknown; data: unknown }
  | { object: GuardedObject; kind: "updateMany"; data: unknown }
  | { object: GuardedObject; kind: "merge"; dryRun: boolean };

export interface OutgoingRequest {
  method?: string;
  url?: string;
  baseURL?: string;
  params?: unknown;
  data?: unknown;
}

/** Reads a record as stored, or undefined when there is none. */
export type StoredReader = (
  object: GuardedObject,
  id: string,
) => Promise<Record<string, unknown> | undefined>;

export const REFUSED = "REFUSED";

const CLOSED_STAGES = new Set(["CLOSED_WON", "CLOSED_LOST"]);
const WRITE_METHODS = new Set(["post", "put", "patch"]);

const OBJECT_BY_REST_NAME: Record<string, GuardedObject> = {
  task: "task",
  tasks: "task",
  opportunity: "opportunity",
  opportunities: "opportunity",
};

// ---------------------------------------------------------------------------------------
// Reading a request for what it writes
// ---------------------------------------------------------------------------------------

function asJson(data: unknown): unknown {
  if (typeof data !== "string") return data;
  try {
    return JSON.parse(data);
  } catch {
    return data;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function resolveUrl(request: OutgoingRequest): URL | undefined {
  const base = request.baseURL
    ? request.baseURL.replace(/\/+$/, "") + "/"
    : "http://local.invalid/";
  const raw = request.url ?? "";
  try {
    return /^[a-z][a-z0-9+.-]*:/i.test(raw) ? new URL(raw) : new URL(raw.replace(/^\/+/, ""), base);
  } catch {
    return undefined;
  }
}

function pathSegments(url: URL): string[] {
  let path = url.pathname;
  try {
    path = decodeURIComponent(path);
  } catch {
    // keep the raw path
  }
  return path
    .toLowerCase()
    .split("/")
    .filter((s) => s !== "");
}

function truthy(value: unknown): boolean {
  // `raw rest --param upsert=true` arrives as ["true"].
  if (Array.isArray(value)) return value.some(truthy);
  return value === true || (typeof value === "string" && value.toLowerCase() === "true");
}

function queryParam(request: OutgoingRequest, url: URL, name: string): unknown {
  if (isRecord(request.params) && name in request.params) return request.params[name];
  if (request.params instanceof URLSearchParams && request.params.has(name)) {
    return request.params.get(name);
  }
  return url.searchParams.get(name) ?? undefined;
}

/** REST: /rest[/core]/[batch/]<object>[/<id>|/merge|/duplicates]. */
function restWrites(
  request: OutgoingRequest,
  url: URL,
  method: string,
  body: unknown,
): IntendedWrite[] {
  const segments = pathSegments(url);
  const restAt = segments.indexOf("rest");
  if (restAt === -1) return [];
  let rest = segments.slice(restAt + 1);
  if (rest[0] === "core") rest = rest.slice(1);
  if (rest[0] === "restore") return [];

  const batch = rest[0] === "batch";
  if (batch) rest = rest.slice(1);
  const object = OBJECT_BY_REST_NAME[rest[0] ?? ""];
  if (!object) return [];

  const upsert = truthy(queryParam(request, url, "upsert"));
  const tail = rest.slice(1);

  if (tail.length === 0) {
    if (method === "post") {
      const items = Array.isArray(body)
        ? body
        : batch && isRecord(body) && Array.isArray(body.data)
          ? body.data
          : [body];
      return items.map((data) => ({ object, kind: "create", data, upsert }));
    }
    return [{ object, kind: "updateMany", data: body }];
  }
  if (tail[0] === "duplicates") return [];
  if (tail[0] === "merge") {
    return [{ object, kind: "merge", dryRun: isRecord(body) && truthy(body.dryRun) }];
  }
  if (method === "post") {
    // Not a route the instance offers; judged as a create so nothing passes unread.
    return [{ object, kind: "create", data: body, upsert }];
  }
  return [{ object, kind: "update", id: tail[0], data: body }];
}

const GRAPHQL_FIELD = /^(create|update|upsert|merge)(task|tasks|opportunity|opportunities)$/;

function graphqlWrites(document: string, variables: unknown): IntendedWrite[] {
  let ast: DocumentNode;
  try {
    ast = parse(document);
  } catch {
    // The instance parses with the same library and refuses a document this cannot parse.
    return [];
  }
  const provided = isRecord(variables) ? variables : {};
  let vars: Record<string, unknown> = provided;
  const writes: IntendedWrite[] = [];
  const fragments = new Map(
    ast.definitions
      .filter((d) => d.kind === Kind.FRAGMENT_DEFINITION)
      .map((d) => [(d as { name: { value: string } }).name.value, d]),
  );

  const visit = (selections: readonly unknown[], seen: Set<string>) => {
    for (const selection of selections as Array<{ kind: string; [k: string]: unknown }>) {
      if (selection.kind === Kind.FRAGMENT_SPREAD) {
        const name = (selection.name as { value: string }).value;
        const fragment = fragments.get(name) as
          | { selectionSet: { selections: unknown[] } }
          | undefined;
        if (fragment && !seen.has(name))
          visit(fragment.selectionSet.selections, new Set([...seen, name]));
        continue;
      }
      if (selection.kind === Kind.INLINE_FRAGMENT) {
        visit((selection.selectionSet as { selections: unknown[] }).selections, seen);
        continue;
      }
      if (selection.kind !== Kind.FIELD) continue;
      const fieldName = (selection.name as { value: string }).value;
      const match = fieldName.toLowerCase().match(GRAPHQL_FIELD);
      if (!match) continue;
      const args: Record<string, unknown> = {};
      for (const arg of (selection.arguments as Array<{
        name: { value: string };
        value: ValueNode;
      }>) ?? []) {
        args[arg.name.value] = valueFromASTUntyped(arg.value, vars);
      }
      const [, verb, noun] = match;
      const object: GuardedObject = noun!.startsWith("task") ? "task" : "opportunity";
      const many = noun === "tasks" || noun === "opportunities";
      if (verb === "merge") {
        writes.push({ object, kind: "merge", dryRun: truthy(args.dryRun) });
      } else if (verb === "create" || verb === "upsert") {
        const upsert = verb === "upsert" || truthy(args.upsert);
        const items = many && Array.isArray(args.data) ? args.data : [args.data];
        for (const data of items) writes.push({ object, kind: "create", data, upsert });
      } else if (many) {
        writes.push({ object, kind: "updateMany", data: args.data });
      } else {
        writes.push({ object, kind: "update", id: args.id, data: args.data });
      }
    }
  };

  for (const definition of ast.definitions) {
    if (definition.kind !== Kind.OPERATION_DEFINITION) continue;
    if (definition.operation !== "mutation") continue;
    // A variable left out of the request takes its declared default on the instance.
    vars = { ...provided };
    for (const variable of definition.variableDefinitions ?? []) {
      const name = variable.variable.name.value;
      if (!(name in vars) && variable.defaultValue) {
        vars[name] = valueFromASTUntyped(variable.defaultValue);
      }
    }
    visit(definition.selectionSet.selections, new Set());
  }
  return writes;
}

const MCP_TOOL =
  /^(create_one|create_many|update_one|update_many|upsert_many|upsert_one|merge_many)_(task|tasks|opportunity|opportunities)$/;

function mcpToolWrites(toolName: unknown, args: unknown): IntendedWrite[] {
  if (typeof toolName !== "string") return [];
  if (toolName === "execute_tool" && isRecord(args)) {
    return mcpToolWrites(args.toolName, args.arguments);
  }
  const match = toolName.toLowerCase().match(MCP_TOOL);
  if (!match) return [];
  const [, verb, noun] = match;
  const object: GuardedObject = noun!.startsWith("task") ? "task" : "opportunity";
  const a = isRecord(args) ? args : {};
  switch (verb) {
    case "create_one":
      return [{ object, kind: "create", data: a, upsert: false }];
    case "upsert_one":
      return [{ object, kind: "create", data: a, upsert: true }];
    case "create_many":
    case "upsert_many": {
      const records = Array.isArray(a.records) ? a.records : [undefined];
      return records.map((data) => ({
        object,
        kind: "create",
        data,
        upsert: verb === "upsert_many",
      }));
    }
    case "update_one": {
      const { id, ...data } = a;
      return [{ object, kind: "update", id, data }];
    }
    case "update_many":
      return [{ object, kind: "updateMany", data: a.data }];
    default:
      return [{ object, kind: "merge", dryRun: false }];
  }
}

function mcpWrites(body: unknown): IntendedWrite[] {
  const messages = Array.isArray(body) ? body : [body];
  return messages.flatMap((message) => {
    if (!isRecord(message) || message.method !== "tools/call" || !isRecord(message.params))
      return [];
    return mcpToolWrites(message.params.name, message.params.arguments);
  });
}

function graphqlBodyWrites(body: unknown): IntendedWrite[] {
  const payloads = Array.isArray(body) ? body : [body];
  return payloads.flatMap((payload) =>
    isRecord(payload) && typeof payload.query === "string"
      ? graphqlWrites(payload.query, asJson(payload.variables))
      : [],
  );
}

/** Every Task or Opportunity write `request` would make on the instance. */
export function intendedWrites(request: OutgoingRequest): IntendedWrite[] {
  const method = (request.method ?? "get").toLowerCase();
  if (!WRITE_METHODS.has(method)) return [];
  const url = resolveUrl(request);
  const body = asJson(request.data);
  const rest = url ? restWrites(request, url, method, body) : [];
  if (url && pathSegments(url).includes("rest")) return rest;
  return [...rest, ...graphqlBodyWrites(body), ...mcpWrites(body)];
}

// ---------------------------------------------------------------------------------------
// Judging the record as it would stand after the write
// ---------------------------------------------------------------------------------------

function noteOf(bodyV2: unknown): { markdown?: unknown; problem?: string } {
  if (bodyV2 === undefined || bodyV2 === null) return { markdown: undefined };
  if (!isRecord(bodyV2)) return { problem: "the note (bodyV2) is not an object with markdown" };
  if (bodyV2.blocknote !== undefined && bodyV2.blocknote !== null) {
    return {
      problem:
        "the note is written as blocknote — write it as bodyV2.markdown in the one shape, and the instance derives the blocknote from it",
    };
  }
  return { markdown: bodyV2.markdown };
}

function judgeTask(
  data: Record<string, unknown>,
  stored: Record<string, unknown> | undefined,
): string[] {
  const statusAfter = "status" in data ? data.status : stored ? stored.status : "TODO";
  const done = statusAfter === "DONE";
  const wasDone = stored?.status === "DONE";

  let markdown: unknown;
  if ("bodyV2" in data || !stored) {
    const note = noteOf(data.bodyV2);
    if (note.problem) return [note.problem];
    markdown = note.markdown;
  } else {
    // The note is not written; it is judged only when this write closes the Task.
    if (!done) return [];
    markdown = isRecord(stored.bodyV2) ? stored.bodyV2.markdown : undefined;
  }

  return checkTaskNote(markdown, {
    done,
    closingDates: done && !wasDone ? todaysDayMonths() : undefined,
  });
}

function judgeOpportunity(
  data: Record<string, unknown>,
  stored: Record<string, unknown> | undefined,
): string[] {
  const stageAfter = "stage" in data ? data.stage : stored?.stage;
  if (typeof stageAfter !== "string" || !CLOSED_STAGES.has(stageAfter)) return [];
  const whyStopped = "whyStopped" in data ? data.whyStopped : stored?.whyStopped;
  const url = isRecord(whyStopped) ? whyStopped.primaryLinkUrl : undefined;
  if (isAddress(url)) return [];
  return [
    `an Opportunity at ${stageAfter} must carry why it stopped progressing — whyStopped.primaryLinkUrl is ${
      url === undefined || url === null || url === ""
        ? "empty"
        : `"${String(url)}", not an http(s) URL`
    }; give the address of the mail or the recording moment that ended it`,
  ];
}

const TOUCHES: Record<GuardedObject, string[]> = {
  task: ["status", "bodyV2"],
  opportunity: ["stage", "whyStopped"],
};

const NOUN: Record<GuardedObject, string> = { task: "Task", opportunity: "Opportunity" };

async function judge(write: IntendedWrite, readStored: StoredReader): Promise<string[]> {
  const noun = NOUN[write.object];
  switch (write.kind) {
    case "merge":
      return write.dryRun
        ? []
        : [
            `a merge of ${noun} records is refused — the merged record's ${
              write.object === "task" ? "note and status" : "stage and why it stopped progressing"
            } cannot be checked before it lands; update the surviving record and delete the other`,
          ];
    case "updateMany": {
      const data = isRecord(write.data) ? write.data : {};
      const touched = TOUCHES[write.object].filter((field) => field in data);
      if (touched.length === 0) return [];
      if (write.object === "opportunity" && !("whyStopped" in data)) {
        const stage = data.stage;
        if (typeof stage !== "string" || !CLOSED_STAGES.has(stage)) return [];
      }
      return [
        `a filter-wide update of ${touched.join(" and ")} on ${noun} records is refused — write each ${noun} by its id, so each is checked`,
      ];
    }
    case "create": {
      if (!isRecord(write.data)) return [`the ${noun} to create carries no fields`];
      const id = write.data.id;
      if (write.upsert && typeof id === "string" && id !== "") {
        const stored = await readStored(write.object, id);
        if (stored) {
          const { id: _id, ...rest } = write.data;
          return judgeUpdate(write.object, rest, stored);
        }
      }
      return write.object === "task"
        ? judgeTask(write.data, undefined)
        : judgeOpportunity(write.data, undefined);
    }
    case "update": {
      if (!isRecord(write.data)) return [];
      const data = write.data;
      if (!TOUCHES[write.object].some((field) => field in data)) return [];
      if (typeof write.id !== "string" || write.id === "") {
        return [`the ${noun} update names no record id, so it cannot be checked`];
      }
      const stored = await readStored(write.object, write.id);
      if (!stored) {
        // Fail closed: a record the guard cannot read is one it cannot judge.
        return [`${noun} ${write.id} could not be read back, so the write cannot be checked`];
      }
      return judgeUpdate(write.object, data, stored);
    }
  }
}

function judgeUpdate(
  object: GuardedObject,
  data: Record<string, unknown>,
  stored: Record<string, unknown>,
): string[] {
  return object === "task" ? judgeTask(data, stored) : judgeOpportunity(data, stored);
}

/**
 * Throws a CliError naming what is missing when `request` would write a Task or an
 * Opportunity outside the house's rules; resolves when the request may be sent.
 */
export async function guardWrite(
  request: OutgoingRequest,
  readStored: StoredReader,
): Promise<void> {
  const writes = intendedWrites(request);
  if (writes.length === 0) return;

  const refusals: string[] = [];
  for (const [index, write] of writes.entries()) {
    const problems = await judge(write, readStored);
    const prefix =
      writes.length > 1 ? `${NOUN[write.object]} ${index + 1} of ${writes.length}: ` : "";
    for (const problem of problems) refusals.push(`${prefix}${problem}`);
  }
  if (refusals.length === 0) return;

  const nouns = [...new Set(writes.map((w) => NOUN[w.object]))].join(" / ");
  throw new CliError(
    `Refused before it reached the instance — the ${nouns} write breaks the house's shape:\n  - ${refusals.join("\n  - ")}`,
    REFUSED,
    "Write Tasks with `twenty tasks create`, close them with `twenty tasks close`, close Opportunities with `twenty opportunities close`; each emits the shape (https://docs.wilsch-ai.com/partner-lead-crm-design Part 2).",
  );
}
