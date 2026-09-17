// `twenty parity check` — the seven acts the house relies on, driven against a live
// Twenty instance and witnessed on a separate re-read from the store.
//
// WHY THIS EXISTS. An extension is code written against a product that keeps changing,
// and when the next version breaks it nothing says so unless something is built to check.
// This is that something: every act below is issued through this binary's own services
// (the same HTTP client `twenty api …` and `twenty api-metadata …` use), and every act is
// graded on a FRESH READ of the store afterwards — never on the write's own response. A
// 200 that leaves no row fails here.
//
// THE ACTS, as recorded at the ceiling on issue-3021 and kept as parity:
//   1 read a record with its trail    — one read returns the record AND its trail entries
//   2 write a next step               — next step + its date land and re-read
//   3 post an activity                — the trail grows by one and the post is its latest
//   4 move a stage                    — the stage changes on re-read
//   5 define a field                  — the field is on a fresh read of the object's metadata
//   6 save a view                     — the view is listed by name; its filter persists
//   7 set who may write               — a role with no write permission re-reads as such
//
// FIXTURE. The check creates its own counterparty record and trail entries, named with
// this run's stamp, so nothing it grades was left standing by an earlier run — and it
// removes everything it created unless --keep is passed. Cleanup is graded too: a
// leftover is a finding, not a footnote.
//
// EXIT. The report is rendered, then the command exits non-zero if any act or cleanup
// step did not land. That is the whole point: when Twenty's next version moves, the
// house finds out from a run rather than from a row that went missing.
import { requireGraphqlField, type GraphQLResponse } from "../../utilities/api/graphql-response";
import {
  extractFirstValue,
  getDataSection,
  isRestObject,
  type RestObject,
} from "../../utilities/api/rest-response";
import {
  CREATE_ROLE_MUTATION,
  DELETE_ROLE_MUTATION,
  GET_ROLES_QUERY,
} from "../../utilities/metadata/roles-graphql";

export interface ParityCheckOptions {
  /** Plural REST name of the counterparty object, e.g. `opportunities`. */
  object: string;
  /** Plural REST name of the trail object, e.g. `activities`. */
  trailObject: string;
  /** The trail object's relation field pointing at the counterparty, e.g. `opportunityId`. */
  trailRelation: string;
  stageField: string;
  stageFrom: string;
  stageTo: string;
  nextStepField: string;
  nextStepDateField: string;
  /** Leave the fixtures standing; skip and report no cleanup. */
  keep: boolean;
}

export const DEFAULT_PARITY_CHECK_OPTIONS: ParityCheckOptions = Object.freeze({
  object: "opportunities",
  trailObject: "activities",
  trailRelation: "opportunityId",
  stageField: "stage",
  stageFrom: "PROPOSAL",
  stageTo: "CLOSED_LOST",
  nextStepField: "nextStep",
  nextStepDateField: "nextStepDate",
  keep: false,
});

export const PARITY_ACTS = [
  "read a record with its trail",
  "write a next step",
  "post an activity",
  "move a stage",
  "define a field",
  "save a view",
  "set who may write",
] as const;

export interface ObjectMetadataLike {
  id: string;
  fields?: Array<{ id: string; [key: string]: unknown }>;
  [key: string]: unknown;
}

export interface ParityServices {
  records: {
    get(object: string, id: string, options?: { include?: string }): Promise<unknown>;
    create(object: string, data: Record<string, unknown>): Promise<unknown>;
    update(object: string, id: string, data: Record<string, unknown>): Promise<unknown>;
    destroy(object: string, id: string): Promise<unknown>;
  };
  metadata: {
    getObject(nameOrId: string): Promise<ObjectMetadataLike>;
    createField(data: Record<string, unknown>): Promise<unknown>;
    deleteField(id: string): Promise<void>;
    createView(data: Record<string, unknown>): Promise<unknown>;
    deleteView(id: string): Promise<boolean>;
    listViews(params?: Record<string, string | undefined>): Promise<RestObject[]>;
    createViewFilter(data: Record<string, unknown>): Promise<unknown>;
    deleteViewFilter(id: string): Promise<boolean>;
    listViewFilters(params?: Record<string, string | undefined>): Promise<RestObject[]>;
  };
  api: {
    post<T = unknown>(url: string, data?: unknown): Promise<{ data: T }>;
  };
}

export interface ParityActResult {
  act: number;
  name: string;
  ok: boolean;
  layer: string;
  witness: string;
  error?: string;
}

export interface ParityCleanupResult {
  step: string;
  ok: boolean;
  detail: string;
}

