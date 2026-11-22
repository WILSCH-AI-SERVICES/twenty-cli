import { readFileSync } from "node:fs";

import { Command } from "commander";

import { CliError } from "../../utilities/errors/cli-error";
import {
  differences,
  expectedAfter,
  planAgainst,
  recordProblems,
  stateOf,
  type MigrationRecord,
  type MigrationTaskState,
} from "../../utilities/house-rules/task-migration";
import {
  appendClosingLine,
  checkTaskNote,
  closingLine,
  emitOpenNote,
  isAddress,
  labelProblem,
  parseIssueRef,
  quoteProblem,
  reasonProblem,
  reopenLines,
  reopenNote,
  restOnSent,
  CLOSED_SHAPE,
  type IssueRef,
} from "../../utilities/house-rules/task-note";
import {
  standingProblem,
  standingTasks,
  type StandingTask,
} from "../../utilities/house-rules/task-title";
import { REFUSED } from "../../utilities/house-rules/write-guard";
import { createCommandContext } from "../../utilities/shared/context";
import { applyGlobalOptions } from "../../utilities/shared/global-options";

type Services = Awaited<ReturnType<typeof createCommandContext>>["services"];
type GlobalOptions = Awaited<ReturnType<typeof createCommandContext>>["globalOptions"];

interface TaskCreateOptions {
  title?: string;
  restsOn?: string;
  restsOnLabel?: string;
  issue?: string;
  company?: string;
  opportunity?: string;
  due?: string;
  assignee?: string;
  waitsOn?: string;
  ticket?: string;
  owes?: string;
  owesPerson?: string;
  room?: string;
}

interface TaskNoteOptions {
  restsOn?: string;
  restsOnLabel?: string;
  issue?: string;
}

interface TaskCloseOptions {
  proof?: string;
  proofLabel?: string;
  proofLine?: string;
}

interface TaskSentOptions {
  sentMail?: string;
  sentOn?: string;
}

interface TaskClearOptions {
  clear?: boolean;
}

interface TaskRetargetOptions {
  addCompany?: string[];
  addOpportunity?: string[];
  addPerson?: string[];
  dropCompany?: string[];
  dropOpportunity?: string[];
  dropPerson?: string[];
}

type LinkValue = { primaryLinkUrl?: string | null; primaryLinkLabel?: string | null } | null;

type TaskRecord = {
  id: string;
  status?: string;
  title?: string;
  bodyV2?: { markdown?: string };
  dueAt?: string | null;
  assigneeId?: string | null;
  waitsOnId?: string | null;
  waitsOnIssue?: LinkValue;
  ticket?: string | null;
  owes?: string | null;
  owesPersonId?: string | null;
  roomId?: string | null;
  companyId?: string | null;
  createdAt?: string | null;
};

type TaskTarget = {
  id: string;
  taskId?: string;
  targetCompanyId?: string | null;
  targetOpportunityId?: string | null;
  targetPersonId?: string | null;
};

type CalendarEvent = {
  id: string;
  title?: string | null;
  startsAt?: string | null;
  deletedAt?: string | null;
};

/** The records a Task can be aimed at, as the target fields and REST paths name them. */
const TARGET_KINDS = [
  { kind: "company", field: "targetCompanyId", rest: "companies" },
  { kind: "opportunity", field: "targetOpportunityId", rest: "opportunities" },
  { kind: "person", field: "targetPersonId", rest: "people" },
] as const;
type TargetKind = (typeof TARGET_KINDS)[number]["kind"];

const OWES: Record<string, string> = { house: "HOUSE", "other-side": "OTHER_SIDE" };
const EMPTY_LINK = { primaryLinkUrl: "", primaryLinkLabel: "", secondaryLinks: [] };

function refuse(missing: string[], { afterRead = false } = {}): never {
  throw new CliError(
    `${afterRead ? "Refused after reading the instance, before any write" : "Refused before it reached the instance"}:\n  - ${missing.join("\n  - ")}`,
    REFUSED,
  );
}

const collect = (value: string, previous: string[] = []) => [...previous, value];

/**
 * The open note's parts as the operator passed them: what is missing or malformed is
 * pushed onto `missing`, and the note is returned only when nothing is.
 */
function openNoteFrom(options: TaskNoteOptions, missing: string[]): string | undefined {
  const before = missing.length;
  if (!options.restsOn) {
    missing.push(
      "the note is missing the address of the artifact the Task rests on — pass --rests-on <address of the mail or recording>",
    );
  } else if (!isAddress(options.restsOn)) {
    missing.push(`--rests-on "${options.restsOn}" is not an http(s) address`);
  }
  const label = labelProblem(options.restsOnLabel, "the artifact the Task rests on");
  if (label) missing.push(`${label} — pass --rests-on-label <what it is>`);
  let issue: IssueRef | undefined;
  if (options.issue !== undefined) {
    issue = parseIssueRef(options.issue);
    if (!issue) missing.push(`--issue "${options.issue}" is not owner/repo#N, #N or an issue URL`);
  }
  if (missing.length > before) return undefined;
  return emitOpenNote({ restsOnLabel: options.restsOnLabel!, restsOnUrl: options.restsOn!, issue });
}

