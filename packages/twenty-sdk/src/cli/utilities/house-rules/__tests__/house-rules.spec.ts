import { describe, expect, it } from "vitest";

import {
  appendClosingLine,
  checkTaskNote,
  closingLine,
  emitOpenNote,
  formatDayMonth,
  parseIssueRef,
  reopenNote,
  restOnSent,
} from "../task-note";
import { guardWrite, intendedWrites, type StoredReader } from "../write-guard";

const MAIL = "https://example.com/mail/1a10c1e0d880919a";
const OPEN = emitOpenNote({
  restsOnLabel: "Svend, Ticket #20049, 05.10",
  restsOnUrl: MAIL,
  issue: parseIssueRef("#2296"),
});
const LINE = "Access is set up for all three of you.";
const proof = (label: string, url: string, line = LINE) => closingLine({ line, label, url });
const CLOSED = appendClosingLine(OPEN, proof("Gregor, 02.10", MAIL));
/** A Task closed before CCI#1363: its closing line quotes nothing. */
const EARLIER = `${OPEN}\n\nClosed 06.10 · proof: [Gregor, 02.10](${MAIL})`;
const BASE = "https://crm.acme.com";

const none: StoredReader = async () => undefined;
const storedTask =
  (status: string, markdown: string): StoredReader =>
  async () => ({ id: "t1", status, bodyV2: { markdown } });
const storedOpp =
  (stage: string, url: string | null): StoredReader =>
  async () => ({ id: "o1", stage, whyStopped: { primaryLinkUrl: url } });