export interface ParityFixture {
  recordId?: string;
  trailIds: string[];
  fieldId?: string;
  fieldName?: string;
  viewId?: string;
  viewFilterId?: string;
  roleId?: string;
}

export interface ParityReport {
  ok: boolean;
  stamp: string;
  object: string;
  trailObject: string;
  fixture: ParityFixture;
  acts: ParityActResult[];
  cleanup: ParityCleanupResult[];
  kept: boolean;
}

class ActFailure extends Error {}

export function formatStamp(date: Date): string {
  return date
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z")
    .replace(/[-:]/g, "");
}

export function isoDateDaysFrom(date: Date, days: number): string {
  return new Date(date.getTime() + days * 86_400_000).toISOString().slice(0, 10);
}

export function latestByCreatedAt(entries: readonly RestObject[]): RestObject | undefined {
  let latest: RestObject | undefined;
  let latestTime = Number.NEGATIVE_INFINITY;
  for (const entry of entries) {
    const time = Date.parse(String(entry.createdAt ?? ""));
    if (Number.isNaN(time)) {
      continue;
    }
    if (time >= latestTime) {
      latestTime = time;
      latest = entry;
    }
  }

  return latest;
}

export function trailOf(record: unknown, trailObject: string): RestObject[] {
  if (!isRestObject(record)) {
    return [];
  }
  const trail = record[trailObject];

  return Array.isArray(trail) ? trail.filter(isRestObject) : [];
}

export function unwrapCreated(value: unknown, what: string): RestObject & { id: string } {
  if (isRestObject(value) && typeof value.id === "string") {
    return value as RestObject & { id: string };
  }
  const first = extractFirstValue(getDataSection(value));
  if (isRestObject(first) && typeof first.id === "string") {
    return first as RestObject & { id: string };
  }

  throw new ActFailure(`${what}: the create response carried no id (${preview(value)})`);
}

export function findField(
  object: ObjectMetadataLike,
  name: string,
): (RestObject & { id: string }) | undefined {
  return object.fields?.find((field) => field.name === name);
}

export function nextStepValueFor(type: unknown, stamp: string): unknown {
  switch (type) {
    case "RAW_JSON":
      return { step: "Send revised SOW", writtenBy: `parity-${stamp}` };
    case "TEXT":
      return `Send revised SOW (parity ${stamp})`;
    default:
      throw new ActFailure(
        `next step field has type ${String(type)}; only RAW_JSON and TEXT are written`,
      );
  }
}

export function nextStepLanded(type: unknown, written: unknown, reread: unknown): boolean {
  if (type === "TEXT") {
    return reread === written;
  }
  let candidate = reread;
  if (typeof candidate === "string") {
    try {
      candidate = JSON.parse(candidate);
    } catch {
      return false;
    }
  }
  if (!isRestObject(candidate) || !isRestObject(written)) {
    return false;
  }

  return candidate.step === written.step && candidate.writtenBy === written.writtenBy;
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    const response = (error as { response?: { status?: unknown; data?: unknown } }).response;
    if (response && typeof response.status === "number") {
      return `HTTP ${response.status}: ${preview(response.data)}`;
    }

    return error.message;
  }

  return String(error);
}

function preview(value: unknown): string {
  try {
    return JSON.stringify(value).slice(0, 240);
  } catch {
    return String(value);
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new ActFailure(message);
  }
}

