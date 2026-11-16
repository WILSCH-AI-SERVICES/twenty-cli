import { Command } from "commander";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CliError } from "../../../utilities/errors/cli-error";
import { formatDayMonth } from "../../../utilities/house-rules/task-note";
import { REFUSED } from "../../../utilities/house-rules/write-guard";
import { registerTasksCommand } from "../tasks.command";

const mockCreateCommandContext = vi.hoisted(() => vi.fn());

vi.mock("../../../utilities/shared/context", async () => {
  const actual = await vi.importActual<typeof import("../../../utilities/shared/context")>(
    "../../../utilities/shared/context",
  );
  return { ...actual, createCommandContext: mockCreateCommandContext };
});

type Stored = Record<string, unknown> & { id: string };

const NOTE =
  "Rests on: [our mail 18.10](https://example.com/mail/abc)\n\nIssue: [DaveX2001/deliverable-tracking#3388](https://github.com/DaveX2001/deliverable-tracking/issues/3388)";
const CLOSED = "Closed 14.11 · proof: [their reply 14.11](https://example.com/mail/reply)";
const EMPTY_LINK = { primaryLinkUrl: "", primaryLinkLabel: "", secondaryLinks: [] };

const SINGULAR: Record<string, string> = {
  tasks: "task",
  calendarEvents: "calendarEvent",
  people: "person",
  companies: "company",
  opportunities: "opportunity",
  workspaceMembers: "workspaceMember",
};

