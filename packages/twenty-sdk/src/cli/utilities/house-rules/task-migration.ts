/**
 * The one migration of A Task's Life Part 5 (CCI#1342), as pure checks over a record.
 *
 * Part 5: "that release moves who owes and the room into their fields, linking each room a
 * title named to its event and keeping the carrier's day where no event holds the room yet,
 * cuts each title to what is owed, and clears the date of every Task that waits on another
 * Task or an issue, in one run". The cut of each title is a read, not a pattern, so the
 * session that runs it writes a before→after record row by row and versions it before the run
 * (crm-2990-twenty `migrations/`). `twenty tasks migrate` takes that record and:
 *
 *   - refuses, before any write, unless every open Task stands exactly as its `before` row
 *     reads it and every row names a Task that is open — so a Settle that wrote a Task between
 *     the read and the run stops the run instead of being overwritten;
 *   - refuses an `after` that is not a Task the store would take: an empty title, who owes
 *     other than HOUSE / OTHER_SIDE or empty, who there without the other side, a waiting Task
 *     given a room, or two open Tasks on one Company left with the same title (Twenty as the
 *     System of Record Part 4: the refusal of a second open Task keys on the title alone);
 *   - writes, per Task, only the fields its row changes — title, owes, owesPersonId, roomId,
 *     and dueAt cleared on a Task that waits — and never the note, status, assignee, the wait
 *     or the targets;
 *   - re-reads every Task and holds it to the row: the `after` fields, and every other field
 *     as `before` had it, the date being the room's day where a room was named (the store
 *     sets it, sql/task-wait-room.sql), none where the Task waits, else the day it had.
 *
 * A row already standing as its `after` is counted done and not written again, so a run that
 * stopped part-way is finished by running the same record again.
 */

import { createHash } from "node:crypto";

import { titleKey } from "./task-title";

export const OWES_VALUES = ["HOUSE", "OTHER_SIDE"] as const;

export interface MigrationTaskState {
  id: string;
  status?: string | null;
  title?: string | null;
  dueAt?: string | null;
  assigneeId?: string | null;
  owes?: string | null;
  owesPersonId?: string | null;
  roomId?: string | null;
  waitsOnId?: string | null;
  waitsOnIssue?: { primaryLinkUrl?: string | null } | null;
  companyId?: string | null;
  bodyV2?: { markdown?: string | null } | null;
}

/** A Task as the record holds it, on either side of the run. */
export interface RowBefore {
  status: string;
  title: string;
  dueAt: string | null;
  assigneeId: string | null;
  owes: string | null;
  owesPersonId: string | null;
  roomId: string | null;
  waitsOnId: string | null;
  waitsOnIssueUrl: string | null;
  companyId: string | null;
  noteSha256: string;
}

export interface RowAfter {
  title: string;
  owes: string;
  owesPersonId: string | null;
  roomId: string | null;
}

export interface MigrationRow {
  id: string;
  before: RowBefore;
  after: RowAfter;
  why?: string;
}

export interface MigrationRecord {
  migration?: string;
  readAt?: string;
  rows: MigrationRow[];
}

export type RowPlan =
  | { id: string; kind: "unchanged" }
  | { id: string; kind: "done" }
  | { id: string; kind: "write"; patch: Record<string, unknown> };

export function noteSha256(markdown: string | null | undefined): string {
  return createHash("sha256")
    .update(markdown ?? "")
    .digest("hex");
}

/** The record's view of a stored Task: the fields `before` names. */
export function stateOf(task: MigrationTaskState): RowBefore {
  const url = task.waitsOnIssue?.primaryLinkUrl?.trim();
  return {
    status: task.status ?? "",
    title: task.title ?? "",
    dueAt: task.dueAt ?? null,
    assigneeId: task.assigneeId ?? null,
    owes: task.owes ?? null,
    owesPersonId: task.owesPersonId ?? null,
    roomId: task.roomId ?? null,
    waitsOnId: task.waitsOnId ?? null,
    waitsOnIssueUrl: url ? url : null,
    companyId: task.companyId ?? null,
    noteSha256: noteSha256(task.bodyV2?.markdown),
  };
}

const BEFORE_KEYS: Array<keyof RowBefore> = [
  "status",
  "title",
  "dueAt",
  "assigneeId",
  "owes",
  "owesPersonId",
  "roomId",
  "waitsOnId",
  "waitsOnIssueUrl",
  "companyId",
  "noteSha256",
];

/** The fields where `stored` differs from `expected`, by name. */
export function differences(expected: RowBefore, stored: RowBefore): string[] {
  return BEFORE_KEYS.filter((key) => !sameInstant(key, expected[key], stored[key])).map(
    (key) =>
      `${key}: expected ${JSON.stringify(expected[key])}, stored ${JSON.stringify(stored[key])}`,
  );
}

function sameInstant(key: keyof RowBefore, a: string | null, b: string | null): boolean {
  if (key !== "dueAt" || a === null || b === null) return a === b;
  return Date.parse(a) === Date.parse(b);
}

export function waits(state: RowBefore): boolean {
  return !!state.waitsOnId || !!state.waitsOnIssueUrl;
}

/**
 * What the Task must read after the run. `roomDay` gives the day the store dates a Task on
 * when its room is that event (00:00 UTC of the event's Europe/Berlin day), or undefined when
 * the instance holds no such event.
 */
