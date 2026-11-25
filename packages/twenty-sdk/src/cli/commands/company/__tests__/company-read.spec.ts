import { describe, expect, it } from "vitest";

import type { RecordsService } from "../../../utilities/records/services/records.service";
import {
  assembleCompanyRead,
  fetchCompanyRead,
  type CompanyReadSource,
} from "../company-read.service";

const CO = "c0000000-0000-4000-8000-000000000000";
const OPP = "o0000000-0000-4000-8000-000000000000";
const MARIUS = "m0000000-0000-4000-8000-000000000001";
const THOMAS = "p0000000-0000-4000-8000-000000000001";

function source(overrides: Partial<CompanyReadSource> = {}): CompanyReadSource {
  return {
    company: { id: CO, name: "Lead GmbH", accountOwnerId: MARIUS, searchVector: "x" },
    people: [
      {
        id: THOMAS,
        name: { firstName: "Thomas", lastName: "Erhard" },
        emails: { primaryEmail: "erhard@lead.example" },
        companyId: CO,
      },
    ],
    opportunities: [
      { id: OPP, name: "Angebot 1", companyId: CO, pointOfContactId: THOMAS, ownerId: null },
    ],
    taskTargets: [
      // the case of 6 October: a lead's Task hangs on its Opportunity, not on the Company
      { taskId: "t-opp", targetOpportunityId: OPP, targetCompanyId: null },
      { taskId: "t-co", targetCompanyId: CO, targetOpportunityId: null },
      { taskId: "t-done", targetCompanyId: CO, targetOpportunityId: null },
      { taskId: "t-null", targetCompanyId: CO, targetOpportunityId: null },
    ],
    tasks: [
      {
        id: "t-opp",
        title: "Thomas owes the order",
        status: "TODO",
        dueAt: "2026-10-09T08:00:00.000Z",
        assigneeId: MARIUS,
        bodyV2: { markdown: "Asked: https://example.com/mail/abc · DT#1" },
      },
      {
        id: "t-co",
        title: "Chase the handover",
        status: "IN_PROGRESS",
        dueAt: "2026-10-07T08:00:00.000Z",
        assigneeId: MARIUS,
        bodyV2: { markdown: "https://example.com/thread" },
      },
      { id: "t-done", title: "Done already", status: "DONE", dueAt: null, assigneeId: MARIUS },
      { id: "t-null", title: "No status yet", status: null, dueAt: null, assigneeId: null },
    ],
    workspaceMembers: [
      { id: MARIUS, name: { firstName: "Marius", lastName: "Wilsch" }, userEmail: "m@w.example" },
    ],
    companiesById: new Map(),
    ...overrides,
  };
}

describe("assembleCompanyRead", () => {
  it("keeps every open Task, on the Company or on its Opportunity, soonest due first", () => {
    const read = assembleCompanyRead(source());
    expect(read.openTasks.map((t) => t.id)).toEqual(["t-co", "t-opp", "t-null"]);
  });

  it("leaves out a done Task", () => {
    const read = assembleCompanyRead(source());
    expect(read.openTasks.find((t) => t.id === "t-done")).toBeUndefined();
  });

  it("spells each Task out: title, due date, assignee by name, the address its note holds", () => {
    const task = assembleCompanyRead(source()).openTasks.find((t) => t.id === "t-opp")!;
    expect(task).toMatchObject({
      title: "Thomas owes the order",
      dueAt: "2026-10-09T08:00:00.000Z",
      assignee: { id: MARIUS, name: "Marius Wilsch", email: "m@w.example" },
      noteAddress: "https://example.com/mail/abc",
      on: [{ object: "opportunity", id: OPP, name: "Angebot 1" }],
    });
    expect(task).not.toHaveProperty("assigneeId");
  });

  it("names a Task linked to both the Company and its Opportunity once per place", () => {
    const read = assembleCompanyRead(
      source({
        taskTargets: [
          { taskId: "t-opp", targetOpportunityId: OPP, targetCompanyId: null },
          { taskId: "t-opp", targetCompanyId: CO, targetOpportunityId: null },
          { taskId: "t-opp", targetCompanyId: CO, targetOpportunityId: null },
        ],
      }),
    );
    const task = read.openTasks.find((t) => t.id === "t-opp")!;
    expect(task.on.map((o) => o.object)).toEqual(["opportunity", "company"]);
  });

  it("replaces every id that names a Person or a member with its name", () => {
    const read = assembleCompanyRead(source());
    expect(read.people).toEqual([
      expect.objectContaining({ id: THOMAS, name: "Thomas Erhard", email: "erhard@lead.example" }),
    ]);
    expect(read.opportunities[0]).toMatchObject({
      pointOfContact: { id: THOMAS, name: "Thomas Erhard" },
      owner: null,
    });
    expect(read.company).toMatchObject({ accountOwner: { name: "Marius Wilsch" } });
    const json = JSON.stringify(read);
    for (const key of [
      "assigneeId",
      "pointOfContactId",
      "ownerId",
      "accountOwnerId",
      "searchVector",
    ])
      expect(json).not.toContain(`"${key}"`);
  });
});

describe("fetchCompanyRead", () => {
  const TASKS = 120; // more than two chunks of 50 ids

  /** A store that answers by object and records every list it is asked for, and how many ran at once. */
  function fakeRecords() {
    const calls: Array<{ object: string; filter?: string; limit?: number }> = [];
    let inFlight = 0;
    const peak: Record<string, number> = {};
    const rows: Record<string, Array<Record<string, unknown>>> = {
      companies: [{ id: CO, name: "Lead GmbH" }],
      people: [],
      opportunities: [{ id: OPP, name: "Angebot 1", companyId: CO }],
      workspaceMembers: [],
      taskTargets: Array.from({ length: TASKS }, (_, i) => ({
        taskId: `t-${i}`,
        targetCompanyId: CO,
      })),
      tasks: [],
    };
    const records = {
      async listAll(object: string, options: { filter?: string; limit?: number } = {}) {
        calls.push({ object, filter: options.filter, limit: options.limit });
        inFlight += 1;
        peak[object] = Math.max(peak[object] ?? 0, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight -= 1;
        const data =
          object === "taskTargets" && options.filter?.includes("targetOpportunityId")
            ? []
            : (rows[object] ?? []);
        return { data };
      },
    } as unknown as RecordsService;
    return { records, calls, peak };
  }

  it("asks only for open Tasks, a Task with no status counted open", async () => {
    const { records, calls } = fakeRecords();
    await fetchCompanyRead(records, "Lead GmbH");
    const taskCalls = calls.filter((c) => c.object === "tasks");
    expect(taskCalls).toHaveLength(3);
    for (const call of taskCalls)
      expect(call.filter).toMatch(/^id\[in\]:\[.+\],or\(status\[neq\]:DONE,status\[is\]:NULL\)$/);
  });

  it("asks for the largest page on every list", async () => {
    const { records, calls } = fakeRecords();
    await fetchCompanyRead(records, "Lead GmbH");
    expect(calls.every((c) => c.limit === 200)).toBe(true);
  });

  it("sends the chunks of Task ids at once, not one after another", async () => {
    const { records, peak } = fakeRecords();
    await fetchCompanyRead(records, "Lead GmbH");
    expect(peak.tasks).toBe(3);
  });
});