describe("tasks command — every move a Task allows (#3388, CCI#1341)", () => {
  let program: Command;
  let store: Record<string, Map<string, Stored>>;
  let rendered: Record<string, unknown> | undefined;
  let updates: Array<[string, Record<string, unknown>]>;
  let creates: Array<[string, Record<string, unknown>]>;
  let deletes: Array<[string, string]>;
  let reads: Array<[string, string | undefined]>;

  beforeEach(() => {
    program = new Command();
    program.exitOverride();
    registerTasksCommand(program);
    rendered = undefined;
    updates = [];
    creates = [];
    deletes = [];
    reads = [];
    const task = (
      id: string,
      title: string,
      extra: Record<string, unknown> = {},
    ): [string, Stored] => [
      id,
      {
        id,
        title,
        status: "TODO",
        bodyV2: { markdown: NOTE },
        dueAt: "2026-12-01T00:00:00.000Z",
        waitsOnId: null,
        waitsOnIssue: EMPTY_LINK,
        ticket: "",
        roomId: null,
        ...extra,
      },
    ];
    store = {
      tasks: new Map([
        task("t1", "We owe the offer", { companyId: "c1" }),
        task("t2", "They owe the answer"),
        task("roomed", "The agenda point", { roomId: "e1", dueAt: "2026-11-30T00:00:00.000Z" }),
        task("done", "The answer, given", {
          status: "DONE",
          companyId: "c1",
          bodyV2: { markdown: `${NOTE}\n\n${CLOSED}` },
        }),
      ]),
      calendarEvents: new Map([
        [
          "e1",
          {
            id: "e1",
            title: "Check-in with Jhonatan",
            startsAt: "2026-11-30T23:15:00.000Z",
            deletedAt: null,
          },
        ],
        [
          "gone",
          {
            id: "gone",
            title: "Deleted",
            startsAt: "2026-11-30T09:00:00.000Z",
            deletedAt: "2026-11-01T00:00:00.000Z",
          },
        ],
      ]),
      people: new Map([["p1", { id: "p1" }]]),
      companies: new Map([
        ["c1", { id: "c1" }],
        ["c2", { id: "c2" }],
      ]),
      opportunities: new Map([
        ["o1", { id: "o1", companyId: "c1" }],
        ["o2", { id: "o2", companyId: null }],
      ]),
      workspaceMembers: new Map([["m1", { id: "m1" }]]),
      taskTargets: new Map([["tt1", { id: "tt1", taskId: "t1", targetCompanyId: "c1" }]]),
    };
    let next = 0;
    const notFound = () =>
      Object.assign(new Error("Request failed with status code 404"), {
        response: { status: 404 },
      });
    const get = vi.fn(async (url: string, config?: { params?: { filter?: string } }) => {
      if (url === "/rest/taskTargets") {
        const taskId = config?.params?.filter?.replace("taskId[eq]:", "");
        return {
          data: {
            data: {
              taskTargets: [...store.taskTargets!.values()].filter((t) => t.taskId === taskId),
            },
          },
        };
      }
      const [, , object, raw] = url.split("/");
      const record = store[object!]?.get(decodeURIComponent(raw!));
      if (!record) throw notFound();
      return { data: { data: { [SINGULAR[object!]!]: { ...record } } } };
    });
    mockCreateCommandContext.mockReset();
    mockCreateCommandContext.mockResolvedValue({
      globalOptions: { output: "json", query: undefined },
      services: {
        api: { get },
        records: {
          listAll: vi.fn(async (object: string, options: { filter?: string }) => {
            const companyId = /^companyId\[eq\]:"(.*)"$/.exec(options.filter ?? "")?.[1];
            reads.push([object, options.filter]);
            return {
              data: [...store[object]!.values()].filter((r) => r.companyId === companyId),
            };
          }),
          create: vi.fn(async (object: string, data: Record<string, unknown>) => {
            creates.push([object, data]);
            const id = object === "tasks" ? `new-${++next}` : `target-${++next}`;
            store[object]!.set(id, { id, ...data });
            return { id };
          }),
          update: vi.fn(async (_object: string, id: string, data: Record<string, unknown>) => {
            updates.push([id, data]);
            store.tasks!.set(id, { ...store.tasks!.get(id)!, ...data });
            return store.tasks!.get(id);
          }),
          delete: vi.fn(async (object: string, id: string) => {
            deletes.push([object, id]);
            store[object]!.delete(id);
          }),
        },
        output: {
          render: vi.fn(async (value: Record<string, unknown>) => void (rendered = value)),
        },
      },
    });
  });

  const run = (...args: string[]) => program.parseAsync(["node", "twenty", "tasks", ...args]);
  const refusal = async (...args: string[]) => {
    const error = await run(...args).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(CliError);
    expect((error as CliError).code).toBe(REFUSED);
    return (error as CliError).message;
  };

  describe("wait-on", () => {
    it("names the Task one waits on, clearing any issue in the same write, and reads it back with its title", async () => {
      await run("wait-on", "t1", "t2");

      expect(updates).toEqual([["t1", { waitsOnId: "t2", waitsOnIssue: EMPTY_LINK }]]);
      expect(rendered).toMatchObject({
        id: "t1",
        waitsOn: { id: "t2", title: "They owe the answer" },
      });
      expect(rendered!.note).toBe(NOTE);
    });

    it("names a GitHub issue as owner/repo#N or its address, clearing any Task waited on", async () => {
      await run("wait-on", "t1", "DaveX2001/claude-code-improvements#1341");
      await run(
        "wait-on",
        "t2",
        "https://github.com/DaveX2001/claude-code-improvements/issues/1341",
      );

      const issue = {
        primaryLinkUrl: "https://github.com/DaveX2001/claude-code-improvements/issues/1341",
        primaryLinkLabel: "DaveX2001/claude-code-improvements#1341",
        secondaryLinks: [],
      };
      expect(updates).toEqual([
        ["t1", { waitsOnId: null, waitsOnIssue: issue }],
        ["t2", { waitsOnId: null, waitsOnIssue: issue }],
      ]);
      expect(rendered).toMatchObject({
        waitsOnIssue: { url: issue.primaryLinkUrl, label: issue.primaryLinkLabel },
      });
    });

    it("clears it with --clear, and the Task reads back waiting on nothing", async () => {
      store.tasks!.get("t1")!.waitsOnId = "t2";
      await run("wait-on", "t1", "--clear");

      expect(updates).toEqual([["t1", { waitsOnId: null, waitsOnIssue: EMPTY_LINK }]]);
      expect(rendered).toMatchObject({ id: "t1", waitsOn: null, waitsOnIssue: null });
    });

    it("refuses what is neither a Task nor an issue, and writes nothing", async () => {
      expect(await refusal("wait-on", "t1", "missing")).toContain(
        "missing is neither a Task on the instance nor a GitHub issue",
      );
      expect(updates).toEqual([]);
    });

    it("refuses both or neither of a Task and --clear, and a Task waiting on itself", async () => {
      expect(await refusal("wait-on", "t1")).toContain("not neither");
      expect(await refusal("wait-on", "t1", "t2", "--clear")).toContain("not both");
      expect(await refusal("wait-on", "t1", "t1")).toContain("cannot wait on itself");
      expect(updates).toEqual([]);
    });
  });

  describe("set-ticket", () => {
    it("sets the ticket, writing that field alone", async () => {
      await run("set-ticket", "t1", " 19966 ");

      expect(updates).toEqual([["t1", { ticket: "19966" }]]);
      expect(rendered).toMatchObject({ id: "t1", ticket: "19966", note: NOTE });
    });

    it("clears it with --clear, leaving the field empty", async () => {
      store.tasks!.get("t1")!.ticket = "19966";
      await run("set-ticket", "t1", "--clear");

      expect(updates).toEqual([["t1", { ticket: "" }]]);
      expect(rendered).toMatchObject({ ticket: null });
    });

    it("refuses a blank ticket, and both or neither of a ticket and --clear", async () => {
      expect(await refusal("set-ticket", "t1", "  ")).toContain("the ticket is empty");
      expect(await refusal("set-ticket", "t1")).toContain("not neither");
      expect(await refusal("set-ticket", "t1", "19966", "--clear")).toContain("not both");
      expect(updates).toEqual([]);
    });
  });

  describe("set-due", () => {
    it("re-dates an open Task, writing its date alone", async () => {
      await run("set-due", "t1", "2026-12-15");

      expect(updates).toEqual([["t1", { dueAt: "2026-12-15T00:00:00.000Z" }]]);
      expect(rendered).toMatchObject({ id: "t1", dueAt: "2026-12-15T00:00:00.000Z" });
    });

    it("refuses a Task whose room is booked, naming the room and its day, and writes nothing", async () => {
      const message = await refusal("set-due", "roomed", "2026-12-15");
      expect(message).toContain('"Check-in with Jhonatan" on 2026-12-01');
      expect(message).toContain("calendar event e1");
      expect(updates).toEqual([]);
    });

    it("re-dates a Task whose room's event is gone", async () => {
      store.tasks!.get("roomed")!.roomId = "gone";
      await run("set-due", "roomed", "2026-12-15");
      expect(updates).toEqual([["roomed", { dueAt: "2026-12-15T00:00:00.000Z" }]]);
    });

    it("refuses a waiting Task, a malformed day, and a done Task", async () => {
      store.tasks!.get("t1")!.waitsOnId = "t2";
      expect(await refusal("set-due", "t1", "2026-12-15")).toContain("waits on Task t2");
      expect(await refusal("set-due", "t2", "15.12.2026")).toContain("is not a day");
      expect(await refusal("set-due", "done", "2026-12-15")).toContain(
        "a closed Task allows one move",
      );
      expect(updates).toEqual([]);
    });
  });

  describe("set-assignee", () => {
    it("gives an open Task a new assignee, and clears it", async () => {
      await run("set-assignee", "t1", "m1");
      await run("set-assignee", "t2", "--clear");
      expect(updates).toEqual([
        ["t1", { assigneeId: "m1" }],
        ["t2", { assigneeId: null }],
      ]);
    });

    it("refuses a member the instance does not hold, and a done Task", async () => {
      expect(await refusal("set-assignee", "t1", "nobody")).toContain(
        "workspace member nobody is not on the instance",
      );
      expect(await refusal("set-assignee", "done", "m1")).toContain(
        "a closed Task allows one move",
      );
      expect(updates).toEqual([]);
    });
  });

  describe("set-room", () => {
    it("gives an open Task its room, writing that field alone", async () => {
      await run("set-room", "t1", "e1");
      expect(updates).toEqual([["t1", { roomId: "e1" }]]);
      expect(rendered).toMatchObject({
        room: { id: "e1", title: "Check-in with Jhonatan", day: "2026-12-01" },
      });
    });

    it("clears it, and refuses an event the instance does not hold or has deleted", async () => {
      await run("set-room", "roomed", "--clear");
      expect(updates).toEqual([["roomed", { roomId: null }]]);
      expect(await refusal("set-room", "t1", "gone")).toContain(
        "calendar event gone is not on the instance",
      );
      expect(await refusal("set-room", "t1", "missing")).toContain("is not on the instance");
      expect(updates).toHaveLength(1);
    });
  });

  describe("retarget", () => {
    it("moves a Task from its Company onto an Opportunity: the new target written before the old one goes", async () => {
      await run("retarget", "t1", "--add-opportunity", "o1", "--drop-company", "c1");

      expect(creates).toEqual([["taskTargets", { taskId: "t1", targetOpportunityId: "o1" }]]);
      expect(deletes).toEqual([["taskTargets", "tt1"]]);
      expect(rendered!.targets).toEqual([
        { kind: "opportunity", id: "o1", taskTargetId: expect.any(String) },
      ]);
    });

    it("widens a Task to a second Company, keeping the first", async () => {
      await run("retarget", "t1", "--add-company", "c2");

      expect(deletes).toEqual([]);
      expect(rendered!.targets).toEqual([
        { kind: "company", id: "c1", taskTargetId: "tt1" },
        { kind: "company", id: "c2", taskTargetId: expect.any(String) },
      ]);
    });

    it("refuses a drop it is not aimed at, an add it already has or the instance lacks, and leaving none", async () => {
      expect(await refusal("retarget", "t1", "--drop-company", "c2")).toContain(
        "not aimed at company c2",
      );
      expect(await refusal("retarget", "t1", "--add-company", "c1")).toContain(
        "already aimed at company c1",
      );
      expect(await refusal("retarget", "t1", "--add-person", "ghost")).toContain(
        "person ghost is not on the instance",
      );
      expect(await refusal("retarget", "t1", "--drop-company", "c1")).toContain(
        "would be aimed at none",
      );
      expect(await refusal("retarget", "t1")).toContain("name a target to add or to drop");
      expect(creates).toEqual([]);
      expect(deletes).toEqual([]);
    });
  });

  describe("reopen", () => {
    it("puts a done Task back to to do, its closing line kept as a dated line saying why", async () => {
      await run("reopen", "done", "--why", "the reply was on another matter");

      const line = `Closed 14.11 in error — reopened ${formatDayMonth(new Date())}: the reply was on another matter · proof was: [their reply 14.11](https://example.com/mail/reply)`;
      expect(updates).toEqual([
        ["done", { status: "TODO", bodyV2: { markdown: `${NOTE}\n\n${line}` } }],
      ]);
      expect(creates).toEqual([]);
      expect(rendered).toMatchObject({ id: "done", status: "TODO" });
    });

    it("refuses without a reason, and on a Task that is not done", async () => {
      expect(await refusal("reopen", "done")).toContain("does not say why");
      expect(await refusal("reopen", "t1", "--why", "x")).toContain("is not done");
      expect(updates).toEqual([]);
    });

    it("keeps the wrong close when the reopened Task's note is reshaped, and lets it close again", async () => {
      await run("reopen", "done", "--why", "wrong reply");
      const reopened = (store.tasks!.get("done")!.bodyV2 as { markdown: string }).markdown;
      const kept = reopened.split("\n\n").pop()!;

      await run(
        "note",
        "done",
        "--rests-on",
        "https://example.com/mail/new",
        "--rests-on-label",
        "the new ask",
      );
      expect((store.tasks!.get("done")!.bodyV2 as { markdown: string }).markdown).toBe(
        `Rests on: [the new ask](https://example.com/mail/new)\n\n${kept}`,
      );

      await run(
        "close",
        "done",
        "--proof",
        "https://example.com/mail/right",
        "--proof-label",
        "the right reply",
      );
      expect(rendered).toMatchObject({ status: "DONE" });
    });
  });

  describe("create", () => {
    const base = [
      "create",
      "--title",
      "The answer to our offer",
      "--rests-on",
      "https://example.com/mail/abc",
      "--rests-on-label",
      "our mail 18.10",
      "--issue",
      "DaveX2001/deliverable-tracking#3388",
      "--company",
      "c1",
    ];

    it("writes the next Task waiting on the act's Task and carrying the ticket, in the one write", async () => {
      await run(...base, "--waits-on", "t1", "--ticket", "19966");

      const [object, data] = creates[0]!;
      expect(object).toBe("tasks");
      expect(data).toMatchObject({ status: "TODO", waitsOnId: "t1", ticket: "19966" });
      expect(creates[1]).toEqual(["taskTargets", { taskId: "new-1", targetCompanyId: "c1" }]);
      expect(updates).toEqual([]);
      expect(rendered).toMatchObject({
        id: "new-1",
        waitsOn: { id: "t1", title: "We owe the offer" },
        ticket: "19966",
      });
    });

    it("writes who owes it and its room in their own fields", async () => {
      await run(...base, "--owes", "other-side", "--owes-person", "p1", "--room", "e1");

      expect(creates[0]![1]).toMatchObject({
        title: "The answer to our offer",
        owes: "OTHER_SIDE",
        owesPersonId: "p1",
        roomId: "e1",
      });
      expect(rendered).toMatchObject({
        owes: "OTHER_SIDE",
        owesPersonId: "p1",
        room: { id: "e1" },
      });
    });

    it("writes none of the optional fields when none is given", async () => {
      await run(...base);

      for (const field of ["waitsOnId", "ticket", "owes", "owesPersonId", "roomId"]) {
        expect(creates[0]![1]).not.toHaveProperty(field);
      }
      expect(rendered).toMatchObject({ waitsOn: null, ticket: null, owes: null, room: null });
    });

    it("refuses a waits-on, a Person or a room the instance does not hold, and writes nothing", async () => {
      expect(await refusal(...base, "--waits-on", "missing")).toContain(
        "--waits-on names Task missing, which is not on the instance",
      );
      expect(await refusal(...base, "--owes", "other-side", "--owes-person", "ghost")).toContain(
        "--owes-person names Person ghost",
      );
      expect(await refusal(...base, "--room", "gone")).toContain(
        "--room names calendar event gone",
      );
      expect(creates).toEqual([]);
    });

    it("refuses a blank ticket or waits-on, an unknown side, a Person without the other side, and a room with a date", async () => {
      expect(await refusal(...base, "--ticket", " ")).toContain("the ticket is empty");
      expect(await refusal(...base, "--waits-on", " ")).toContain("--waits-on is empty");
      expect(await refusal(...base, "--owes", "us")).toContain("neither house nor other-side");
      expect(await refusal(...base, "--owes-person", "p1")).toContain(
        "pass --owes other-side with it",
      );
      expect(await refusal(...base, "--room", "e1", "--due", "2026-12-01")).toContain("not both");
      expect(creates).toEqual([]);
    });
  });

  describe("a second open Task with the same title on a Company (CCI#1346)", () => {
    const create = (title: string, on: string[]) => [
      "create",
      "--title",
      title,
      "--rests-on",
      "https://example.com/mail/abc",
      "--rests-on-label",
      "our mail 18.10",
      ...on,
    ];

    it("refuses it by --company and by --opportunity, showing the Task that stands, and writes nothing", async () => {
      for (const on of [
        ["--company", "c1"],
        ["--opportunity", "o1"],
      ]) {
        const message = await refusal(...create(" we owe the OFFER ", on));
        expect(message).toContain("a second open Task with the same title on a Company is refused");
        expect(message).toContain('Task t1 · "We owe the offer" · due 2026-12-01');
        expect(message).toContain("nothing was written");
      }
      expect(reads).toEqual([
        ["tasks", 'companyId[eq]:"c1"'],
        ["tasks", 'companyId[eq]:"c1"'],
      ]);
      expect(creates).toEqual([]);
    });

    it("writes a Task titled like a closed one on its Company, and like an open one on another", async () => {
      await run(...create("The answer, given", ["--company", "c1"]));
      await run(...create("We owe the offer", ["--company", "c2"]));
      await run(...create("We owe the offer", ["--opportunity", "o2"]));
      expect(creates.filter(([object]) => object === "tasks")).toHaveLength(3);
    });

    it("refuses a Company or an Opportunity the instance does not hold, before any write", async () => {
      expect(await refusal(...create("x", ["--company", "ghost"]))).toContain(
        "--company names Company ghost, which is not on the instance",
      );
      expect(await refusal(...create("x", ["--opportunity", "ghost"]))).toContain(
        "--opportunity names Opportunity ghost, which is not on the instance",
      );
      expect(creates).toEqual([]);
    });

    it("refuses reopening a closed Task whose title an open Task on its Company carries", async () => {
      store.tasks!.set("t3", {
        ...store.tasks!.get("t1")!,
        id: "t3",
        title: "The answer, given",
        dueAt: null,
      });
      const message = await refusal("reopen", "done", "--why", "the reply was on another matter");
      expect(message).toContain('Task t3 · "The answer, given" · no date');
      expect(message).toContain("Task done stays done");
      expect(updates).toEqual([]);
    });

    it("says both refusals in tasks --help and tasks create --help", () => {
      const tasks = program.commands.find((c) => c.name() === "tasks")!;
      const createCommand = tasks.commands.find((c) => c.name() === "create")!;
      for (const help of [tasks.helpInformation(), createCommand.helpInformation()]) {
        const flat = help.replace(/\s+/g, " ");
        expect(flat).toContain("An open Task's title does not change");
        expect(flat).toContain("A second open Task with the same title on a Company is refused");
        expect(flat).toContain("showing the Task that stands");
      }
    });
  });

  it("lists every move, noun then verb, in tasks --help", () => {
    const tasks = program.commands.find((c) => c.name() === "tasks")!;
    const help = tasks.helpInformation();
    for (const verb of [
      "create",
      "note",
      "close",
      "reopen \\[options\\] <id>",
      "set-due \\[options\\] <id> <date>",
      "set-assignee \\[options\\] <id> \\[workspaceMemberId\\]",
      "wait-on \\[options\\] <id> \\[waitsOn\\]",
      "set-ticket \\[options\\] <id> \\[ticket\\]",
      "set-room \\[options\\] <id> \\[calendarEventId\\]",
      "retarget \\[options\\] <id>",
    ]) {
      expect(help).toMatch(new RegExp(verb));
    }
  });
});