/**
 * `twenty tasks` — the Task as A Task's Life Part 5 gives it: the note in the house's one
 * shape, and one command for every move the record allows (CCI#1341). The help lists them
 * all, so no move goes through the raw API.
 *
 *   create        write an open Task: its note (#3266), what it waits on and its ticket
 *                 (#3388), who owes it and its room (CCI#1341)
 *   note          rewrite an open Task's note into the one shape (#3276)
 *   close         mark it done, its note ending in the dated proof line, which quotes the line
 *                 that closed it: Closed DD.MM · proof: "the line" — [what it is](address)
 *                 (CCI#1363); a close without the quoted line is refused before any request
 *
 * The moves an open Task allows, each writing its own fields and nothing else (its *moves by*
 * is the eighth's sibling in A Task's Life Part 5, not yet a field on the instance):
 *
 *   set-due       a new date — refused on a Task whose room is booked (its date follows the
 *                 room's event; the refusal names the room) and on a Task that waits
 *   set-assignee  a new assignee, the workspace member who acts
 *   wait-on       the Task or the GitHub issue it waits on; the store clears its date
 *   set-ticket    its ticket at the counterparty
 *   set-room      its room, a synced calendar event; the store dates it on the event's day
 *   retarget      its targets: moved from one record onto another, or widened
 *   sent          the eighth move (CCI#1363): a Task written on a draft moved onto the sent
 *                 mail the draft became, in one write — the Rests on address alone changes in
 *                 the note, and its date is laid from the send: the send day plus the days the
 *                 writer gave it (old due date minus the day it was written, its createdAt in
 *                 Europe/Berlin). A Task whose room is booked keeps the room's date; a Task with
 *                 no date (one that waits) is given none
 *
 * And the one move a closed Task allows:
 *
 *   reopen        a close made in error undone on the same Task — back to to do, the closing
 *                 line kept as a dated line saying it was made in error and why
 *
 * And the one migration that brings the open Tasks to Part 5 (CCI#1342):
 *
 *   migrate       from its versioned before→after record: who owes and the room into their
 *                 fields, titles cut to what is owed, waiting Tasks undated — refused unless
 *                 every open Task stands as the record read it (utilities/house-rules/
 *                 task-migration.ts holds the checks)
 *
 * Every move refuses a Task that is done (Part 5: "no other move touches a closed Task")
 * and a record the instance does not hold, before anything is written; each re-reads the
 * Task after the write and prints what is stored. Whatever route a write takes, the
 * transport's guard (`utilities/house-rules/write-guard.ts`) refuses a note outside the
 * shape and a new title on an open Task, and the store beneath Twenty holds the same rules
 * (crm-2990-twenty `sql/`).
 *
 * The two moves the record refuses (CCI#1346, `utilities/house-rules/task-title.ts`), both
 * said in the help below since the help is where a session learns its moves:
 *
 *   a new title   an open Task is never re-titled, by any command or raw route
 *   a second Task `create`, and `reopen`, refuse an open Task whose title an open Task on
 *                 the same Company already carries, and print that Task: id, title, date
 */
const TITLE_RULES =
  "An open Task's title does not change: a changed owing closes the Task on its proof and writes the next one. A second open Task with the same title on a Company is refused (surrounding spaces aside), by create and by reopen, showing the Task that stands (its id, title and date); a Task closed with that title does not count.";