describe("the Task note's shape", () => {
  it("emits the open shape with the issue as a GitHub link", () => {
    expect(OPEN).toBe(
      `Rests on: [Svend, Ticket #20049, 05.10](${MAIL})\n\nIssue: [DaveX2001/deliverable-tracking#2296](https://github.com/DaveX2001/deliverable-tracking/issues/2296)`,
    );
    expect(checkTaskNote(OPEN, { done: false })).toEqual([]);
  });

  it("accepts a closed note dated today, the line that closed it quoted before the link, as its last line", () => {
    expect(
      CLOSED.endsWith(
        `Closed ${formatDayMonth(new Date())} · proof: "${LINE}" — [Gregor, 02.10](${MAIL})`,
      ),
    ).toBe(true);
    expect(
      checkTaskNote(CLOSED, { done: true, closingDates: [formatDayMonth(new Date())] }),
    ).toEqual([]);
  });

  it("refuses a close written now in the earlier shape, and leaves a Task closed in it standing (CCI#1363)", () => {
    const today = formatDayMonth(new Date());
    const bare = `${OPEN}\n\nClosed ${today} · proof: [Gregor, 02.10](${MAIL})`;
    expect(checkTaskNote(bare, { done: true, closingDates: [today] }).join()).toMatch(
      /does not quote the line that closed it/,
    );
    expect(
      checkTaskNote(`${OPEN}\n\nClosed ${today} · proof: " " — [x](${MAIL})`, {
        done: true,
        closingDates: [today],
      }).join(),
    ).toMatch(/quotes are empty/);
    // Read as it stands, on a write that is not its close.
    expect(checkTaskNote(EARLIER, { done: true })).toEqual([]);
    // Either shape on an open Task is a proof line where none belongs.
    expect(checkTaskNote(EARLIER, { done: false }).join()).toMatch(/not done/);
    expect(checkTaskNote(CLOSED, { done: false }).join()).toMatch(/not done/);
  });

  it("moves a draft-resting note onto the sent mail, the address alone changed (the eighth move)", () => {
    const reopened = reopenNote(EARLIER, "wrong reply").markdown!;
    const moved = restOnSent(reopened, `${MAIL}/sent`);
    expect(moved.draftUrl).toBe(MAIL);
    const [first, ...rest] = moved.markdown!.split("\n\n");
    const [oldFirst, ...oldRest] = reopened.split("\n\n");
    expect(first).toBe(`Rests on: [Svend, Ticket #20049, 05.10](${MAIL}/sent)`);
    expect(oldFirst).toBe(`Rests on: [Svend, Ticket #20049, 05.10](${MAIL})`);
    expect(rest).toEqual(oldRest);
    expect(restOnSent(OPEN, MAIL).problems.join()).toMatch(/already rests on/);
    expect(restOnSent("a paragraph", MAIL).problems.join()).toMatch(/does not open/);
  });

  it.each([
    ["no note", undefined, /no note/],
    ["an empty note", "  \n ", /empty/],
    ["a bare paragraph", "Pilot of Rohdex on Twenty, the invoice stands.", /rests on/],
    ["a bare link", MAIL, /first line must be Rests on/],
    ["a link without its http(s)", "Rests on: [x](mail.google.com/a)", /not an http\(s\) URL/],
  ])("refuses %s, naming what is missing", (_name, markdown, message) => {
    const problems = checkTaskNote(markdown, { done: false });
    expect(problems.join("\n")).toMatch(message);
  });

  it("refuses a retelling beside the address", () => {
    expect(checkTaskNote(`${OPEN}\n\nHe said he would call back.`, { done: false }).join()).toMatch(
      /outside its shape/,
    );
  });

  it("refuses a done Task without its proof line, a misdated close, and a proof line not last", () => {
    expect(checkTaskNote(OPEN, { done: true }).join()).toMatch(/missing Closed DD\.MM/);
    const old = `${OPEN}\n\nClosed 01.01 · proof: [x](${MAIL})`;
    expect(checkTaskNote(old, { done: true, closingDates: ["06.10"] }).join()).toMatch(
      /not the day of the close/,
    );
    const notLast = `Rests on: [a](${MAIL})\n\nClosed 06.10 · proof: [x](${MAIL})\n\nmore`;
    expect(checkTaskNote(notLast, { done: true }).join()).toMatch(/not the note's last line/);
  });
});

describe("every route's write is read for what it writes", () => {
  it("REST: create, upsert, batch, update, filter-wide update, merge", () => {
    expect(
      intendedWrites({ method: "post", baseURL: BASE, url: "/rest/tasks", data: {} }),
    ).toMatchObject([{ object: "task", kind: "create", upsert: false }]);
    expect(
      intendedWrites({
        method: "post",
        baseURL: BASE,
        url: "/rest/tasks",
        params: { upsert: "true" },
        data: {},
      }),
    ).toMatchObject([{ kind: "create", upsert: true }]);
    expect(
      intendedWrites({
        method: "post",
        baseURL: BASE,
        url: "rest//batch/Tasks/?upsert=true",
        data: [{}, {}],
      }),
    ).toHaveLength(2);
    expect(
      intendedWrites({ method: "patch", baseURL: BASE, url: "/rest/tasks/abc", data: {} }),
    ).toMatchObject([{ kind: "update", id: "abc" }]);
    expect(
      intendedWrites({ method: "patch", url: `${BASE}/rest/opportunities`, data: {} }),
    ).toMatchObject([{ object: "opportunity", kind: "updateMany" }]);
    expect(
      intendedWrites({ method: "patch", baseURL: BASE, url: "/rest/tasks/merge", data: {} }),
    ).toMatchObject([{ kind: "merge", dryRun: false }]);
    expect(
      intendedWrites({ method: "post", baseURL: BASE, url: "/rest/tasks/duplicates", data: {} }),
    ).toEqual([]);
    expect(intendedWrites({ method: "get", baseURL: BASE, url: "/rest/tasks" })).toEqual([]);
  });

  it("GraphQL: literal and variable arguments, aliases, fragments, batched documents, any endpoint", () => {
    const writes = intendedWrites({
      method: "post",
      baseURL: BASE,
      url: "/graphql",
      data: {
        query: `mutation M($d: TaskCreateInput!) { a: createTask(data: $d) { ...F } updateOpportunity(id: "o1", data: { stage: CLOSED_LOST }) { id } }
                fragment F on Task { id }`,
        variables: { d: { title: "x" } },
      },
    });
    expect(writes).toMatchObject([
      { object: "task", kind: "create", data: { title: "x" } },
      { object: "opportunity", kind: "update", id: "o1", data: { stage: "CLOSED_LOST" } },
    ]);
    expect(
      intendedWrites({
        method: "post",
        baseURL: BASE,
        url: "/some/other/endpoint",
        data: JSON.stringify([
          {
            query:
              'mutation { createTasks(data: [{title: "a"}, {title: "b"}], upsert: true) { id } }',
          },
        ]),
      }),
    ).toMatchObject([
      { kind: "create", upsert: true },
      { kind: "create", upsert: true },
    ]);
    expect(
      intendedWrites({
        method: "post",
        baseURL: BASE,
        url: "/graphql",
        data: { query: "{ tasks { edges { node { id } } } }" },
      }),
    ).toEqual([]);
  });

  it("GraphQL: a variable left out takes its declared default", () => {
    expect(
      intendedWrites({
        method: "post",
        baseURL: BASE,
        url: "/graphql",
        data: {
          query:
            'mutation ($d: TaskUpdateInput = {status: DONE}) { updateTask(id: "t1", data: $d) { id } }',
        },
      }),
    ).toMatchObject([{ kind: "update", id: "t1", data: { status: "DONE" } }]);
  });

  it("REST: an upsert flag passed as a repeated query param", () => {
    expect(
      intendedWrites({
        method: "post",
        baseURL: BASE,
        url: "/rest/tasks",
        params: { upsert: ["true"] },
        data: {},
      }),
    ).toMatchObject([{ kind: "create", upsert: true }]);
  });

  it("MCP: execute_tool and direct tool calls", () => {
    expect(
      intendedWrites({
        method: "post",
        baseURL: BASE,
        url: "/mcp",
        data: {
          jsonrpc: "2.0",
          method: "tools/call",
          params: {
            name: "execute_tool",
            arguments: { toolName: "update_one_task", arguments: { id: "t1", status: "DONE" } },
          },
        },
      }),
    ).toMatchObject([{ object: "task", kind: "update", id: "t1", data: { status: "DONE" } }]);
    expect(
      intendedWrites({
        method: "post",
        baseURL: BASE,
        url: "/mcp",
        data: {
          jsonrpc: "2.0",
          method: "tools/call",
          params: { name: "create_many_opportunities", arguments: { records: [{}] } },
        },
      }),
    ).toMatchObject([{ object: "opportunity", kind: "create" }]);
  });
});

describe("the guard", () => {
  const post = (data: unknown) => ({ method: "post", baseURL: BASE, url: "/rest/tasks", data });
  const patch = (data: unknown, url = "/rest/tasks/t1") => ({
    method: "patch",
    baseURL: BASE,
    url,
    data,
  });

  it("lets an open Task in shape through and refuses one without a note", async () => {
    await expect(
      guardWrite(post({ title: "x", bodyV2: { markdown: OPEN } }), none),
    ).resolves.toBeUndefined();
    await expect(guardWrite(post({ title: "x" }), none)).rejects.toThrow(/no note/);
    await expect(
      guardWrite(post({ title: "x", bodyV2: { blocknote: "[]", markdown: OPEN } }), none),
    ).rejects.toThrow(/blocknote/);
  });

  it("judges a close against the stored note, and refuses one without its proof line", async () => {
    await expect(guardWrite(patch({ status: "DONE" }), storedTask("TODO", OPEN))).rejects.toThrow(
      /proof line/,
    );
    await expect(
      guardWrite(patch({ status: "DONE", bodyV2: { markdown: CLOSED } }), storedTask("TODO", OPEN)),
    ).resolves.toBeUndefined();
    await expect(
      guardWrite(patch({ dueAt: "2026-11-01" }), storedTask("TODO", "a paragraph")),
    ).resolves.toBeUndefined();
    await expect(guardWrite(patch({ status: "DONE" }), none)).rejects.toThrow(
      /could not be read back/,
    );
  });

  it("lets an open Task's note be rewritten into the shape, and refuses one outside it", async () => {
    await expect(
      guardWrite(patch({ bodyV2: { markdown: OPEN } }), storedTask("TODO", `${MAIL} · DT#2296`)),
    ).resolves.toBeUndefined();
    await expect(
      guardWrite(patch({ bodyV2: { markdown: MAIL } }), storedTask("TODO", OPEN)),
    ).rejects.toThrow(/does not open with the address/);
    await expect(
      guardWrite(
        patch({ bodyV2: { markdown: `Rests on: [](${MAIL})` } }),
        storedTask("TODO", OPEN),
      ),
    ).rejects.toThrow(/Refused/);
  });

  it("refuses rewriting a done Task's note, and moving it off DONE with its proof line", async () => {
    const otherClose = appendClosingLine(OPEN, proof("someone else", `${MAIL}/2`));
    await expect(
      guardWrite(patch({ bodyV2: { markdown: OPEN } }), storedTask("DONE", CLOSED)),
    ).rejects.toThrow(/is done/);
    await expect(
      guardWrite(patch({ bodyV2: { markdown: otherClose } }), storedTask("DONE", CLOSED)),
    ).rejects.toThrow(/is done/);
    await expect(
      guardWrite(patch({ status: "TODO", bodyV2: { markdown: OPEN } }), storedTask("DONE", CLOSED)),
    ).rejects.toThrow(/is done/);
    await expect(guardWrite(patch({ status: "TODO" }), storedTask("DONE", CLOSED))).rejects.toThrow(
      /ends in a proof line but the Task is not done/,
    );
    await expect(
      guardWrite(patch({ bodyV2: { markdown: CLOSED } }), storedTask("DONE", CLOSED)),
    ).resolves.toBeUndefined();
  });

  it("lets a done Task's note be rewritten by its reopening alone (CCI#1341)", async () => {
    const reopened = reopenNote(CLOSED, "the reply was on another matter").markdown!;
    expect(reopened.split("\n\n").pop()).toBe(
      `Closed ${formatDayMonth(new Date())} in error — reopened ${formatDayMonth(new Date())}: the reply was on another matter · proof was: "${LINE}" — [Gregor, 02.10](${MAIL})`,
    );
    expect(checkTaskNote(reopened, { done: false })).toEqual([]);
    await expect(
      guardWrite(
        patch({ status: "TODO", bodyV2: { markdown: reopened } }),
        storedTask("DONE", CLOSED),
      ),
    ).resolves.toBeUndefined();

    // Staying done, changing another line, changing the proof, no reason, an old date: refused.
    await expect(
      guardWrite(patch({ bodyV2: { markdown: reopened } }), storedTask("DONE", CLOSED)),
    ).rejects.toThrow(/rewritten only by its reopening/);
    const otherLine = reopened.replace("Svend, Ticket #20049", "Svend");
    await expect(
      guardWrite(
        patch({ status: "TODO", bodyV2: { markdown: otherLine } }),
        storedTask("DONE", CLOSED),
      ),
    ).rejects.toThrow(/closing line alone/);
    const otherProof = reopened.replace("[Gregor, 02.10]", "[Gregor]");
    await expect(
      guardWrite(
        patch({ status: "TODO", bodyV2: { markdown: otherProof } }),
        storedTask("DONE", CLOSED),
      ),
    ).rejects.toThrow(/date and proof as they stood/);
    const noReason = reopened.replace(": the reply was on another matter ·", ":   ·");
    await expect(
      guardWrite(
        patch({ status: "TODO", bodyV2: { markdown: noReason } }),
        storedTask("DONE", CLOSED),
      ),
    ).rejects.toThrow();
    const oldDate = reopened.replace(/reopened \d{2}\.\d{2}/, "reopened 01.01");
    await expect(
      guardWrite(
        patch({ status: "TODO", bodyV2: { markdown: oldDate } }),
        storedTask("DONE", CLOSED),
      ),
    ).rejects.toThrow(/not the day of the reopening/);

    const otherQuote = reopened.replace(LINE, "Something else.");
    await expect(
      guardWrite(
        patch({ status: "TODO", bodyV2: { markdown: otherQuote } }),
        storedTask("DONE", CLOSED),
      ),
    ).rejects.toThrow(/date and proof as they stood/);

    // The reopened Task closes again, its new proof line last after the wrong close.
    const reclosed = appendClosingLine(reopened, proof("the right reply", `${MAIL}/3`));
    expect(checkTaskNote(reclosed, { done: true })).toEqual([]);
  });

  it("reopens a Task closed in the earlier shape, keeping its proof as it stood (CCI#1363)", async () => {
    const reopened = reopenNote(EARLIER, "wrong reply").markdown!;
    expect(reopened.split("\n\n").pop()).toBe(
      `Closed 06.10 in error — reopened ${formatDayMonth(new Date())}: wrong reply · proof was: [Gregor, 02.10](${MAIL})`,
    );
    expect(checkTaskNote(reopened, { done: false })).toEqual([]);
    await expect(
      guardWrite(
        patch({ status: "TODO", bodyV2: { markdown: reopened } }),
        storedTask("DONE", EARLIER),
      ),
    ).resolves.toBeUndefined();
    // A reopen line that invents a quote the wrong close never carried is refused.
    const invented = reopened.replace("proof was: [", `proof was: "${LINE}" — [`);
    await expect(
      guardWrite(
        patch({ status: "TODO", bodyV2: { markdown: invented } }),
        storedTask("DONE", EARLIER),
      ),
    ).rejects.toThrow(/date and proof as they stood/);
    // A Task closed in the earlier shape stands through a write that touches neither note nor status.
    await expect(
      guardWrite(patch({ dueAt: "2026-12-01" }), storedTask("DONE", EARLIER)),
    ).resolves.toBeUndefined();
  });

  it("refuses an outside writer's close in the earlier shape (CCI#1363)", async () => {
    const bare = `${OPEN}\n\nClosed ${formatDayMonth(new Date())} · proof: [Gregor, 02.10](${MAIL})`;
    await expect(
      guardWrite(patch({ status: "DONE", bodyV2: { markdown: bare } }), storedTask("TODO", OPEN)),
    ).rejects.toThrow(/does not quote the line that closed it/);
    await expect(
      guardWrite(post({ title: "x", status: "DONE", bodyV2: { markdown: bare } }), none),
    ).rejects.toThrow(/does not quote the line that closed it/);
  });

  it("refuses a filter-wide close and a merge, and lets a dry-run merge through", async () => {
    await expect(guardWrite(patch({ status: "DONE" }, "/rest/tasks"), none)).rejects.toThrow(
      /filter-wide/,
    );
    await expect(guardWrite(patch({}, "/rest/tasks/merge"), none)).rejects.toThrow(/merge/);
    await expect(
      guardWrite(patch({ dryRun: true }, "/rest/tasks/merge"), none),
    ).resolves.toBeUndefined();
  });

  it("refuses an Opportunity closed, or born closed, without why it stopped", async () => {
    const opp = (data: unknown, url = "/rest/opportunities/o1") => ({
      method: "patch",
      baseURL: BASE,
      url,
      data,
    });
    await expect(
      guardWrite(opp({ stage: "CLOSED_LOST" }), storedOpp("OPEN", null)),
    ).rejects.toThrow(/whyStopped/);
    await expect(
      guardWrite(
        opp({ stage: "CLOSED_WON", whyStopped: { primaryLinkUrl: MAIL } }),
        storedOpp("OPEN", null),
      ),
    ).resolves.toBeUndefined();
    await expect(
      guardWrite(opp({ whyStopped: null }), storedOpp("CLOSED_LOST", MAIL)),
    ).rejects.toThrow(/empty/);
    await expect(
      guardWrite(
        {
          method: "post",
          baseURL: BASE,
          url: "/rest/opportunities",
          data: { name: "x", stage: "CLOSED_LOST" },
        },
        none,
      ),
    ).rejects.toThrow(/CLOSED_LOST/);
    await expect(
      guardWrite(opp({ stage: "NURTURE" }), storedOpp("OPEN", null)),
    ).resolves.toBeUndefined();
  });
});

describe("an open Task's title does not change (CCI#1346)", () => {
  const titled =
    (status: string, title = "We owe the offer"): StoredReader =>
    async () => ({ id: "t1", status, title, bodyV2: { markdown: OPEN } });
  const retitled = /an open Task's title does not change — a changed owing closes this Task/;
  const patchTask = (data: unknown, url = "/rest/tasks/t1") => ({
    method: "patch",
    baseURL: BASE,
    url,
    data,
  });

  it("refuses a new title by REST update, upsert, GraphQL, MCP and a batch, naming the title it reads", async () => {
    const routes = [
      patchTask({ title: "New" }),
      { method: "put", baseURL: BASE, url: "/rest/core/tasks/t1", data: { title: "New" } },
      {
        method: "post",
        baseURL: BASE,
        url: "/rest/tasks?upsert=true",
        data: { id: "t1", title: "New", bodyV2: { markdown: OPEN } },
      },
      {
        method: "post",
        baseURL: BASE,
        url: "/graphql",
        data: { query: 'mutation { updateTask(id: "t1", data: { title: "New" }) { id } }' },
      },
      {
        method: "post",
        baseURL: BASE,
        url: "/graphql",
        data: {
          query:
            "mutation M($d: [TaskCreateInput!]!) { createTasks(data: $d, upsert: true) { id } }",
          variables: { d: [{ id: "t1", title: "New", bodyV2: { markdown: OPEN } }] },
        },
      },
      {
        method: "post",
        baseURL: BASE,
        url: "/mcp",
        data: {
          method: "tools/call",
          params: { name: "update_one_task", arguments: { id: "t1", title: "New" } },
        },
      },
    ];
    for (const request of routes) {
      await expect(guardWrite(request, titled("TODO")), JSON.stringify(request)).rejects.toThrow(
        retitled,
      );
    }
    await expect(guardWrite(patchTask({ title: "New" }), titled("IN_PROGRESS"))).rejects.toThrow(
      /Task t1 reads "We owe the offer"/,
    );
  });

  it("refuses a create or import that names an open Task's id with another title, upsert or not", async () => {
    for (const url of ["/rest/tasks", "/rest/batch/tasks"]) {
      await expect(
        guardWrite(
          {
            method: "post",
            baseURL: BASE,
            url,
            data: [{ id: "t1", title: "New", bodyV2: { markdown: OPEN } }],
          },
          titled("TODO"),
        ),
      ).rejects.toThrow(retitled);
    }
  });

  it("refuses a title written in the same write as the close or the reopening", async () => {
    await expect(
      guardWrite(
        patchTask({ title: "New", status: "DONE", bodyV2: { markdown: CLOSED } }),
        titled("TODO"),
      ),
    ).rejects.toThrow(retitled);
    await expect(
      guardWrite(patchTask({ title: "", status: "TODO" }), titled("DONE")),
    ).rejects.toThrow(retitled);
  });

  it("refuses a filter-wide title and a merge of Tasks, saying the title rule", async () => {
    await expect(
      guardWrite(patchTask({ title: "New" }, "/rest/tasks"), titled("TODO")),
    ).rejects.toThrow(/filter-wide update of title .*an open Task's title does not change/);
    await expect(
      guardWrite(
        { method: "post", baseURL: BASE, url: "/rest/tasks/merge", data: { ids: ["a", "b"] } },
        none,
      ),
    ).rejects.toThrow(/title, note and status.*an open Task's title does not change/);
  });

  it("lets a Task whose title is empty or blank take its first title, as the store does", async () => {
    for (const before of ["", "  "]) {
      await expect(
        guardWrite(patchTask({ title: "The first title" }), titled("TODO", before)),
      ).resolves.toBeUndefined();
    }
  });

  it("lets a write that leaves the title as it stood through, and the moves that never name it", async () => {
    for (const data of [
      { title: "We owe the offer", dueAt: "2026-12-01" },
      { dueAt: "2026-12-01" },
      { assigneeId: "m1" },
      { roomId: "e1" },
      { waitsOnId: "t2" },
      { ticket: "19966" },
      { bodyV2: { markdown: OPEN } },
    ]) {
      await expect(
        guardWrite(patchTask(data), titled("TODO")),
        JSON.stringify(data),
      ).resolves.toBeUndefined();
    }
  });
});
