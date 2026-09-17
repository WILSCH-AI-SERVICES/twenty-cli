import { Command } from "commander";
import { describe, expect, it } from "vitest";

import type { RestObject } from "../../../utilities/api/rest-response";
import {
  DEFAULT_PARITY_CHECK_OPTIONS,
  formatStamp,
  isoDateDaysFrom,
  latestByCreatedAt,
  nextStepLanded,
  nextStepValueFor,
  runParityCheck,
  unwrapCreated,
  type ObjectMetadataLike,
  type ParityServices,
} from "../parity-check.service";
import { formatParityReport, registerParityCommand, resolveParityOptions } from "../parity.command";

// A tiny in-memory Twenty: records per object, an object's metadata with fields, views,
// view filters and roles. Every "re-read" the check takes goes through the same store the
// writes went to, so the check's witnesses are meaningful, and a store that drops writes
// (see `persistUpdates: false`) makes them fail the way a broken instance would.
function fakeTwenty(behaviour: { persistUpdates?: boolean; embedTrail?: boolean } = {}) {
  const persistUpdates = behaviour.persistUpdates ?? true;
  const embedTrail = behaviour.embedTrail ?? true;
  let counter = 0;
  const nextId = (prefix: string) => `${prefix}-${++counter}`;
  const records = new Map<string, Map<string, RestObject>>();
  const table = (object: string) => {
    const existing = records.get(object);
    if (existing) return existing;
    const created = new Map<string, RestObject>();
    records.set(object, created);
    return created;
  };
  const object: ObjectMetadataLike = {
    id: "obj-opportunity",
    nameSingular: "opportunity",
    namePlural: "opportunities",
    fields: [
      { id: "f-createdAt", name: "createdAt", type: "DATE_TIME" },
      { id: "f-stage", name: "stage", type: "SELECT" },
      { id: "f-nextStep", name: "nextStep", type: "RAW_JSON" },
      { id: "f-nextStepDate", name: "nextStepDate", type: "DATE" },
    ],
  };
  const views = new Map<string, RestObject>();
  const viewFilters = new Map<string, RestObject>();
  const roles = new Map<string, RestObject>([["role-admin", { id: "role-admin", label: "Admin" }]]);

  const services: ParityServices = {
    records: {
      async get(objectName, id, options) {
        const record = table(objectName).get(id);
        if (!record) throw Object.assign(new Error("Not found"), { response: { status: 404 } });
        if (!options?.include || !embedTrail) return { ...record };
        const trail = [...table(options.include).values()].filter(
          (entry) => entry[DEFAULT_PARITY_CHECK_OPTIONS.trailRelation] === id,
        );
        return { ...record, [options.include]: trail };
      },
      async create(objectName, data) {
        const id = nextId(objectName);
        const record = {
          id,
          ...data,
          createdAt: new Date(2026, 0, 1, 0, 0, counter).toISOString(),
        };
        table(objectName).set(id, record);
        return record;
      },
      async update(objectName, id, data) {
        const record = table(objectName).get(id);
        if (!record) throw new Error("Not found");
        if (persistUpdates) Object.assign(record, data);
        return { ...record, ...data };
      },
      async destroy(objectName, id) {
        table(objectName).delete(id);
        return null;
      },
    },
    metadata: {
      async getObject(nameOrId) {
        if (
          nameOrId !== object.id &&
          nameOrId !== object.namePlural &&
          nameOrId !== object.nameSingular
        ) {
          throw new Error(`Object not found: ${nameOrId}`);
        }
        return { ...object, fields: [...(object.fields ?? [])] };
      },
      async createField(data) {
        const field = { id: nextId("field"), ...data };
        object.fields?.push(
          field as ObjectMetadataLike["fields"] extends Array<infer T> ? T : never,
        );
        // REST metadata creates answer with an envelope; the check must unwrap it.
        return { data: { createField: field } };
      },
      async deleteField(id) {
        object.fields = object.fields?.filter((field) => field.id !== id);
      },
      async createView(data) {
        const view = { id: nextId("view"), ...data };
        views.set(view.id, view);
        return view;
      },
      async deleteView(id) {
        return views.delete(id);
      },
      async listViews(params) {
        return [...views.values()].filter(
          (view) => !params?.objectMetadataId || view.objectMetadataId === params.objectMetadataId,
        );
      },
      async createViewFilter(data) {
        const filter = { id: nextId("filter"), ...data };
        viewFilters.set(filter.id, filter);
        return filter;
      },
      async deleteViewFilter(id) {
        return viewFilters.delete(id);
      },
      async listViewFilters(params) {
        return [...viewFilters.values()].filter(
          (filter) => !params?.viewId || filter.viewId === params.viewId,
        );
      },
    },
    api: {
      async post<T>(url: string, body?: unknown) {
        expect(url).toBe("/metadata");
        const { query, variables } = body as { query: string; variables?: Record<string, unknown> };
        if (query.includes("createOneRole")) {
          const input = variables?.createRoleInput as RestObject;
          const role = { id: nextId("role"), ...input };
          roles.set(role.id, role);
          return { data: { data: { createOneRole: role } } as T };
        }
        if (query.includes("deleteOneRole")) {
          roles.delete(String(variables?.roleId));
          return { data: { data: { deleteOneRole: true } } as T };
        }
        return { data: { data: { getRoles: [...roles.values()] } } as T };
      },
    },
  };

  return { services, records, object, views, viewFilters, roles };
}