export function registerTasksCommand(program: Command): void {
  const tasks = program
    .command("tasks")
    .description(
      `Tasks with their note in the house's one shape, and every move a Task allows. An open Task: set-due, set-assignee, wait-on, set-ticket, set-room, retarget, and sent — a Task written on a draft moved onto the sent mail the draft became, its date laid from the send. A closed Task: reopen. A close ends the note in ${CLOSED_SHAPE}, the line that closed it quoted. ${TITLE_RULES}`,
    );
  applyGlobalOptions(tasks);

  const create = tasks
    .command("create")
    .description(
      `Write an open Task on a Company or an Opportunity, its note in the one shape. ${TITLE_RULES}`,
    )
    .option(
      "--title <text>",
      "What is owed, in one line — who owes it and its room go in their own flags",
    )
    .option("--rests-on <address>", "Address of the mail or recording the Task rests on")
    .option("--rests-on-label <text>", "What that artifact is, in a few words")
    .option("--issue <ref>", "The GitHub issue the work sits on: owner/repo#N, #N or its URL")
    .option("--company <id>", "The Company the Task is on")
    .option("--opportunity <id>", "The Opportunity the Task is on")
    .option("--due <date>", "Due date (ISO 8601); not with --room, whose event gives the date")
    .option("--assignee <workspaceMemberId>", "Who acts")
    .option("--waits-on <taskId>", "The Task this one waits on (it must exist)")
    .option("--ticket <number>", "Its ticket at the counterparty, e.g. 19966")
    .option("--owes <side>", "Who owes it: house or other-side")
    .option("--owes-person <personId>", "Who there owes it, a Person on the other side")
    .option("--room <calendarEventId>", "The room it waits for, a synced calendar event");
  applyGlobalOptions(create);

  create.action(async (_options: unknown, command: Command) => {
    const { globalOptions, services } = await createCommandContext(command);
    const options = command.opts() as TaskCreateOptions;

    const missing: string[] = [];
    if (!options.title?.trim()) missing.push("the Task has no title — pass --title, what is owed");
    const markdown = openNoteFrom(options, missing);
    if (!options.company === !options.opportunity) {
      missing.push("a Task stands on one record — pass exactly one of --company or --opportunity");
    }
    const ticket = options.ticket === undefined ? undefined : ticketFrom(options.ticket, missing);
    const waitsOn = options.waitsOn?.trim();
    if (options.waitsOn !== undefined && !waitsOn) {
      missing.push("--waits-on is empty — pass the id of the Task this one waits on");
    }
    const owes = options.owes === undefined ? undefined : owesFrom(options.owes, missing);
    const owesPerson = options.owesPerson?.trim();
    if (options.owesPerson !== undefined && !owesPerson) {
      missing.push("--owes-person is empty — pass the id of the Person who owes it");
    }
    if (owesPerson && owes !== "OTHER_SIDE") {
      missing.push("--owes-person names who there owes it — pass --owes other-side with it");
    }
    const room = options.room?.trim();
    if (options.room !== undefined && !room)
      missing.push("--room is empty — pass the calendar event's id");
    if (room && options.due) {
      missing.push("a Task with a room is due on the room's day — pass --room or --due, not both");
    }
    if (missing.length > 0) refuse(missing);

    const absent: string[] = [];
    if (waitsOn && !(await findTask(services, waitsOn))) {
      absent.push(`--waits-on names Task ${waitsOn}, which is not on the instance`);
    }
    if (owesPerson && !(await findRecord(services, "people", owesPerson))) {
      absent.push(`--owes-person names Person ${owesPerson}, which is not on the instance`);
    }
    if (room && !(await findEvent(services, room))) {
      absent.push(`--room names calendar event ${room}, which is not on the instance`);
    }
    // The Company the store will derive for this Task: its Company, else its Opportunity's.
    let companyId: string | undefined;
    if (options.company) {
      if (await findRecord(services, "companies", options.company)) companyId = options.company;
      else absent.push(`--company names Company ${options.company}, which is not on the instance`);
    } else {
      const opportunity = await findRecord(services, "opportunities", options.opportunity!);
      if (!opportunity) {
        absent.push(
          `--opportunity names Opportunity ${options.opportunity}, which is not on the instance`,
        );
      } else if (typeof opportunity.companyId === "string" && opportunity.companyId) {
        companyId = opportunity.companyId;
      }
    }
    if (absent.length > 0) refuse([...absent, "nothing was written"], { afterRead: true });

    if (companyId) {
      const standing = standingTasks(await companyTasks(services, companyId), options.title!);
      if (standing.length > 0) {
        refuse(standingProblem(standing, companyId, `a new open Task "${options.title!.trim()}"`), {
          afterRead: true,
        });
      }
    }

    const data: Record<string, unknown> = {
      title: options.title!.trim(),
      status: "TODO",
      bodyV2: { markdown: markdown! },
    };
    if (options.due) data.dueAt = options.due;
    if (options.assignee) data.assigneeId = options.assignee;
    if (waitsOn) data.waitsOnId = waitsOn;
    if (ticket !== undefined) data.ticket = ticket;
    if (owes) data.owes = owes;
    if (owesPerson) data.owesPersonId = owesPerson;
    if (room) data.roomId = room;

    const created = (await services.records.create("tasks", data)) as TaskRecord;
    await services.records.create("taskTargets", {
      taskId: created.id,
      ...(options.company
        ? { targetCompanyId: options.company }
        : { targetOpportunityId: options.opportunity }),
    });

    await renderStored(services, created.id, globalOptions);
  });

  const note = tasks
    .command("note")
    .description(
      "Rewrite an open Task's note into the one shape: Rests on: [what it is](address), and the issue",
    )
    .argument("<id>", "The Task's id")
    .option("--rests-on <address>", "Address of the mail or recording the Task rests on")
    .option("--rests-on-label <text>", "What that artifact is, in a few words")
    .option("--issue <ref>", "The GitHub issue the work sits on: owner/repo#N, #N or its URL");
  applyGlobalOptions(note);

  note.action(async (id: string, _options: unknown, command: Command) => {
    const { globalOptions, services } = await createCommandContext(command);
    const options = command.opts() as TaskNoteOptions;

    const missing: string[] = [];
    const markdown = openNoteFrom(options, missing);
    if (missing.length > 0) refuse([...missing, `Task ${id}'s note is unchanged`]);

    const stored = await readTask(services, id);
    if (stored.status === "DONE") {
      refuse([
        `Task ${id} is done — its note ends in its proof line, and a rewrite would lose it; the note is unchanged`,
      ]);
    }

    // A close made in error stays in the note, whatever else is rewritten (CCI#1341).
    const kept = reopenLines(stored.bodyV2?.markdown);
    await services.records.update("tasks", id, {
      bodyV2: { markdown: [markdown!, ...kept].join("\n\n") },
    });

    await renderStored(services, id, globalOptions);
  });

  const close = tasks
    .command("close")
    .description(
      `Mark a Task done, its note ending in ${CLOSED_SHAPE}: the sentence that closed it, quoted (--proof-line), and the artifact that holds it (--proof-label, --proof). A close without all three is refused before anything is sent.`,
    )
    .argument("<id>", "The Task's id")
    .option("--proof <address>", "Address of the artifact that closed it")
    .option("--proof-label <text>", "What that artifact is, in a few words")
    .option(
      "--proof-line <text>",
      'The line in it that closed the Task, quoted as it stands — it lands in quotes before the link: proof: "the line" — [what it is](address)',
    );
  applyGlobalOptions(close);

  close.action(async (id: string, _options: unknown, command: Command) => {
    const { globalOptions, services } = await createCommandContext(command);
    const options = command.opts() as TaskCloseOptions;

    const missing: string[] = [];
    const quote = quoteProblem(options.proofLine);
    if (quote) {
      missing.push(`${quote} — pass --proof-line <the line, as it stands>; the Task stays open`);
    }
    if (!options.proof) {
      missing.push(
        "the close is missing its proof — pass --proof <address of what closed it>; the Task stays open",
      );
    } else if (!isAddress(options.proof)) {
      missing.push(`--proof "${options.proof}" is not an http(s) address; the Task stays open`);
    }
    const label = labelProblem(options.proofLabel, "the proof");
    if (label) missing.push(`${label} — pass --proof-label <what it is>`);
    if (missing.length > 0) refuse(missing);

    const stored = await readTask(services, id);
    if (stored.status === "DONE") {
      throw new CliError(`Task ${id} is already done.`, "INVALID_ARGUMENTS");
    }
    const note = stored.bodyV2?.markdown ?? "";
    const problems = checkTaskNote(note, { done: false });
    if (problems.length > 0) {
      refuse([
        `Task ${id}'s note is not in the one shape, so the proof line has nowhere to land:`,
        ...problems,
      ]);
    }

    await services.records.update("tasks", id, {
      status: "DONE",
      bodyV2: {
        markdown: appendClosingLine(
          note,
          closingLine({
            line: options.proofLine!,
            label: options.proofLabel!,
            url: options.proof!,
          }),
        ),
      },
    });

    await renderStored(services, id, globalOptions);
  });

  const reopen = tasks
    .command("reopen")
    .description(
      "Undo a close made in error on the same Task: back to to do, the wrong close kept in its note as a dated line saying why",
    )
    .argument("<id>", "The done Task's id")
    .option("--why <reason>", "Why the close was made in error, in one line");
  applyGlobalOptions(reopen);

  reopen.action(async (id: string, _options: unknown, command: Command) => {
    const { globalOptions, services } = await createCommandContext(command);
    const { why } = command.opts() as { why?: string };

    const reason = reasonProblem(why);
    if (reason) refuse([reason, `Task ${id} is unchanged`]);

    const stored = await readTask(services, id);
    if (stored.status !== "DONE") {
      refuse([`Task ${id} is not done — there is no close to undo; it is unchanged`], {
        afterRead: true,
      });
    }
    const reopened = reopenNote(stored.bodyV2?.markdown ?? "", why!);
    if (!reopened.markdown) {
      refuse([...reopened.problems, `Task ${id} is unchanged`], { afterRead: true });
    }
    // Reopened, it is an open Task: it may not stand beside an open one with its title.
    if (stored.companyId) {
      const standing = standingTasks(
        await companyTasks(services, stored.companyId),
        stored.title ?? "",
        id,
      );
      if (standing.length > 0) {
        refuse(
          [
            ...standingProblem(
              standing,
              stored.companyId,
              `reopening Task ${id} "${stored.title ?? ""}"`,
            ),
            `Task ${id} stays done`,
          ],
          { afterRead: true },
        );
      }
    }

    await services.records.update("tasks", id, {
      status: "TODO",
      bodyV2: { markdown: reopened.markdown! },
    });

    await renderStored(services, id, globalOptions);
  });

  const setDue = tasks
    .command("set-due")
    .description(
      "Give an open Task a new date — refused on a Task whose room is booked, since its date follows the room's event",
    )
    .argument("<id>", "The Task's id")
    .argument("<date>", "The new day, YYYY-MM-DD");
  applyGlobalOptions(setDue);

  setDue.action(async (id: string, date: string, _options: unknown, command: Command) => {
    const { globalOptions, services } = await createCommandContext(command);

    const day = date.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(`${day}T00:00:00Z`))) {
      refuse([`"${date}" is not a day — pass YYYY-MM-DD; Task ${id} is unchanged`]);
    }

    const stored = await openTask(services, id);
    const wait = waitOf(stored);
    if (wait) {
      refuse(
        [
          `Task ${id} waits on ${wait} and carries no date while it waits — clear the wait with twenty tasks wait-on ${id} --clear first; it is unchanged`,
        ],
        { afterRead: true },
      );
    }
    if (stored.roomId) {
      const event = await findEvent(services, stored.roomId);
      const roomDay = event ? berlinDay(event.startsAt) : undefined;
      if (event && roomDay) {
        refuse(
          [
            `Task ${id}'s date follows its room, "${event.title ?? "(untitled)"}" on ${roomDay} (calendar event ${event.id}) — move the event, or carry the Task to another room with twenty tasks set-room; nothing was written`,
          ],
          { afterRead: true },
        );
      }
    }

    await services.records.update("tasks", id, { dueAt: `${day}T00:00:00.000Z` });

    await renderStored(services, id, globalOptions);
  });

  const setAssignee = tasks
    .command("set-assignee")
    .description(
      "Give an open Task a new assignee, the workspace member who acts, or clear it with --clear",
    )
    .argument("<id>", "The Task's id")
    .argument("[workspaceMemberId]", "The workspace member who acts")
    .option("--clear", "Clear it: nobody at the house is named");
  applyGlobalOptions(setAssignee);

  setAssignee.action(
    async (id: string, memberArg: string | undefined, _options: unknown, command: Command) => {
      const { globalOptions, services } = await createCommandContext(command);
      const options = command.opts() as TaskClearOptions;

      const member = memberArg?.trim() || undefined;
      if (!!options.clear === !!member) {
        refuse([
          `pass either the workspace member or --clear, not ${options.clear ? "both" : "neither"}; Task ${id} is unchanged`,
        ]);
      }

      await openTask(services, id);
      if (member && !(await findRecord(services, "workspaceMembers", member))) {
        refuse([`workspace member ${member} is not on the instance; Task ${id} is unchanged`], {
          afterRead: true,
        });
      }

      await services.records.update("tasks", id, { assigneeId: member ?? null });

      await renderStored(services, id, globalOptions);
    },
  );

  const waitOn = tasks
    .command("wait-on")
    .description(
      "Name the Task or GitHub issue this Task waits on, which clears its date, or clear the wait with --clear",
    )
    .argument("<id>", "The Task that waits")
    .argument(
      "[waitsOn]",
      "The Task it waits on (its id), or a GitHub issue: owner/repo#N or its URL",
    )
    .option("--clear", "Clear it: the Task waits on nothing");
  applyGlobalOptions(waitOn);

  waitOn.action(
    async (id: string, waitsOnArg: string | undefined, _options: unknown, command: Command) => {
      const { globalOptions, services } = await createCommandContext(command);
      const options = command.opts() as TaskClearOptions;

      const target = waitsOnArg?.trim() || undefined;
      if (!!options.clear === !!target) {
        refuse([
          `pass either the Task or issue ${id} waits on or --clear, not ${options.clear ? "both" : "neither"}; Task ${id} is unchanged`,
        ]);
      }
      if (target === id) refuse([`Task ${id} cannot wait on itself; it is unchanged`]);
      const issue = target ? waitIssueFrom(target) : undefined;

      await openTask(services, id);
      if (target && !issue && !(await findTask(services, target))) {
        refuse(
          [
            `${target} is neither a Task on the instance nor a GitHub issue (owner/repo#N or its URL); Task ${id} is unchanged`,
          ],
          { afterRead: true },
        );
      }

      // One wait at a time: naming one clears the other in the same write.
      await services.records.update("tasks", id, {
        waitsOnId: target && !issue ? target : null,
        waitsOnIssue: issue
          ? {
              primaryLinkUrl: `https://github.com/${issue.owner}/${issue.repo}/issues/${issue.number}`,
              primaryLinkLabel: `${issue.owner}/${issue.repo}#${issue.number}`,
              secondaryLinks: [],
            }
          : EMPTY_LINK,
      });

      await renderStored(services, id, globalOptions);
    },
  );

  const setTicket = tasks
    .command("set-ticket")
    .description("Set the Task's ticket at the counterparty, or clear it with --clear")
    .argument("<id>", "The Task's id")
    .argument("[ticket]", "The ticket number at the counterparty, e.g. 19966")
    .option("--clear", "Clear it: the ticket field left empty");
  applyGlobalOptions(setTicket);

  setTicket.action(
    async (id: string, ticketArg: string | undefined, _options: unknown, command: Command) => {
      const { globalOptions, services } = await createCommandContext(command);
      const options = command.opts() as TaskClearOptions;

      const missing: string[] = [];
      if (!!options.clear === (ticketArg !== undefined)) {
        missing.push(
          `pass either the ticket or --clear, not ${options.clear ? "both" : "neither"}`,
        );
      }
      const ticket = ticketArg === undefined ? "" : ticketFrom(ticketArg, missing);
      if (missing.length > 0) refuse([...missing, `Task ${id} is unchanged`]);

      await openTask(services, id);
      await services.records.update("tasks", id, { ticket });

      await renderStored(services, id, globalOptions);
    },
  );

  const setRoom = tasks
    .command("set-room")
    .description(
      "Give an open Task its room, a synced calendar event whose day becomes its date, or clear it with --clear",
    )
    .argument("<id>", "The Task's id")
    .argument("[calendarEventId]", "The room's calendar event")
    .option("--clear", "Clear it: the Task keeps the day it last had");
  applyGlobalOptions(setRoom);

  setRoom.action(
    async (id: string, eventArg: string | undefined, _options: unknown, command: Command) => {
      const { globalOptions, services } = await createCommandContext(command);
      const options = command.opts() as TaskClearOptions;

      const event = eventArg?.trim() || undefined;
      if (!!options.clear === !!event) {
        refuse([
          `pass either the calendar event or --clear, not ${options.clear ? "both" : "neither"}; Task ${id} is unchanged`,
        ]);
      }

      await openTask(services, id);
      if (event && !(await findEvent(services, event))) {
        refuse([`calendar event ${event} is not on the instance; Task ${id} is unchanged`], {
          afterRead: true,
        });
      }

      await services.records.update("tasks", id, { roomId: event ?? null });

      await renderStored(services, id, globalOptions);
    },
  );

  const retarget = tasks
    .command("retarget")
    .description(
      "Move an open Task's targets from one record onto another, or widen it to another record the same act serves",
    )
    .argument("<id>", "The Task's id")
    .option("--add-company <id>", "Aim it at this Company too (repeatable)", collect)
    .option("--add-opportunity <id>", "Aim it at this Opportunity too (repeatable)", collect)
    .option("--add-person <id>", "Aim it at this Person too (repeatable)", collect)
    .option("--drop-company <id>", "Take this Company off its targets (repeatable)", collect)
    .option(
      "--drop-opportunity <id>",
      "Take this Opportunity off its targets (repeatable)",
      collect,
    )
    .option("--drop-person <id>", "Take this Person off its targets (repeatable)", collect);
  applyGlobalOptions(retarget);

  retarget.action(async (id: string, _options: unknown, command: Command) => {
    const { globalOptions, services } = await createCommandContext(command);
    const options = command.opts() as TaskRetargetOptions;

    const adds: Array<{ kind: TargetKind; id: string }> = [];
    const drops: Array<{ kind: TargetKind; id: string }> = [];
    for (const { kind } of TARGET_KINDS) {
      const cap = kind[0]!.toUpperCase() + kind.slice(1);
      for (const value of options[`add${cap}` as keyof TaskRetargetOptions] ?? []) {
        adds.push({ kind, id: value.trim() });
      }
      for (const value of options[`drop${cap}` as keyof TaskRetargetOptions] ?? []) {
        drops.push({ kind, id: value.trim() });
      }
    }
    const missing: string[] = [];
    if (adds.length + drops.length === 0) {
      missing.push(
        "name a target to add or to drop — --add-company, --add-opportunity, --add-person, --drop-company, --drop-opportunity or --drop-person",
      );
    }
    if ([...adds, ...drops].some((t) => !t.id)) missing.push("a target id is empty");
    if (missing.length > 0) refuse([...missing, `Task ${id} is unchanged`]);

    await openTask(services, id);
    const targets = await listTargets(services, id);
    const fieldOf = (kind: TargetKind) => TARGET_KINDS.find((k) => k.kind === kind)!.field;
    const holding = (t: { kind: TargetKind; id: string }) =>
      targets.find((target) => target[fieldOf(t.kind)] === t.id);

    const problems: string[] = [];
    for (const drop of drops) {
      if (!holding(drop)) problems.push(`Task ${id} is not aimed at ${drop.kind} ${drop.id}`);
    }
    for (const add of adds) {
      if (holding(add)) {
        problems.push(`Task ${id} is already aimed at ${add.kind} ${add.id}`);
      } else {
        const rest = TARGET_KINDS.find((k) => k.kind === add.kind)!.rest;
        if (!(await findRecord(services, rest, add.id))) {
          problems.push(`${add.kind} ${add.id} is not on the instance`);
        }
      }
    }
    if (targets.length - drops.length + adds.length < 1) {
      problems.push(`a Task stands on at least one record — Task ${id} would be aimed at none`);
    }
    if (problems.length > 0) refuse([...problems, `Task ${id} is unchanged`], { afterRead: true });

    // Adds first, so the Task is never aimed at nothing between two writes.
    for (const add of adds) {
      await services.records.create("taskTargets", { taskId: id, [fieldOf(add.kind)]: add.id });
    }
    for (const drop of drops) {
      await services.records.delete("taskTargets", holding(drop)!.id);
    }

    await renderStored(services, id, globalOptions);
  });

  const sent = tasks
    .command("sent")
    .description(
      "The eighth move: an open Task written on a draft, moved onto the sent mail the draft became, in one write. Its note rests on the sent mail, nothing else in it changed, and its date is laid from the send — due the send day plus the days that stood between the day the Task was written and its old due date, so the wait its writer chose is kept. A Task whose room is booked keeps the room's date and only its note moves; a Task with no date, one that waits, is given none; a closed Task is refused.",
    )
    .argument("<id>", "The Task's id")
    .option("--sent-mail <address>", "Address of the sent mail the draft became")
    .option("--sent-on <date>", "The day it was sent, YYYY-MM-DD (Europe/Berlin)");
  applyGlobalOptions(sent);

  sent.action(async (id: string, _options: unknown, command: Command) => {
    const { globalOptions, services } = await createCommandContext(command);
    const options = command.opts() as TaskSentOptions;

    const missing: string[] = [];
    if (!options.sentMail) {
      missing.push("the move is missing the sent mail — pass --sent-mail <its address>");
    } else if (!isAddress(options.sentMail)) {
      missing.push(`--sent-mail "${options.sentMail}" is not an http(s) address`);
    }
    const sentOn = options.sentOn?.trim();
    if (!sentOn) {
      missing.push("the move is missing the day the mail was sent — pass --sent-on YYYY-MM-DD");
    } else if (!isDay(sentOn)) {
      missing.push(`--sent-on "${options.sentOn}" is not a day — pass YYYY-MM-DD`);
    }
    if (missing.length > 0) refuse([...missing, `Task ${id} is unchanged`]);

    const stored = await openTask(services, id);
    const moved = restOnSent(stored.bodyV2?.markdown ?? "", options.sentMail!);
    if (!moved.markdown) {
      refuse([...moved.problems, `Task ${id} is unchanged`], { afterRead: true });
    }
    const shape = checkTaskNote(moved.markdown, { done: false });
    if (shape.length > 0) {
      refuse([`Task ${id}'s note is not in the one shape, so it cannot be moved:`, ...shape], {
        afterRead: true,
      });
    }

    const written = berlinDay(stored.createdAt);
    const problems: string[] = [];
    if (!written) problems.push(`Task ${id} carries no day it was written (createdAt)`);
    else if (sentOn! < written) {
      problems.push(
        `--sent-on ${sentOn} is before the day Task ${id} was written (${written}) — a draft is sent after the Task written on it`,
      );
    }
    if (sentOn! > berlinDay(new Date().toISOString())!) {
      problems.push(`--sent-on ${sentOn} is after today — a mail not yet sent has no send day`);
    }
    if (problems.length > 0) refuse([...problems, `Task ${id} is unchanged`], { afterRead: true });

    // Its date: a booked room's event holds it; a Task with no date (it waits) is given none;
    // otherwise the wait its writer chose, laid from the send.
    const event = stored.roomId ? await findEvent(services, stored.roomId) : undefined;
    const booked = !!(event && berlinDay(event.startsAt));
    const dueDay = stored.dueAt ? stored.dueAt.slice(0, 10) : undefined;
    const data: Record<string, unknown> = { bodyV2: { markdown: moved.markdown! } };
    if (!booked && dueDay && isDay(dueDay)) {
      data.dueAt = `${addDays(sentOn!, daysBetween(written!, dueDay))}T00:00:00.000Z`;
    }

    // One write: the note and the date land together or not at all.
    await services.records.update("tasks", id, data);

    await renderStored(services, id, globalOptions);
  });

  const migrate = tasks
    .command("migrate")
    .description(
      "Run the one migration of A Task's Life Part 5 from its before→after record: who owes and the room into their fields, titles cut to what is owed, waiting Tasks undated — refused unless every open Task stands as the record read it",
    )
    .requiredOption("--record <path>", "The before→after record (JSON), at a pushed commit")
    .option("--dry-run", "Check the record against the instance and print the plan; write nothing");
  applyGlobalOptions(migrate);

  migrate.action(async (_options: unknown, command: Command) => {
    const { globalOptions, services } = await createCommandContext(command);
    const options = command.opts() as { record: string; dryRun?: boolean };

    let record: MigrationRecord;
    try {
      record = JSON.parse(readFileSync(options.record, "utf8")) as MigrationRecord;
    } catch (error) {
      refuse([
        `the record ${options.record} could not be read as JSON: ${(error as Error).message}`,
      ]);
    }
    const own = recordProblems(record!);
    if (own.length > 0) refuse([...own, "nothing was written"]);

    const roomDays = new Map<string, string | undefined>();
    for (const row of record!.rows) {
      const eventId = row.after.roomId;
      if (eventId && !roomDays.has(eventId)) {
        const day = berlinDay((await findEvent(services, eventId))?.startsAt);
        roomDays.set(eventId, day ? `${day}T00:00:00.000Z` : undefined);
      }
    }
    const roomDay = (eventId: string) => roomDays.get(eventId);

    const open = await listOpenTasks(services);
    const people = new Set<string>();
    const absent: string[] = [];
    for (const row of record!.rows) {
      const person = row.after.owesPersonId;
      if (person && person !== row.before.owesPersonId && !people.has(person)) {
        if (await findRecord(services, "people", person)) people.add(person);
        else absent.push(`row ${row.id} names who there ${person}, a Person not on the instance`);
      }
    }
    const { plan, problems } = planAgainst(record!, open, roomDay);
    if (absent.length + problems.length > 0) {
      refuse([...absent, ...problems, "nothing was written"], { afterRead: true });
    }

    const written: string[] = [];
    if (!options.dryRun) {
      for (const step of plan) {
        if (step.kind !== "write") continue;
        await services.records.update("tasks", step.id, step.patch);
        written.push(step.id);
      }
    }

    // A fresh read of every Task the record names, held to the row it should now stand as.
    const after = new Map((await listOpenTasks(services)).map((task) => [task.id, stateOf(task)]));
    const rows = record!.rows.map((row) => {
      const step = plan.find((p) => p.id === row.id)!;
      const expected =
        options.dryRun && step.kind === "write" ? row.before : expectedAfter(row, roomDay);
      const now = after.get(row.id);
      const off = now ? differences(expected, now) : ["the Task is no longer open"];
      return {
        id: row.id,
        step: options.dryRun && step.kind === "write" ? "would-write" : step.kind,
        patch: step.kind === "write" ? step.patch : undefined,
        title: now?.title ?? null,
        off,
      };
    });
    const failed = rows.filter((row) => row.off.length > 0);
    await services.output.render(
      {
        record: options.record,
        dryRun: !!options.dryRun,
        openBefore: open.length,
        openAfter: after.size,
        written: written.length,
        alreadyDone: plan.filter((p) => p.kind === "done").length,
        unchanged: plan.filter((p) => p.kind === "unchanged").length,
        failed: failed.length,
        rows,
      },
      { format: globalOptions.output, query: globalOptions.query },
    );
    if (failed.length > 0 || after.size !== open.length) {
      throw new CliError(
        `${failed.length} Task(s) do not read back as the record says, or the count of open Tasks moved (${open.length} → ${after.size})`,
        "VERIFICATION_FAILED",
      );
    }
  });
}

