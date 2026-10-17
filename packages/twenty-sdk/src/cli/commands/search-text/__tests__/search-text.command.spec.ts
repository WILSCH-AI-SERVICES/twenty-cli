import { Command } from "commander";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { CliError } from "../../../utilities/errors/cli-error";
import { registerSearchTextCommand, type TextHit } from "../search-text.command";

const mockCreateCommandContext = vi.hoisted(() => vi.fn());

vi.mock("../../../utilities/shared/context", async () => {
  const actual = await vi.importActual<typeof import("../../../utilities/shared/context")>(
    "../../../utilities/shared/context",
  );
  return { ...actual, createCommandContext: mockCreateCommandContext };
});

const page = (nodes: unknown[], endCursor?: string) => ({
  edges: nodes.map((node) => ({ node })),
  pageInfo: { hasNextPage: Boolean(endCursor), endCursor: endCursor ?? null },
});
const participant = (companyId: string | null) => ({
  node: { person: companyId ? { companyId } : null },
});

const MAILS = [
  page(
    [
      {
        id: "m1",
        subject: "Long stay",
        text: "a long stay at The Nove, Nuvasa\nBay. Viele Grüße",
        receivedAt: "2026-09-12T10:32:44.000Z",
        messageParticipants: { edges: [participant("c1"), participant(null), participant("c2")] },
      },
      {
        id: "m-far",
        subject: "Nuvasa",
        text: "Nuvasa is far from the Bay",
        receivedAt: "2026-09-13T00:00:00.000Z",
        messageParticipants: { edges: [] },
      },
    ],
    "cursor-1",
  ),
  page([
    {
      id: "m2",
      subject: "Second",
      text: "NUVASA BAY in capitals",
      receivedAt: "2026-10-01T00:00:00.000Z",
      messageParticipants: { edges: [participant("c1")] },
    },
  ]),
];
const CALLS = page([
  {
    id: "r1",
    title: "Kennenlerngespräch",
    startedAt: "2026-10-16T09:45:00.000Z",
    createdAt: "2026-10-16T14:01:59.795Z",
    transcript: [
      { words: [{ text: "Ein bisschen Nuvasa" }] },
      { words: [{ text: "Bay, aber gut." }] },
    ],
    company: { id: "c9", name: "Kaspers" },
  },
  {
    id: "r2",
    title: "Other",
    startedAt: null,
    createdAt: "2026-10-02T00:00:00.000Z",
    transcript: [{ words: [{ text: "nothing to see" }] }],
    company: null,
  },
]);
const COMPANIES = page([
  { id: "c1", name: "Garasi Rumah — Lia, property marketing" },
  { id: "c2", name: "Reotel" },
]);

describe("search-text command", () => {
  let program: Command;
  type Body = { query: string; variables: Record<string, unknown> };
  let post: Mock<(url: string, body: Body) => Promise<unknown>>;
  let rendered: TextHit[];

  beforeEach(() => {
    program = new Command();
    program.exitOverride();
    registerSearchTextCommand(program);
    rendered = [];
    let mailPage = 0;
    post = vi.fn(async (_url: string, body: Body) => {
      if (body.query.includes("SearchTextMessages"))
        return { data: { data: { messages: MAILS[mailPage++] } } };
      if (body.query.includes("SearchTextCalls"))
        return { data: { data: { callRecordings: CALLS } } };
      if (body.query.includes("SearchTextCompanies"))
        return { data: { data: { companies: COMPANIES } } };
      throw new Error(`unexpected query ${body.query}`);
    });
    mockCreateCommandContext.mockReset();
    mockCreateCommandContext.mockResolvedValue({
      globalOptions: { output: "json", query: undefined },
      services: {
        api: { post },
        output: { render: vi.fn(async (value: TextHit[]) => void (rendered = value)) },
      },
    });
  });

  const run = (...args: string[]) => program.parseAsync(["node", "twenty", "search-text", ...args]);

  it("finds mails across pages and calls across segments, newest first, each with Company, date and record", async () => {
    await run("nuvasa bay");

    expect(rendered.map((hit) => hit.record)).toEqual([
      "callRecording/r1",
      "message/m2",
      "message/m1",
    ]);
    const [call, m2, m1] = rendered;
    expect(call).toMatchObject({
      kind: "call",
      date: "2026-10-16T09:45:00.000Z",
      company: "Kaspers",
      companyId: "c9",
      open: "twenty api get callRecordings r1",
    });
    expect(m2).toMatchObject({
      kind: "mail",
      company: "Garasi Rumah — Lia, property marketing",
      companyId: "c1",
    });
    expect(m1).toMatchObject({
      date: "2026-09-12T10:32:44.000Z",
      company: "Garasi Rumah — Lia, property marketing, Reotel",
      companyId: "c1,c2",
      open: "twenty api get messages m1",
    });
    expect(m1.excerpt).toContain("Nuvasa Bay");

    const mailFilter = post.mock.calls[0][1].variables.filter;
    expect(mailFilter).toEqual({ or: [{ text: { ilike: "%nuvasa%bay%" } }] });
    expect(post.mock.calls[1][1].variables.after).toBe("cursor-1");
    const companiesCall = post.mock.calls.find(([, b]) => b.query.includes("SearchTextCompanies"));
    expect(companiesCall?.[1].variables.filter).toEqual({ id: { in: ["c1", "c2"] } });
  });

  it("finds an umlaut phrase as typed, and names no Company for a mail none of whose people sits on one", async () => {
    await run("Viele Grüße", "--only", "mail");
    expect(rendered).toHaveLength(1);
    expect(rendered[0]).toMatchObject({
      record: "message/m1",
      company: "Garasi Rumah — Lia, property marketing, Reotel",
    });

    rendered = [];
    post.mockImplementation(async (_url: string, body: Body) => {
      if (body.query.includes("SearchTextMessages"))
        return {
          data: {
            data: {
              messages: page([{ id: "m3", subject: "s", text: "Viele Grüße", receivedAt: null }]),
            },
          },
        };
      throw new Error("no other read expected");
    });
    await run("viele grüße", "--only", "mail");
    expect(rendered).toEqual([
      expect.objectContaining({ record: "message/m3", company: null, companyId: null, date: null }),
    ]);
  });

  it("reads only calls with --only call and caps hits with --limit", async () => {
    await run("Nuvasa Bay", "--only", "call");
    expect(rendered.map((hit) => hit.record)).toEqual(["callRecording/r1"]);
    expect(post.mock.calls.every(([, b]) => b.query.includes("SearchTextCalls"))).toBe(true);

    await run("Nuvasa Bay", "--limit", "1");
    expect(rendered).toHaveLength(1);
  });

  it("refuses an empty phrase, a bad --limit and an unknown kind before reaching the instance", async () => {
    await expect(run("   ")).rejects.toBeInstanceOf(CliError);
    await expect(run("x", "--limit", "0")).rejects.toThrow("--limit must be a positive number");
    await expect(run("x", "--only", "chat")).rejects.toThrow("--only takes mail, call or both");
    expect(post).not.toHaveBeenCalled();
  });

  it("surfaces a GraphQL error and a missing connection", async () => {
    post.mockResolvedValueOnce({ data: { errors: [{ message: "boom" }] } });
    await expect(run("x", "--only", "mail")).rejects.toThrow("boom");
    post.mockResolvedValueOnce({ data: { data: {} } });
    await expect(run("x", "--only", "call")).rejects.toThrow(
      "The instance returned no callRecordings.",
    );
  });
});
