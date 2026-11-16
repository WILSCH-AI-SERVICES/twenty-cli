/**
 * The two refusals a Task's title carries (CCI#1346), as pure checks the tool runs before
 * the store has to (CCI#1345 holds the same two beneath Twenty, from every writer):
 *
 *   - an open Task is never re-titled. Twenty as the System of Record Part 4: "a changed owing
 *     closes the Task on its proof and writes the next one" (The Settle's Queue Part 1). The
 *     write guard (`write-guard.ts`) runs `titleChangeProblem` on every Task write any route
 *     sends, raw `api` commands included;
 *   - a second open Task with the same title on one Company is refused, and the tool shows the
 *     Task that already stands — its id, its title and its date — and writes nothing. Part 4:
 *     "the refusal of a second open Task keys on the title alone", and "a Task closed earlier
 *     with the same title does not count". The Company is the one the store derives for each
 *     Task (crm-2990-twenty `sql/task-company.sql`): its Company target, else its Opportunity's
 *     Company, else its Person's. `twenty tasks create` and `twenty tasks reopen` run
 *     `standingProblem` against that Company's open Tasks before any write.
 *
 * Titles compare as `titleKey` reads them — trimmed, case folded — the same key the one
 * migration held its record to (`task-migration.ts`, `recordProblems`).
 */

/** A title as the second-Task refusal compares it. */
export function titleKey(title: unknown): string {
  return typeof title === "string" ? title.trim().toLowerCase() : "";
}

/** The sentence every re-title refusal carries, whichever route sent it. */
export const RETITLE_RULE =
  "an open Task's title does not change — a changed owing closes this Task on its proof (twenty tasks close) and writes the next one (twenty tasks create)";

/**
 * The refusal of a write that changes an open Task's title, or undefined when the write leaves
 * the title as it stood. A Task is open when it is not DONE before the write or after it — so a
 * close and a reopening carry no new title either.
 */
export function titleChangeProblem(
  id: string,
  data: Record<string, unknown>,
  stored: Record<string, unknown>,
): string | undefined {
  if (!("title" in data)) return undefined;
  const before = typeof stored.title === "string" ? stored.title : "";
  const after = typeof data.title === "string" ? data.title : "";
  if (after === before) return undefined;
  const statusAfter = "status" in data ? data.status : stored.status;
  const open = stored.status !== "DONE" || statusAfter !== "DONE";
  if (!open) return undefined;
  return `Task ${id} reads "${before}" — ${RETITLE_RULE}; nothing was written`;
}

export interface StandingTask {
  id: string;
  title?: string | null;
  status?: string | null;
  dueAt?: string | null;
  companyId?: string | null;
}

/** The open Tasks among `tasks` whose title matches `title`, `exceptId` left out. */
export function standingTasks(
  tasks: StandingTask[],
  title: string,
  exceptId?: string,
): StandingTask[] {
  const key = titleKey(title);
  return tasks.filter(
    (task) => task.id !== exceptId && task.status !== "DONE" && titleKey(task.title) === key,
  );
}

/** A stored instant as the day it names (dates are stored at 00:00 UTC of the day). */
function dayOf(dueAt: string | null | undefined): string {
  if (!dueAt) return "no date";
  const date = new Date(dueAt);
  return Number.isNaN(date.getTime()) ? dueAt : `due ${date.toISOString().slice(0, 10)}`;
}

/**
 * The refusal of a second open Task, showing each Task that stands: its id, its title and its
 * date. `subject` names the write refused, e.g. "a new open Task" or "reopening Task X".
 */
export function standingProblem(
  standing: StandingTask[],
  companyId: string,
  subject: string,
): string[] {
  return [
    `${subject} would be a second open Task with that title on Company ${companyId} — a second open Task with the same title on a Company is refused; the Task that stands:`,
    ...standing.map((task) => `Task ${task.id} · "${task.title ?? ""}" · ${dayOf(task.dueAt)}`),
    "nothing was written — if the new ask names a later day, move that Task's date with twenty tasks set-due <id> <YYYY-MM-DD>",
  ];
}
