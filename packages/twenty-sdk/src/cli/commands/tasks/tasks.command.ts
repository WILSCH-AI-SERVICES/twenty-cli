import { Command } from "commander";

import { CliError } from "../../utilities/errors/cli-error";
import {
  appendClosingLine,
  checkTaskNote,
  closingLine,
  emitOpenNote,
  isAddress,
  labelProblem,
  parseIssueRef,
  type IssueRef,
} from "../../utilities/house-rules/task-note";
import { REFUSED } from "../../utilities/house-rules/write-guard";
import { createCommandContext } from "../../utilities/shared/context";
import { applyGlobalOptions } from "../../utilities/shared/global-options";

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
}

interface TaskNoteOptions {
  restsOn?: string;
  restsOnLabel?: string;
  issue?: string;
}

interface TaskCloseOptions {
  proof?: string;
  proofLabel?: string;
}

interface TaskClearOptions {
  clear?: boolean;
}

type TaskRecord = {
  id: string;
  status?: string;
  title?: string;
  bodyV2?: { markdown?: string };
  waitsOnId?: string | null;
  ticket?: string | null;
};

function refuse(missing: string[], { afterRead = false } = {}): never {
  throw new CliError(
    `${afterRead ? "Refused after reading the instance, before any write" : "Refused before it reached the instance"}:\n  - ${missing.join("\n  - ")}`,
    REFUSED,
  );
}

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
 * `twenty tasks create` / `note` / `close` — the Task note in one shape, written by the
 * tool rather than typed out by the operator (#3266, #3276). `create` emits an open note
 * from the address the Task rests on and the issue it sits on; `note` rewrites an open
 * Task's note into that shape, replacing whatever it held, and refuses a Task already
 * done so no closed Task loses its proof line; `close` appends the proof line, dated
 * today, and sets the Task done. Each re-reads the Task from the instance after the write
 * and prints what is stored. Whatever route a write takes, the transport's guard
 * (`utilities/house-rules/write-guard.ts`) refuses a note outside this shape.
 *
 * `wait-on` / `set-ticket` — the Task's two fields from #3387, each with a command of its
 * own (#3388): `wait-on` names the Task this one waits on (`waitsOnId`, a Task→Task
 * relation) or clears it, `set-ticket` sets or clears its ticket at the counterparty
 * (`ticket`, text). Each writes that one field and nothing else. `create` takes both, so a
 * session staging an act writes the act's Task and the next one waiting on it in two
 * `create`s and no further write; a waits-on naming a Task the instance does not hold is
 * refused before anything is written.
 */
export function registerTasksCommand(program: Command): void {
  const tasks = program
    .command("tasks")
    .description(
      "Tasks with their note in the house's one shape, the Task each waits on, and its ticket",
    );
  applyGlobalOptions(tasks);

  const create = tasks
    .command("create")
    .description("Write an open Task on a Company or an Opportunity, its note in the one shape")
    .option("--title <text>", "Who owes what, in one line")
    .option("--rests-on <address>", "Address of the mail or recording the Task rests on")
    .option("--rests-on-label <text>", "What that artifact is, in a few words")
    .option("--issue <ref>", "The GitHub issue the work sits on: owner/repo#N, #N or its URL")
    .option("--company <id>", "The Company the Task is on")
    .option("--opportunity <id>", "The Opportunity the Task is on")
    .option("--due <date>", "Due date (ISO 8601)")
    .option("--assignee <workspaceMemberId>", "Who acts")
    .option("--waits-on <taskId>", "The Task this one waits on (it must exist)")
    .option("--ticket <number>", "Its ticket at the counterparty, e.g. 19966");
  applyGlobalOptions(create);

  create.action(async (_options: unknown, command: Command) => {
    const { globalOptions, services } = await createCommandContext(command);
    const options = command.opts() as TaskCreateOptions;

    const missing: string[] = [];
    if (!options.title?.trim()) missing.push("the Task has no title — pass --title, who owes what");
    const markdown = openNoteFrom(options, missing);
    if (!options.company === !options.opportunity) {
      missing.push("a Task stands on one record — pass exactly one of --company or --opportunity");
    }
    const ticket = options.ticket === undefined ? undefined : ticketFrom(options.ticket, missing);
    const waitsOn = options.waitsOn?.trim();
    if (options.waitsOn !== undefined && !waitsOn) {
      missing.push("--waits-on is empty — pass the id of the Task this one waits on");
    }
    if (missing.length > 0) refuse(missing);
    if (waitsOn && !(await findTask(services, waitsOn))) {
      refuse(
        [`--waits-on names Task ${waitsOn}, which is not on the instance; nothing was written`],
        {
          afterRead: true,
        },
      );
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

    await services.records.update("tasks", id, { bodyV2: { markdown: markdown! } });

    await renderStored(services, id, globalOptions);
  });

  const close = tasks
    .command("close")
    .description("Mark a Task done, its note ending in Closed DD.MM · proof: [what it is](address)")
    .argument("<id>", "The Task's id")
    .option("--proof <address>", "Address of the artifact that closed it")
    .option("--proof-label <text>", "What that artifact is, in a few words");
  applyGlobalOptions(close);

  close.action(async (id: string, _options: unknown, command: Command) => {
    const { globalOptions, services } = await createCommandContext(command);
    const options = command.opts() as TaskCloseOptions;

    const missing: string[] = [];
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
        markdown: appendClosingLine(note, closingLine(options.proofLabel!, options.proof!)),
      },
    });

    await renderStored(services, id, globalOptions);
  });

  const waitOn = tasks
    .command("wait-on")
    .description("Name the Task this Task waits on, or clear it with --clear")
    .argument("<id>", "The Task that waits")
    .argument("[waitsOnId]", "The Task it waits on")
    .option("--clear", "Clear it: the Task waits on nothing");
  applyGlobalOptions(waitOn);

  waitOn.action(
    async (id: string, waitsOnId: string | undefined, _options: unknown, command: Command) => {
      const { globalOptions, services } = await createCommandContext(command);
      const options = command.opts() as TaskClearOptions;

      const target = waitsOnId?.trim() || undefined;
      if (!!options.clear === !!target) {
        refuse([
          `pass either the Task ${id} waits on or --clear, not ${options.clear ? "both" : "neither"}; Task ${id} is unchanged`,
        ]);
      }
      if (target === id) refuse([`Task ${id} cannot wait on itself; it is unchanged`]);

      await readTask(services, id);
      if (target && !(await findTask(services, target))) {
        refuse([`Task ${target} is not on the instance; Task ${id} is unchanged`], {
          afterRead: true,
        });
      }

      await services.records.update("tasks", id, { waitsOnId: target ?? null });

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

      await readTask(services, id);
      await services.records.update("tasks", id, { ticket });

      await renderStored(services, id, globalOptions);
    },
  );
}