export async function runParityCheck(
  services: ParityServices,
  options: ParityCheckOptions = DEFAULT_PARITY_CHECK_OPTIONS,
  clock: () => Date = () => new Date(),
): Promise<ParityReport> {
  const now = clock();
  const stamp = formatStamp(now);
  const fixture: ParityFixture = { trailIds: [] };
  const acts: ParityActResult[] = [];
  const cleanup: ParityCleanupResult[] = [];

  let objectMeta: ObjectMetadataLike | undefined;
  let fixtureError: string | undefined;

  try {
    objectMeta = await services.metadata.getObject(options.object);
    const record = unwrapCreated(
      await services.records.create(options.object, {
        name: `parity check ${stamp}`,
        [options.stageField]: options.stageFrom,
      }),
      "fixture record",
    );
    fixture.recordId = record.id;
    const seed = unwrapCreated(
      await services.records.create(options.trailObject, {
        name: `parity seed ${stamp}`,
        [options.trailRelation]: record.id,
      }),
      "seed trail entry",
    );
    fixture.trailIds.push(seed.id);
  } catch (error) {
    fixtureError = `fixture not established: ${errorMessage(error)}`;
  }

  const requireFixture = (): { recordId: string; meta: ObjectMetadataLike } => {
    if (fixtureError || !fixture.recordId || !objectMeta) {
      throw new ActFailure(fixtureError ?? "fixture not established");
    }

    return { recordId: fixture.recordId, meta: objectMeta };
  };

  const readRecord = async (recordId: string, withTrail: boolean): Promise<RestObject> => {
    const record = await services.records.get(
      options.object,
      recordId,
      withTrail ? { include: options.trailObject } : undefined,
    );
    assert(isRestObject(record), `re-read of ${options.object}/${recordId} returned no record`);

    return record;
  };

  const act = async (
    number: number,
    layer: string,
    drive: () => Promise<string>,
  ): Promise<void> => {
    const name = PARITY_ACTS[number - 1] ?? `act ${number}`;
    try {
      const witness = await drive();
      acts.push({ act: number, name, ok: true, layer, witness });
    } catch (error) {
      acts.push({
        act: number,
        name,
        ok: false,
        layer,
        witness: "",
        error: error instanceof ActFailure ? error.message : errorMessage(error),
      });
    }
  };

  // 1 — read a record with its trail
  await act(1, "API — one read of the record with its trail included", async () => {
    const { recordId } = requireFixture();
    const record = await readRecord(recordId, true);
    const trail = trailOf(record, options.trailObject);
    assert(record.id === recordId, `the read returned ${String(record.id)}, not ${recordId}`);
    assert(trail.length >= 1, `the read carried no ${options.trailObject} for the record`);
    const foreign = trail.filter((entry) => entry[options.trailRelation] !== recordId);
    assert(
      foreign.length === 0,
      `${foreign.length} trail entries belong to another record (${options.trailRelation} mismatch)`,
    );

    return `one read returned the record and ${trail.length} trail entr${trail.length === 1 ? "y" : "ies"}, every one with ${options.trailRelation}=${recordId}`;
  });

  // 2 — write a next step
  await act(2, "store — a separate re-read of the record after the write", async () => {
    const { recordId, meta } = requireFixture();
    const stepField = findField(meta, options.nextStepField);
    const dateField = findField(meta, options.nextStepDateField);
    assert(stepField, `field ${options.nextStepField} is absent from ${options.object}'s metadata`);
    assert(
      dateField,
      `field ${options.nextStepDateField} is absent from ${options.object}'s metadata`,
    );
    assert(
      dateField.type === "DATE" || dateField.type === "DATE_TIME",
      `field ${options.nextStepDateField} has type ${String(dateField.type)}, not DATE`,
    );
    const date = isoDateDaysFrom(now, 7);
    const step = nextStepValueFor(stepField.type, stamp);
    await services.records.update(options.object, recordId, {
      [options.nextStepField]: step,
      [options.nextStepDateField]: date,
    });
    const reread = await readRecord(recordId, false);
    const rereadDate = String(reread[options.nextStepDateField] ?? "").slice(0, 10);
    assert(
      rereadDate === date,
      `${options.nextStepDateField} re-reads as ${preview(reread[options.nextStepDateField])}, not ${date}`,
    );
    assert(
      nextStepLanded(stepField.type, step, reread[options.nextStepField]),
      `${options.nextStepField} re-reads as ${preview(reread[options.nextStepField])}, not what was written`,
    );

    return `re-read shows ${options.nextStepDateField}=${date} (${String(dateField.type)}) and ${options.nextStepField} (${String(stepField.type)}) as written for parity-${stamp}`;
  });

  // 3 — post an activity
  await act(3, "API — a re-read of the record's trail after the post", async () => {
    const { recordId } = requireFixture();
    const before = trailOf(await readRecord(recordId, true), options.trailObject);
    assert(
      before.length >= 1,
      "trail was empty before the post, so latest-ness would be trivially true",
    );
    const posted = unwrapCreated(
      await services.records.create(options.trailObject, {
        name: `parity posted ${stamp}`,
        [options.trailRelation]: recordId,
      }),
      "posted trail entry",
    );
    fixture.trailIds.push(posted.id);
    const after = trailOf(await readRecord(recordId, true), options.trailObject);
    assert(
      after.length === before.length + 1,
      `trail went ${before.length} -> ${after.length}, not +1`,
    );
    assert(
      after.some((entry) => entry.id === posted.id),
      "the posted entry is absent from the re-read trail",
    );
    const latest = latestByCreatedAt(after);
    assert(
      latest?.id === posted.id,
      `the trail's latest entry by createdAt is ${String(latest?.id)}, not the posted ${posted.id}`,
    );

    return `trail ${before.length} -> ${after.length}; the posted entry ${posted.id} is present and latest by createdAt`;
  });

  // 4 — move a stage
  await act(4, "store — a separate re-read of the record after the move", async () => {
    const { recordId } = requireFixture();
    const before = await readRecord(recordId, false);
    assert(
      before[options.stageField] === options.stageFrom,
      `stage before the move is ${preview(before[options.stageField])}, not ${options.stageFrom}; the move would not be exercised`,
    );
    await services.records.update(options.object, recordId, {
      [options.stageField]: options.stageTo,
    });
    const after = await readRecord(recordId, false);
    assert(
      after[options.stageField] === options.stageTo,
      `stage re-reads as ${preview(after[options.stageField])}, not ${options.stageTo}`,
    );

    return `${options.stageField} ${options.stageFrom} -> ${options.stageTo} on re-read`;
  });

  // 5 — define a field
  await act(
    5,
    "metadata store — a fresh read of the object's fields after the create",
    async () => {
      const { meta } = requireFixture();
      const fieldName = `parityProbe${stamp.replace(/\D/g, "")}`;
      const created = unwrapCreated(
        await services.metadata.createField({
          name: fieldName,
          label: `Parity probe ${stamp}`,
          type: "TEXT",
          objectMetadataId: meta.id,
          description: "twenty parity check — a field defined through the fork's binary",
        }),
        "field",
      );
      fixture.fieldId = created.id;
      fixture.fieldName = fieldName;
      const reread = await services.metadata.getObject(meta.id);
      const found = findField(reread, fieldName);
      assert(
        found,
        `${fieldName} is absent from a fresh read of ${options.object}'s ${reread.fields?.length ?? 0} fields`,
      );
      assert(
        found.id === created.id,
        `${fieldName} re-reads with id ${found.id}, not ${created.id}`,
      );

      return `${fieldName} (${created.id}) present on a fresh read of the object's ${reread.fields?.length ?? 0} fields`;
    },
  );

  // 6 — save a view
  await act(
    6,
    "API — the view store, listed by object, and the filter re-read by view",
    async () => {
      const { meta } = requireFixture();
      const createdAt = findField(meta, "createdAt");
      assert(createdAt, `createdAt is absent from ${options.object}'s metadata`);
      const viewName = `parity check ${stamp}`;
      const view = unwrapCreated(
        await services.metadata.createView({
          name: viewName,
          objectMetadataId: meta.id,
          type: "TABLE",
          icon: "IconFilter",
        }),
        "view",
      );
      fixture.viewId = view.id;
      const cutoff = now.toISOString();
      const filter = unwrapCreated(
        await services.metadata.createViewFilter({
          viewId: view.id,
          fieldMetadataId: createdAt.id,
          operand: "IS_AFTER",
          value: cutoff,
        }),
        "view filter",
      );
      fixture.viewFilterId = filter.id;
      const views = await services.metadata.listViews({ objectMetadataId: meta.id });
      const listed = views.filter(
        (candidate) => candidate.id === view.id && candidate.name === viewName,
      );
      assert(
        listed.length === 1,
        `views named ${viewName} with id ${view.id}: ${listed.length}, not 1`,
      );
      const filters = await services.metadata.listViewFilters({ viewId: view.id });
      const persisted = filters.find((candidate) => candidate.id === filter.id);
      assert(persisted, `the filter ${filter.id} is absent from a re-read of the view's filters`);
      assert(
        persisted.operand === "IS_AFTER" && persisted.value === cutoff,
        `the filter re-reads as ${preview({ operand: persisted.operand, value: persisted.value })}, not IS_AFTER ${cutoff}`,
      );

      return `view "${viewName}" (${view.id}) listed by name; its filter createdAt IS_AFTER ${cutoff} persisted and re-read`;
    },
  );

  // 7 — set who may write
  await act(7, "metadata store — the role re-read with its permission flags", async () => {
    requireFixture();
    const input = {
      label: `parity-nowrite-${stamp}`,
      description: "twenty parity check — deliberately no settings and no record-write permission",
      canUpdateAllSettings: false,
      canReadAllObjectRecords: true,
      canUpdateAllObjectRecords: false,
      canSoftDeleteAllObjectRecords: false,
      canDestroyAllObjectRecords: false,
      canAccessAllTools: false,
    };
    const created = await services.api.post<GraphQLResponse<Record<string, unknown>>>("/metadata", {
      query: CREATE_ROLE_MUTATION,
      variables: { createRoleInput: input },
    });
    const role = unwrapCreated(
      requireGraphqlField(created.data ?? {}, "createOneRole", "Failed to create the parity role."),
      "role",
    );
    fixture.roleId = role.id;
    const reread = await listRoles(services);
    const found = reread.find((candidate) => candidate.id === role.id);
    assert(found, `role ${role.id} is absent from a re-read of the workspace's roles`);
    assert(
      found.canUpdateAllObjectRecords === false &&
        found.canUpdateAllSettings === false &&
        found.canReadAllObjectRecords === true,
      `role re-reads with flags ${preview({
        canUpdateAllObjectRecords: found.canUpdateAllObjectRecords,
        canUpdateAllSettings: found.canUpdateAllSettings,
        canReadAllObjectRecords: found.canReadAllObjectRecords,
      })}, not as written`,
    );

    return `role "${input.label}" (${role.id}) re-reads with canUpdateAllObjectRecords=false, canUpdateAllSettings=false, canReadAllObjectRecords=true`;
  });

  if (!options.keep) {
    await runCleanup(services, options, fixture, cleanup);
  }

  return {
    ok: acts.every((result) => result.ok) && cleanup.every((result) => result.ok),
    stamp,
    object: options.object,
    trailObject: options.trailObject,
    fixture,
    acts,
    cleanup,
    kept: options.keep,
  };
}

