import { CliError } from "../../utilities/errors/cli-error";
import type { RecordsService } from "../../utilities/records/services/records.service";

type Row = Record<string, unknown>;

/** What the one read fetches: raw rows, one list per object, before anything is resolved. */
export interface CompanyReadSource {
  company: Row;
  people: Row[];
  opportunities: Row[];
  taskTargets: Row[];
  tasks: Row[];
  workspaceMembers: Row[];
  /** Companies an Opportunity names as its partner source, by id. */
  companiesById: Map<string, Row>;
}

export interface Named {
  id: string;
  name: string;
  email?: string | null;
}

export interface CompanyReadTask {
  id: string;
  title: string | null;
  status: string | null;
  dueAt: string | null;
  assignee: Named | null;
  /** The note as written (markdown). */
  note: string | null;
  /** The first address the note holds — the artifact the Task points at. */
  noteAddress: string | null;
  noteAddresses: string[];
  /** Where the Task hangs: the Company itself and/or one of its Opportunities, by name. */
  on: Array<{ object: "company" | "opportunity"; id: string; name: string }>;
}

export interface CompanyRead {
  company: Row;
  people: Row[];
  opportunities: Row[];
  openTasks: CompanyReadTask[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const URL_IN_TEXT = /https?:\/\/[^\s)<>\]"']+/g;
const ID_CHUNK = 50;

/**
 * Fetch everything the one read needs, each list paged to completion: the Company (by id
 * or by name), its People, its Opportunities, every taskTarget on the Company or on any of
 * its Opportunities, those Tasks, and the workspace members who can be assigned.
 */
export async function fetchCompanyRead(
  records: RecordsService,
  ref: string,
): Promise<CompanyReadSource> {
  const company = await resolveCompany(records, ref);
  const companyId = company.id as string;

  const [people, opportunities, workspaceMembers] = await Promise.all([
    listAll(records, "people", `companyId[eq]:"${companyId}"`),
    listAll(records, "opportunities", `companyId[eq]:"${companyId}"`),
    listAll(records, "workspaceMembers"),
  ]);

  const opportunityIds = opportunities.map((o) => o.id as string);
  const taskTargets = [
    ...(await listAll(records, "taskTargets", `targetCompanyId[eq]:"${companyId}"`)),
    ...(await listByIds(records, "taskTargets", "targetOpportunityId", opportunityIds)),
  ];
  const taskIds = unique(taskTargets.map((t) => t.taskId as string).filter(Boolean));
  const tasks = await listByIds(records, "tasks", "id", taskIds);

  const partnerIds = unique(
    opportunities.map((o) => o.partnerSourcedId as string | null).filter(isString),
  );
  const partners = await listByIds(records, "companies", "id", partnerIds);

  return {
    company,
    people,
    opportunities,
    taskTargets,
    tasks,
    workspaceMembers,
    companiesById: new Map(partners.map((c) => [c.id as string, c])),
  };
}

/**
 * Assemble the answer from what was fetched: every identifier that names a Person, a
 * workspace member or a Company is replaced by its name, and only open Tasks (any status
 * but DONE — a Task with no status is open) are kept, soonest due first.
 */
export function assembleCompanyRead(source: CompanyReadSource): CompanyRead {
  const companyId = source.company.id as string;
  const members = new Map(source.workspaceMembers.map((m) => [m.id as string, member(m)]));
  const people = new Map(source.people.map((p) => [p.id as string, person(p)]));
  const opportunityNames = new Map(
    source.opportunities.map((o) => [o.id as string, String(o.name ?? "")]),
  );

  const onByTask = new Map<string, CompanyReadTask["on"]>();
  for (const target of source.taskTargets) {
    const taskId = target.taskId as string;
    const list = onByTask.get(taskId) ?? [];
    if (target.targetCompanyId === companyId) {
      list.push({ object: "company", id: companyId, name: String(source.company.name ?? "") });
    } else if (opportunityNames.has(target.targetOpportunityId as string)) {
      const id = target.targetOpportunityId as string;
      list.push({ object: "opportunity", id, name: opportunityNames.get(id) ?? "" });
    }
    onByTask.set(taskId, list);
  }

  const openTasks = source.tasks
    .filter((t) => t.status !== "DONE" && !t.deletedAt)
    .map((t): CompanyReadTask => {
      const note = noteText(t);
      const addresses = note ? unique(note.match(URL_IN_TEXT) ?? []) : [];
      const assigneeId = t.assigneeId as string | null;
      return {
        id: t.id as string,
        title: (t.title as string | null) ?? null,
        status: (t.status as string | null) ?? null,
        dueAt: (t.dueAt as string | null) ?? null,
        assignee: assigneeId
          ? (members.get(assigneeId) ?? { id: assigneeId, name: "(unknown member)" })
          : null,
        note,
        noteAddress: addresses[0] ?? null,
        noteAddresses: addresses,
        on: dedupeOn(onByTask.get(t.id as string) ?? []),
      };
    })
    .sort(byDueAt);

  return {
    company: resolveRow(source.company, { accountOwnerId: ["accountOwner", members] }),
    people: source.people.map((p) => ({
      ...person(p),
      jobTitle: p.jobTitle ?? null,
      phone: phoneOf(p),
      city: p.city ?? null,
    })),
    opportunities: source.opportunities.map((o) =>
      resolveRow(o, {
        pointOfContactId: ["pointOfContact", people],
        ownerId: ["owner", members],
        partnerSourcedId: [
          "partnerSourced",
          new Map(
            [...source.companiesById].map(([id, c]) => [id, { id, name: String(c.name ?? "") }]),
          ),
        ],
      }),
    ),
    openTasks,
  };
}

async function resolveCompany(records: RecordsService, ref: string): Promise<Row> {
  if (UUID.test(ref)) {
    const record = await records.get("companies", ref);
    if (!isRow(record) || !record.id) {
      throw new CliError(`No Company with id ${ref}`, "INVALID_ARGUMENTS");
    }
    return record;
  }
  const exact = await listAll(records, "companies", `name[eq]:${quote(ref)}`);
  if (exact.length === 1) return exact[0] as Row;
  const candidates =
    exact.length > 1
      ? exact
      : await listAll(records, "companies", `name[ilike]:${quote(`%${ref}%`)}`);
  if (candidates.length === 1) return candidates[0] as Row;
  throw new CliError(
    candidates.length === 0
      ? `No Company named "${ref}"`
      : `${candidates.length} Companies match "${ref}": ${candidates
          .map((c) => `${String(c.name)} (${String(c.id)})`)
          .join("; ")} — pass the name exactly or the id`,
    "INVALID_ARGUMENTS",
  );
}

async function listAll(records: RecordsService, object: string, filter?: string): Promise<Row[]> {
  const { data } = await records.listAll(object, filter ? { filter } : {});
  return data.filter(isRow);
}

async function listByIds(
  records: RecordsService,
  object: string,
  field: string,
  ids: string[],
): Promise<Row[]> {
  const rows: Row[] = [];
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const chunk = ids.slice(i, i + ID_CHUNK).map((id) => `"${id}"`);
    rows.push(...(await listAll(records, object, `${field}[in]:[${chunk.join(",")}]`)));
  }
  return rows;
}