/** The ticket as it will be stored, trimmed; a blank one is pushed onto `missing`. */
function ticketFrom(raw: string, missing: string[]): string {
  const ticket = raw.trim();
  if (!ticket) missing.push("the ticket is empty — pass the counterparty's ticket number");
  return ticket;
}

/** The Task as stored, or undefined when the instance holds none by that id. */
async function findTask(
  services: Awaited<ReturnType<typeof createCommandContext>>["services"],
  id: string,
): Promise<TaskRecord | undefined> {
  try {
    const response = await services.api.get<{ data?: { task?: TaskRecord } }>(
      `/rest/tasks/${encodeURIComponent(id)}`,
    );
    return response.data?.data?.task ?? undefined;
  } catch (error) {
    const status = (error as { response?: { status?: number } }).response?.status;
    if (status === 404 || status === 400) return undefined;
    throw error;
  }
}

async function readTask(
  services: Awaited<ReturnType<typeof createCommandContext>>["services"],
  id: string,
): Promise<TaskRecord> {
  const response = await services.api.get<{ data?: { task?: TaskRecord } }>(
    `/rest/tasks/${encodeURIComponent(id)}`,
  );
  const task = response.data?.data?.task;
  if (!task) throw new CliError(`No Task ${id} on the instance.`, "INVALID_ARGUMENTS");
  return task;
}

/** Print the Task as the instance now stores it — a fresh read, never the write's echo. */
async function renderStored(
  services: Awaited<ReturnType<typeof createCommandContext>>["services"],
  id: string,
  globalOptions: Awaited<ReturnType<typeof createCommandContext>>["globalOptions"],
): Promise<void> {
  const task = await readTask(services, id);
  const waitsOn = task.waitsOnId ? await findTask(services, task.waitsOnId) : undefined;
  await services.output.render(
    {
      id: task.id,
      title: task.title,
      status: task.status,
      waitsOn: task.waitsOnId ? { id: task.waitsOnId, title: waitsOn?.title ?? null } : null,
      ticket: task.ticket || null,
      note: task.bodyV2?.markdown ?? null,
    },
    { format: globalOptions.output, query: globalOptions.query },
  );
}