async function listRoles(services: ParityServices): Promise<RestObject[]> {
  const response = await services.api.post<GraphQLResponse<Record<string, unknown>>>("/metadata", {
    query: GET_ROLES_QUERY,
  });
  const roles = requireGraphqlField(response.data ?? {}, "getRoles", "Failed to list roles.");

  return Array.isArray(roles) ? roles.filter(isRestObject) : [];
}

async function runCleanup(
  services: ParityServices,
  options: ParityCheckOptions,
  fixture: ParityFixture,
  cleanup: ParityCleanupResult[],
): Promise<void> {
  const step = async (name: string, run: () => Promise<string>): Promise<void> => {
    try {
      cleanup.push({ step: name, ok: true, detail: await run() });
    } catch (error) {
      cleanup.push({ step: name, ok: false, detail: errorMessage(error) });
    }
  };

  if (fixture.roleId) {
    const roleId = fixture.roleId;
    await step("delete role", async () => {
      await services.api.post("/metadata", {
        query: DELETE_ROLE_MUTATION,
        variables: { roleId },
      });
      const remaining = await listRoles(services);
      assert(
        !remaining.some((role) => role.id === roleId),
        `role ${roleId} still listed after delete`,
      );

      return `role ${roleId} deleted and absent on re-read`;
    });
  }

  if (fixture.viewFilterId) {
    const viewFilterId = fixture.viewFilterId;
    await step("delete view filter", async () => {
      await services.metadata.deleteViewFilter(viewFilterId);

      return `view filter ${viewFilterId} deleted`;
    });
  }

  if (fixture.viewId) {
    const viewId = fixture.viewId;
    await step("delete view", async () => {
      await services.metadata.deleteView(viewId);
      const remaining = await services.metadata.listViews();
      assert(
        !remaining.some((view) => view.id === viewId),
        `view ${viewId} still listed after delete`,
      );

      return `view ${viewId} deleted and absent on re-read`;
    });
  }

  if (fixture.fieldId) {
    const fieldId = fixture.fieldId;
    await step("delete field", async () => {
      await services.metadata.deleteField(fieldId);
      const object = await services.metadata.getObject(options.object);
      assert(
        !object.fields?.some((field) => field.id === fieldId),
        `field ${fieldId} still on the object after delete`,
      );

      return `field ${fixture.fieldName ?? fieldId} deleted and absent on a fresh read`;
    });
  }

  for (const trailId of fixture.trailIds) {
    await step(`destroy trail entry ${trailId}`, async () => {
      await services.records.destroy(options.trailObject, trailId);

      return `${options.trailObject}/${trailId} destroyed`;
    });
  }

  if (fixture.recordId) {
    const recordId = fixture.recordId;
    await step("destroy fixture record", async () => {
      await services.records.destroy(options.object, recordId);
      let gone = false;
      try {
        const reread = await services.records.get(options.object, recordId);
        gone = !isRestObject(reread) || reread.id !== recordId;
      } catch {
        gone = true;
      }
      assert(gone, `${options.object}/${recordId} still reads back after destroy`);

      return `${options.object}/${recordId} destroyed and absent on re-read`;
    });
  }
}