/** Copy a record's own fields, dropping store bookkeeping, and swap each named id for its name. */
function resolveRow(row: Row, relations: Record<string, [string, Map<string, Named>]>): Row {
  const out: Row = {};
  for (const [key, value] of Object.entries(row)) {
    if (["searchVector", "position", "deletedAt", "createdBy", "updatedBy"].includes(key)) continue;
    const relation = relations[key];
    if (relation) {
      const [name, lookup] = relation;
      out[name] =
        typeof value === "string" ? (lookup.get(value) ?? { id: value, name: null }) : null;
      continue;
    }
    if (key === "companyId") continue; // it is the Company being read
    out[key] = value;
  }
  return out;
}

function member(m: Row): Named {
  return { id: m.id as string, name: fullName(m.name), email: (m.userEmail as string) ?? null };
}

function person(p: Row): Named {
  const emails = p.emails as { primaryEmail?: string } | undefined;
  return { id: p.id as string, name: fullName(p.name), email: emails?.primaryEmail || null };
}

function fullName(name: unknown): string {
  if (!isRow(name)) return String(name ?? "");
  return [name.firstName, name.lastName].filter((s) => typeof s === "string" && s).join(" ");
}

function phoneOf(p: Row): string | null {
  const phones = p.phones as { primaryPhoneNumber?: string; primaryPhoneCallingCode?: string };
  if (!phones?.primaryPhoneNumber) return null;
  return `${phones.primaryPhoneCallingCode ?? ""}${phones.primaryPhoneNumber}`.trim();
}

function noteText(t: Row): string | null {
  const body = t.bodyV2 as { markdown?: string | null } | undefined;
  const markdown = body?.markdown;
  return typeof markdown === "string" && markdown.trim() !== "" ? markdown : null;
}

function dedupeOn(on: CompanyReadTask["on"]): CompanyReadTask["on"] {
  const seen = new Set<string>();
  return on.filter((o) => {
    const key = `${o.object}:${o.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function byDueAt(a: CompanyReadTask, b: CompanyReadTask): number {
  if (a.dueAt === b.dueAt) return 0;
  if (a.dueAt === null) return 1;
  if (b.dueAt === null) return -1;
  return a.dueAt < b.dueAt ? -1 : 1;
}

function quote(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`;
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value !== "";
}

function isRow(value: unknown): value is Row {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
