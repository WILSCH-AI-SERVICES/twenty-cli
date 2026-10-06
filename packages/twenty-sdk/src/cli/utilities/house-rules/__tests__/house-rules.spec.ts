import { describe, expect, it } from "vitest";

import {
  appendClosingLine,
  checkTaskNote,
  closingLine,
  emitOpenNote,
  formatDayMonth,
  parseIssueRef,
} from "../task-note";
import { guardWrite, intendedWrites, type StoredReader } from "../write-guard";

const MAIL = "https://example.com/mail/1a10c1e0d880919a";
const OPEN = emitOpenNote({
  restsOnLabel: "Svend, Ticket #20049, 05.10",
  restsOnUrl: MAIL,
  issue: parseIssueRef("#2296"),
});
const CLOSED = appendClosingLine(OPEN, closingLine("Gregor, 02.10", MAIL));
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

  it("accepts a closed note dated today, as its last line", () => {
    expect(
      CLOSED.endsWith(`Closed ${formatDayMonth(new Date())} · proof: [Gregor, 02.10](${MAIL})`),
    ).toBe(true);
    expect(
      checkTaskNote(CLOSED, { done: true, closingDates: [formatDayMonth(new Date())] }),
    ).toEqual([]);
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