const clock = () => new Date("2026-09-17T09:30:00.000Z");

describe("parity check service", () => {
  it("drives all seven acts, witnesses each on a re-read, and cleans up after itself", async () => {
    const twenty = fakeTwenty();

    const report = await runParityCheck(twenty.services, DEFAULT_PARITY_CHECK_OPTIONS, clock);

    expect(report.ok).toBe(true);
    expect(report.stamp).toBe("20260917T093000Z");
    expect(report.acts.map((act) => act.ok)).toEqual([true, true, true, true, true, true, true]);
    expect(report.acts[1]?.witness).toContain("nextStepDate=2026-09-24 (DATE)");
    expect(report.acts[2]?.witness).toContain("trail 1 -> 2");
    expect(report.acts[3]?.witness).toContain("PROPOSAL -> CLOSED_LOST");
    expect(report.acts[4]?.witness).toContain("parityProbe20260917093000");
    expect(report.acts[6]?.witness).toContain("canUpdateAllObjectRecords=false");
    expect(report.cleanup.every((step) => step.ok)).toBe(true);
    expect(report.cleanup.map((step) => step.step)).toEqual([
      "delete role",
      "delete view filter",
      "delete view",
      "delete field",
      `destroy trail entry ${report.fixture.trailIds[0]}`,
      `destroy trail entry ${report.fixture.trailIds[1]}`,
      "destroy fixture record",
    ]);
    expect(twenty.records.get("opportunities")?.size ?? 0).toBe(0);
    expect(twenty.records.get("activities")?.size ?? 0).toBe(0);
    expect(twenty.views.size).toBe(0);
    expect(twenty.viewFilters.size).toBe(0);
    expect(twenty.roles.size).toBe(1);
    expect(
      twenty.object.fields?.some((field) => field.name?.toString().startsWith("parityProbe")),
    ).toBe(false);
  });

  it("fails the acts whose writes do not land on re-read, and still cleans up", async () => {
    const twenty = fakeTwenty({ persistUpdates: false });

    const report = await runParityCheck(twenty.services, DEFAULT_PARITY_CHECK_OPTIONS, clock);

    expect(report.ok).toBe(false);
    expect(report.acts.filter((act) => !act.ok).map((act) => act.act)).toEqual([2, 4]);
    expect(report.acts[1]?.error).toMatch(/re-reads as/);
    expect(report.acts[3]?.error).toMatch(/re-reads as "PROPOSAL", not CLOSED_LOST/);
    expect(report.cleanup.every((step) => step.ok)).toBe(true);
    expect(twenty.records.get("opportunities")?.size ?? 0).toBe(0);
  });

  it("fails act 1 and act 3 when a read does not carry the trail", async () => {
    const twenty = fakeTwenty({ embedTrail: false });

    const report = await runParityCheck(twenty.services, DEFAULT_PARITY_CHECK_OPTIONS, clock);

    expect(report.ok).toBe(false);
    expect(report.acts[0]?.ok).toBe(false);
    expect(report.acts[0]?.error).toMatch(/carried no activities/);
    expect(report.acts[2]?.ok).toBe(false);
  });

  it("keeps the fixtures when asked and reports no cleanup", async () => {
    const twenty = fakeTwenty();

    const report = await runParityCheck(
      twenty.services,
      { ...DEFAULT_PARITY_CHECK_OPTIONS, keep: true },
      clock,
    );

    expect(report.ok).toBe(true);
    expect(report.kept).toBe(true);
    expect(report.cleanup).toEqual([]);
    expect(twenty.records.get("opportunities")?.size).toBe(1);
    expect(twenty.roles.size).toBe(2);
  });

  it("fails every act when the fixture cannot be established", async () => {
    const twenty = fakeTwenty();

    const report = await runParityCheck(
      twenty.services,
      { ...DEFAULT_PARITY_CHECK_OPTIONS, object: "nothing" },
      clock,
    );

    expect(report.ok).toBe(false);
    expect(report.acts).toHaveLength(7);
    expect(
      report.acts.every((act) => !act.ok && act.error?.includes("fixture not established")),
    ).toBe(true);
    expect(report.cleanup).toEqual([]);
  });

  it("fails act 2 when the date field is absent from the metadata", async () => {
    const twenty = fakeTwenty();
    twenty.object.fields = twenty.object.fields?.filter((field) => field.name !== "nextStepDate");

    const report = await runParityCheck(twenty.services, DEFAULT_PARITY_CHECK_OPTIONS, clock);

    expect(report.acts[1]?.ok).toBe(false);
    expect(report.acts[1]?.error).toMatch(/nextStepDate is absent/);
  });
});

