import { describe, expect, it } from "vitest";

import {
  expectedAfter,
  noteSha256,
  patchFor,
  planAgainst,
  recordProblems,
  stateOf,
  type MigrationRecord,
  type MigrationRow,
  type MigrationTaskState,
} from "../task-migration";

const NOTE = "Rests on: [a mail](https://example.com/m)";
const EVENT = "ev-1";
const EVENT_DAY = "2026-11-17T00:00:00.000Z";
const roomDay = (id: string) => (id === EVENT ? EVENT_DAY : undefined);

function stored(id: string, extra: Partial<MigrationTaskState> = {}): MigrationTaskState {
  return {
    id,
    status: "TODO",
    title: `Us: Marius does ${id}`,
    dueAt: "2026-11-20T00:00:00.000Z",
    assigneeId: "m-1",
    owes: null,
    owesPersonId: null,
    roomId: null,
    waitsOnId: null,
    waitsOnIssue: { primaryLinkUrl: "" },
    companyId: "c-1",
    bodyV2: { markdown: NOTE },
    ...extra,
  };
}

function row(task: MigrationTaskState, after: Partial<MigrationRow["after"]> = {}): MigrationRow {
  return {
    id: task.id,
    before: stateOf(task),
    after: {
      title: `Marius does ${task.id}`,
      owes: "HOUSE",
      owesPersonId: null,
      roomId: null,
      ...after,
    },
  };
}

describe("the one migration's record (CCI#1342)", () => {
  it("reads a stored Task into the record's before, the note by its hash", () => {
    const before = stateOf(stored("a"));
    expect(before.title).toBe("Us: Marius does a");
    expect(before.waitsOnIssueUrl).toBeNull();
    expect(before.noteSha256).toBe(noteSha256(NOTE));
  });

  it("writes only the fields a row changes, and clears a waiting Task's date", () => {
    expect(patchFor(row(stored("a")))).toEqual({ title: "Marius does a", owes: "HOUSE" });
    const waiting = stored("w", { waitsOnId: "a" });
    expect(patchFor(row(waiting))).toEqual({ title: "Marius does w", owes: "HOUSE", dueAt: null });
    const same = stored("s", { title: "Marius does s", owes: "HOUSE" });
    expect(patchFor(row(same))).toEqual({});
  });

  it("expects the room's day where a room is named, none where the Task waits, else the day it had", () => {
    expect(expectedAfter(row(stored("r"), { roomId: EVENT }), roomDay).dueAt).toBe(EVENT_DAY);
    expect(expectedAfter(row(stored("w", { waitsOnId: "a" })), roomDay).dueAt).toBeNull();
    expect(expectedAfter(row(stored("k")), roomDay).dueAt).toBe("2026-11-20T00:00:00.000Z");
  });

  it("refuses an after the store would not take", () => {
    const record: MigrationRecord = {
      rows: [
        row(stored("a"), { title: "" }),
        row(stored("b"), { owes: "US" }),
        row(stored("c"), { owesPersonId: "p-1" }),
        row(stored("d", { waitsOnId: "a" }), { roomId: EVENT }),
      ],
    };
    const problems = recordProblems(record).join("\n");
    expect(problems).toMatch(/row a leaves the Task with no title/);
    expect(problems).toMatch(/row b leaves who owes "US"/);
    expect(problems).toMatch(/row c names who there on the house's side/);
    expect(problems).toMatch(/row d waits and is given a room/);
  });

  it("refuses two open Tasks on one Company left with the same title", () => {
    const record: MigrationRecord = {
      rows: [row(stored("a"), { title: "Same" }), row(stored("b"), { title: "same" })],
    };
    expect(recordProblems(record).join("\n")).toMatch(/open Tasks a, b on Company c-1 would share/);
    const apart: MigrationRecord = {
      rows: [
        row(stored("a"), { title: "Same" }),
        row(stored("b", { companyId: "c-2" }), { title: "Same" }),
      ],
    };
    expect(recordProblems(apart)).toEqual([]);
  });

  it("plans a write per changed row when every open Task stands as the record read it", () => {
    const tasks = [stored("a"), stored("b", { title: "Marius does b", owes: "HOUSE" })];
    const record: MigrationRecord = { rows: tasks.map((t) => row(t)) };
    const { plan, problems } = planAgainst(record, tasks, roomDay);
    expect(problems).toEqual([]);
    expect(plan).toEqual([
      { id: "a", kind: "write", patch: { title: "Marius does a", owes: "HOUSE" } },
      { id: "b", kind: "unchanged" },
    ]);
  });

  it("refuses the run when a Task moved after the read, an open Task has no row, or a row is not open", () => {
    const a = stored("a");
    const record: MigrationRecord = { rows: [row(a), row(stored("gone"))] };
    const moved = { ...a, dueAt: "2026-11-25T00:00:00.000Z" };
    const { problems } = planAgainst(record, [moved, stored("new")], roomDay);
    const text = problems.join("\n");
    expect(text).toMatch(/Task a no longer stands as the record read it: dueAt/);
    expect(text).toMatch(/open Task new has no row in the record/);
    expect(text).toMatch(/row gone names a Task that is not open/);
  });

  it("counts a row already standing as its after as done, so the same record finishes a stopped run", () => {
    const a = stored("a");
    const r = row(a, { roomId: EVENT });
    const migrated = {
      ...a,
      title: "Marius does a",
      owes: "HOUSE",
      roomId: EVENT,
      dueAt: EVENT_DAY,
    };
    const { plan, problems } = planAgainst({ rows: [r] }, [migrated], roomDay);
    expect(problems).toEqual([]);
    expect(plan).toEqual([{ id: "a", kind: "done" }]);
  });

  it("refuses a room the instance holds no dated event for", () => {
    const a = stored("a");
    const { problems } = planAgainst({ rows: [row(a, { roomId: "nope" })] }, [a], roomDay);
    expect(problems.join("\n")).toMatch(
      /names room nope, which the instance holds no dated event for/,
    );
  });
});
