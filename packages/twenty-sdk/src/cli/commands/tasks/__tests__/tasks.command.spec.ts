import { Command } from "commander";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CliError } from "../../../utilities/errors/cli-error";
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
  "Rests on: [our mail 18.10](https://mail.google.com/mail/u/0/#all/abc)\n\nIssue: [DaveX2001/deliverable-tracking#3388](https://github.com/DaveX2001/deliverable-tracking/issues/3388)";

describe("tasks command — wait-on, set-ticket, and create taking both (#3388)", () => {
  let program: Command;
  let store: Map<string, Stored>;
  let rendered: Record<string, unknown> | undefined;
  let updates: Array<[string, Record<string, unknown>]>;
  let creates: Array<[string, Record<string, unknown>]>;

  beforeEach(() => {
    program = new Command();
    program.exitOverride();
    registerTasksCommand(program);
    rendered = undefined;
    updates = [];
    creates = [];
    store = new Map<string, Stored>([
      ["t1", { id: "t1", title: "We owe the offer", status: "TODO", bodyV2: { markdown: NOTE }, waitsOnId: null, ticket: "" }],
      ["t2", { id: "t2", title: "They owe the answer", status: "TODO", bodyV2: { markdown: NOTE }, waitsOnId: null, ticket: "" }],
    ]);
    let next = 0;
    const get = vi.fn(async (url: string) => {
      const id = decodeURIComponent(url.replace("/rest/tasks/", ""));
      const task = store.get(id);
      if (!task) throw Object.assign(new Error("Request failed with status code 404"), { response: { status: 404 } });
      return { data: { data: { task: { ...task } } } };
    });
    mockCreateCommandContext.mockReset();
    mockCreateCommandContext.mockResolvedValue({
      globalOptions: { output: "json", query: undefined },
      services: {
        api: { get },
        records: {
          create: vi.fn(async (object: string, data: Record<string, unknown>) => {
            creates.push([object, data]);
            if (object !== "tasks") return { id: `target-${next}` };
            const id = `new-${++next}`;
            store.set(id, { id, ...data });
            return { id };
          }),
          update: vi.fn(async (_object: string, id: string, data: Record<string, unknown>) => {
            updates.push([id, data]);
            store.set(id, { ...store.get(id)!, ...data });
            return store.get(id);
          }),
        },
        output: { render: vi.fn(async (value: Record<string, unknown>) => void (rendered = value)) },
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
    it("names the Task one waits on, writing that field alone, and reads it back with its title", async () => {
      await run("wait-on", "t1", "t2");

      expect(updates).toEqual([["t1", { waitsOnId: "t2" }]]);
      expect(rendered).toMatchObject({ id: "t1", waitsOn: { id: "t2", title: "They owe the answer" } });
      expect(rendered!.note).toBe(NOTE);
    });

    it("clears it with --clear, and the Task reads back waiting on nothing", async () => {
      store.get("t1")!.waitsOnId = "t2";
      await run("wait-on", "t1", "--clear");

      expect(updates).toEqual([["t1", { waitsOnId: null }]]);
      expect(rendered).toMatchObject({ id: "t1", waitsOn: null });
    });

    it("refuses a Task the instance does not hold, and writes nothing", async () => {
      expect(await refusal("wait-on", "t1", "missing")).toContain("Task missing is not on the instance");
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
      store.get("t1")!.ticket = "19966";
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

  describe("create", () => {
    const base = [
      "create",
      "--title",
      "They owe the answer to our offer",
      "--rests-on",
      "https://mail.google.com/mail/u/0/#all/abc",
      "--rests-on-label",
      "our mail 18.10",
      "--issue",
      "DaveX2001/deliverable-tracking#3388",
      "--company",
      "c1",
    ];

    it("writes the next Task waiting on the act's Task and carrying the ticket, in the one write", async () => {
      await run(...base, "--waits-on", "t1", "--ticket", "19966");

      const [object, data] = creates[0];
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

    it("writes neither field when neither is given", async () => {
      await run(...base);

      expect(creates[0][1]).not.toHaveProperty("waitsOnId");
      expect(creates[0][1]).not.toHaveProperty("ticket");
      expect(rendered).toMatchObject({ waitsOn: null, ticket: null });
    });

    it("refuses a waits-on naming a Task that does not exist, and writes nothing", async () => {
      expect(await refusal(...base, "--waits-on", "missing")).toContain(
        "--waits-on names Task missing, which is not on the instance; nothing was written",
      );
      expect(creates).toEqual([]);
    });

    it("refuses a blank ticket or waits-on before reaching the instance", async () => {
      expect(await refusal(...base, "--ticket", " ")).toContain("the ticket is empty");
      expect(await refusal(...base, "--waits-on", " ")).toContain("--waits-on is empty");
      expect(creates).toEqual([]);
    });
  });

  it("lists wait-on and set-ticket, with their arguments, in tasks --help", () => {
    const tasks = program.commands.find((c) => c.name() === "tasks")!;
    const help = tasks.helpInformation();
    expect(help).toMatch(/wait-on \[options\] <id> \[waitsOnId\]/);
    expect(help).toMatch(/set-ticket \[options\] <id> \[ticket\]/);
  });
});