describe("parity check helpers", () => {
  it("stamps, dates and picks the latest entry", () => {
    expect(formatStamp(new Date("2026-09-17T09:30:00.123Z"))).toBe("20260917T093000Z");
    expect(isoDateDaysFrom(new Date("2026-09-17T23:30:00.000Z"), 7)).toBe("2026-09-24");
    expect(
      latestByCreatedAt([
        { id: "a", createdAt: "2026-01-01T00:00:00.000Z" },
        { id: "c", createdAt: "2026-01-03T00:00:00.000Z" },
        { id: "b", createdAt: "2026-01-02T00:00:00.000Z" },
        { id: "x" },
      ])?.id,
    ).toBe("c");
    expect(latestByCreatedAt([])).toBeUndefined();
  });

  it("writes and grades the next step by field type", () => {
    const raw = nextStepValueFor("RAW_JSON", "s");
    expect(nextStepLanded("RAW_JSON", raw, raw)).toBe(true);
    expect(nextStepLanded("RAW_JSON", raw, JSON.stringify(raw))).toBe(true);
    expect(nextStepLanded("RAW_JSON", raw, "{not json")).toBe(false);
    expect(nextStepLanded("RAW_JSON", raw, { step: "other" })).toBe(false);
    expect(nextStepLanded("TEXT", "x", "x")).toBe(true);
    expect(nextStepLanded("TEXT", "x", "y")).toBe(false);
    expect(() => nextStepValueFor("NUMBER", "s")).toThrow(/only RAW_JSON and TEXT/);
  });

  it("unwraps a created resource from either a bare object or an envelope", () => {
    expect(unwrapCreated({ id: "a" }, "thing").id).toBe("a");
    expect(unwrapCreated({ data: { createField: { id: "b" } } }, "thing").id).toBe("b");
    expect(() => unwrapCreated({ data: {} }, "thing")).toThrow(/carried no id/);
  });
});

describe("parity command", () => {
  it("registers `parity check` with defaults for the house's workspace", () => {
    const program = new Command();
    program.exitOverride();
    registerParityCommand(program);

    const parity = program.commands.find((command) => command.name() === "parity");
    const check = parity?.commands.find((command) => command.name() === "check");

    expect(check).toBeDefined();
    expect(check?.options.map((option) => option.long)).toEqual(
      expect.arrayContaining([
        "--object",
        "--trail-object",
        "--trail-relation",
        "--stage-field",
        "--stage-from",
        "--stage-to",
        "--next-step-field",
        "--next-step-date-field",
        "--keep",
      ]),
    );
  });

  it("resolves options over the defaults", () => {
    expect(resolveParityOptions({})).toEqual(DEFAULT_PARITY_CHECK_OPTIONS);
    expect(resolveParityOptions({ object: "leads", keep: true, stageTo: "" })).toEqual({
      ...DEFAULT_PARITY_CHECK_OPTIONS,
      object: "leads",
      keep: true,
    });
  });

  it("formats a text report with a PASS or FAIL result line", () => {
    const text = formatParityReport({
      version: "0.1.15-wilsch.1",
      ok: false,
      stamp: "s",
      object: "opportunities",
      trailObject: "activities",
      fixture: { trailIds: [] },
      kept: false,
      acts: [
        { act: 1, name: "read a record with its trail", ok: true, layer: "API", witness: "fine" },
        {
          act: 2,
          name: "write a next step",
          ok: false,
          layer: "store",
          witness: "",
          error: "nope",
        },
      ],
      cleanup: [{ step: "delete role", ok: false, detail: "still there" }],
    });

    expect(text).toContain("PASS  1 read a record with its trail");
    expect(text).toContain("FAIL  2 write a next step");
    expect(text).toContain("cleanup 0/1 ok");
    expect(text.trim().endsWith("RESULT: FAIL")).toBe(true);
  });
});