export function expectedAfter(
  row: MigrationRow,
  roomDay: (eventId: string) => string | undefined,
): RowBefore {
  const before = row.before;
  let dueAt = before.dueAt;
  if (waits(before)) dueAt = null;
  else if (row.after.roomId && row.after.roomId !== before.roomId) {
    dueAt = roomDay(row.after.roomId) ?? before.dueAt;
  }
  return {
    ...before,
    title: row.after.title,
    owes: row.after.owes,
    owesPersonId: row.after.owesPersonId,
    roomId: row.after.roomId,
    dueAt,
  };
}

/** The write a row needs, the fields it changes and nothing else. */
export function patchFor(row: MigrationRow): Record<string, unknown> {
  const { before, after } = row;
  const patch: Record<string, unknown> = {};
  if (after.title !== before.title) patch.title = after.title;
  if (after.owes !== before.owes) patch.owes = after.owes;
  if (after.owesPersonId !== before.owesPersonId) patch.owesPersonId = after.owesPersonId;
  if (after.roomId !== before.roomId) patch.roomId = after.roomId;
  if (waits(before) && before.dueAt !== null) patch.dueAt = null;
  return patch;
}

/**
 * Every problem with the record itself, before the instance is read: a Task named twice, an
 * `after` the store would not take, two open Tasks on one Company sharing a title.
 */
export function recordProblems(record: MigrationRecord): string[] {
  const problems: string[] = [];
  if (!Array.isArray(record?.rows) || record.rows.length === 0) {
    return ["the record has no rows"];
  }
  const seen = new Set<string>();
  const byCompanyTitle = new Map<string, string[]>();
  for (const row of record.rows) {
    const where = `row ${row?.id ?? "(no id)"}`;
    if (!row?.id || !row.before || !row.after) {
      problems.push(`${where} lacks its id, before or after`);
      continue;
    }
    if (seen.has(row.id)) problems.push(`${where} names a Task the record already names`);
    seen.add(row.id);
    const { before, after } = row;
    if (before.status === "DONE") {
      problems.push(`${where} is a done Task — no move but its reopening touches a closed Task`);
    }
    if (!after.title?.trim()) problems.push(`${where} leaves the Task with no title`);
    else if (after.title !== after.title.trim()) {
      problems.push(`${where}'s title has leading or trailing space`);
    }
    if (!OWES_VALUES.includes(after.owes as (typeof OWES_VALUES)[number])) {
      problems.push(
        `${where} leaves who owes ${JSON.stringify(after.owes)}, not HOUSE or OTHER_SIDE`,
      );
    }
    if (after.owesPersonId && after.owes !== "OTHER_SIDE") {
      problems.push(
        `${where} names who there on the house's side — who there is a Person on the other side`,
      );
    }
    if (after.roomId && waits(before)) {
      problems.push(
        `${where} waits and is given a room — a waiting Task carries no date, so no room's day`,
      );
    }
    if (before.roomId && after.roomId !== before.roomId) {
      problems.push(
        `${where} moves or clears a room it already had — the migration only names rooms titles named`,
      );
    }
    const key = `${before.companyId ?? "(no company)"}\u0000${titleKey(after.title)}`;
    byCompanyTitle.set(key, [...(byCompanyTitle.get(key) ?? []), row.id]);
  }
  for (const [key, ids] of byCompanyTitle) {
    if (ids.length > 1) {
      const [company, title] = key.split("\u0000");
      problems.push(
        `open Tasks ${ids.join(", ")} on Company ${company} would share the title "${title}"`,
      );
    }
  }
  return problems;
}

/**
 * Hold the instance's open Tasks to the record: every open Task has a row, every row an open
 * Task, and each stands as `before` (or already as its expected `after`). Returns the plan
 * per row, or the problems that refuse the run.
 */
export function planAgainst(
  record: MigrationRecord,
  open: MigrationTaskState[],
  roomDay: (eventId: string) => string | undefined,
): { plan: RowPlan[]; problems: string[] } {
  const problems: string[] = [];
  const stored = new Map(open.map((task) => [task.id, stateOf(task)]));
  const rowIds = new Set(record.rows.map((row) => row.id));
  for (const id of stored.keys()) {
    if (!rowIds.has(id)) problems.push(`open Task ${id} has no row in the record`);
  }
  const plan: RowPlan[] = [];
  for (const row of record.rows) {
    const now = stored.get(row.id);
    if (!now) {
      problems.push(`row ${row.id} names a Task that is not open on the instance`);
      continue;
    }
    if (row.after.roomId && !roomDay(row.after.roomId)) {
      problems.push(
        `row ${row.id} names room ${row.after.roomId}, which the instance holds no dated event for`,
      );
    }
    const patch = patchFor(row);
    if (Object.keys(patch).length === 0) {
      const off = differences(row.before, now);
      if (off.length > 0)
        problems.push(`Task ${row.id} no longer stands as the record read it: ${off.join("; ")}`);
      plan.push({ id: row.id, kind: "unchanged" });
      continue;
    }
    const offBefore = differences(row.before, now);
    if (offBefore.length === 0) {
      plan.push({ id: row.id, kind: "write", patch });
      continue;
    }
    if (differences(expectedAfter(row, roomDay), now).length === 0) {
      plan.push({ id: row.id, kind: "done" });
      continue;
    }
    problems.push(`Task ${row.id} no longer stands as the record read it: ${offBefore.join("; ")}`);
  }
  return { plan, problems };
}