/** Every Task that is not done, as stored, with the fields the migration record names. */
async function listOpenTasks(services: Services): Promise<MigrationTaskState[]> {
  const all = await services.records.listAll("tasks", { limit: 200 });
  return (all.data as MigrationTaskState[]).filter((task) => task.status !== "DONE");
}

/**
 * Every Task on a Company as the store derives it (`task.companyId`, crm-2990-twenty
 * `sql/task-company.sql`), open or done; `standingTasks` picks the open ones.
 */
async function companyTasks(services: Services, companyId: string): Promise<StandingTask[]> {
  const all = await services.records.listAll("tasks", {
    filter: `companyId[eq]:"${companyId}"`,
    limit: 200,
  });
  return all.data as StandingTask[];
}

/** The ticket as it will be stored, trimmed; a blank one is pushed onto `missing`. */
function ticketFrom(raw: string, missing: string[]): string {
  const ticket = raw.trim();
  if (!ticket) missing.push("the ticket is empty — pass the counterparty's ticket number");
  return ticket;
}

/** `house` or `other-side` as the field stores it; anything else is pushed onto `missing`. */
function owesFrom(raw: string, missing: string[]): string | undefined {
  const owes = OWES[raw.trim().toLowerCase()];
  if (!owes) missing.push(`--owes "${raw}" is neither house nor other-side`);
  return owes;
}

/** A GitHub issue a Task waits on: owner/repo#N or its github.com address, never a bare N. */
function waitIssueFrom(value: string): IssueRef | undefined {
  if (!/^(https:\/\/github\.com\/|[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+#\d+$)/.test(value)) {
    return undefined;
  }
  return parseIssueRef(value);
}

/** What a Task waits on, as a reader names it, or undefined when it waits on nothing. */
function waitOf(task: TaskRecord): string | undefined {
  if (task.waitsOnId) return `Task ${task.waitsOnId}`;
  const url = task.waitsOnIssue?.primaryLinkUrl;
  if (url) return task.waitsOnIssue?.primaryLinkLabel || url;
  return undefined;
}

/** Whether `value` is a calendar day, YYYY-MM-DD. */
function isDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** The days from one calendar day to another, YYYY-MM-DD each; negative when `to` is earlier. */
function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
}

/** The calendar day `days` after `day`, YYYY-MM-DD. */
function addDays(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
}

/** The Europe/Berlin calendar day of an instant, YYYY-MM-DD; the house's day (Part 3). */
function berlinDay(instant: string | null | undefined): string | undefined {
  if (!instant) return undefined;
  const date = new Date(instant);
  if (Number.isNaN(date.getTime())) return undefined;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/** One record by its REST path and id, or undefined when the instance holds none. */
async function findRecord(
  services: Services,
  rest: string,
  id: string,
): Promise<Record<string, unknown> | undefined> {
  try {
    const response = await services.api.get<{ data?: Record<string, unknown> }>(
      `/rest/${rest}/${encodeURIComponent(id)}`,
    );
    const record = Object.values(response.data?.data ?? {})[0];
    return record && typeof record === "object" ? (record as Record<string, unknown>) : undefined;
  } catch (error) {
    const status = (error as { response?: { status?: number } }).response?.status;
    if (status === 404 || status === 400) return undefined;
    throw error;
  }
}

/** The Task as stored, or undefined when the instance holds none by that id. */
async function findTask(services: Services, id: string): Promise<TaskRecord | undefined> {
  return (await findRecord(services, "tasks", id)) as TaskRecord | undefined;
}

/** A calendar event the instance holds and has not deleted, or undefined. */
async function findEvent(services: Services, id: string): Promise<CalendarEvent | undefined> {
  const event = (await findRecord(services, "calendarEvents", id)) as CalendarEvent | undefined;
  return event && !event.deletedAt ? event : undefined;
}

async function readTask(services: Services, id: string): Promise<TaskRecord> {
  const task = await findTask(services, id);
  if (!task) throw new CliError(`No Task ${id} on the instance.`, "INVALID_ARGUMENTS");
  return task;
}

/** The Task, refused when it is done: a closed Task allows its reopening and nothing else. */
async function openTask(services: Services, id: string): Promise<TaskRecord> {
  const task = await readTask(services, id);
  if (task.status === "DONE") {
    refuse(
      [
        `Task ${id} is done — a closed Task allows one move, its reopening (twenty tasks reopen ${id} --why <reason>); it is unchanged`,
      ],
      { afterRead: true },
    );
  }
  return task;
}

async function listTargets(services: Services, taskId: string): Promise<TaskTarget[]> {
  const response = await services.api.get<{ data?: { taskTargets?: TaskTarget[] } }>(
    `/rest/taskTargets`,
    { params: { filter: `taskId[eq]:${taskId}`, limit: 200 } },
  );
  return response.data?.data?.taskTargets ?? [];
}

/** Print the Task as the instance now stores it — a fresh read, never the write's echo. */
async function renderStored(
  services: Services,
  id: string,
  globalOptions: GlobalOptions,
): Promise<void> {
  const task = await readTask(services, id);
  const waitsOn = task.waitsOnId ? await findTask(services, task.waitsOnId) : undefined;
  const room = task.roomId ? await findEvent(services, task.roomId) : undefined;
  const targets = await listTargets(services, id);
  await services.output.render(
    {
      id: task.id,
      title: task.title,
      status: task.status,
      createdAt: task.createdAt ?? null,
      dueAt: task.dueAt ?? null,
      assigneeId: task.assigneeId ?? null,
      owes: task.owes ?? null,
      owesPersonId: task.owesPersonId ?? null,
      room: task.roomId
        ? {
            id: task.roomId,
            title: room?.title ?? null,
            startsAt: room?.startsAt ?? null,
            day: berlinDay(room?.startsAt) ?? null,
          }
        : null,
      waitsOn: task.waitsOnId ? { id: task.waitsOnId, title: waitsOn?.title ?? null } : null,
      waitsOnIssue: task.waitsOnIssue?.primaryLinkUrl
        ? {
            url: task.waitsOnIssue.primaryLinkUrl,
            label: task.waitsOnIssue.primaryLinkLabel ?? null,
          }
        : null,
      ticket: task.ticket || null,
      targets: targets.map((target) => {
        const kind = TARGET_KINDS.find((k) => target[k.field]);
        return kind
          ? { kind: kind.kind, id: target[kind.field] as string, taskTargetId: target.id }
          : { kind: "other", id: null, taskTargetId: target.id };
      }),
      note: task.bodyV2?.markdown ?? null,
    },
    { format: globalOptions.output, query: globalOptions.query },
  );
}
