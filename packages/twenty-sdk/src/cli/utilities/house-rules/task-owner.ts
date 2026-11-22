import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { IssueRef } from "./task-note";

/**
 * An open Task has its owner (CCI#1361, A Task's Life Part 5): "Its writer names the owner;
 * where he does not, the owner is the assignee of the GitHub issue the Task's note names,
 * the person driving that work … where the writer names nobody and the issue has no
 * assignee, the house's command-line tool refuses the Task and asks who owns it."
 *
 * This module is that rule as code. `ownerOf` resolves who owns a Task about to stand open:
 *
 *   1. the workspace member `--assignee` names, when the writer names one;
 *   2. else the issue's one assignee, mapped to the workspace member whose `userEmail` is
 *      that person's email — the house's login table below first, since a carrier's GitHub
 *      account may carry no public email (MariusWilsch does not), then GitHub's public email;
 *   3. else nobody — and the write is refused, saying `--assignee` names the owner. An issue
 *      with no assignee, with two (both named, neither picked: David's determination of
 *      22.11 at CCI#1361's pin), or whose assignee is no workspace member resolves nobody.
 *
 * Nothing here writes. GitHub is read through the `gh` the host is signed in to, the same
 * route the house's other tools take (daily-settle `read_planes.py`).
 */

/**
 * The house's GitHub logins and the email each signs in to Twenty with — the same table as
 * daily-settle's `CARRIERS` (read_planes.py), which resolves a carrier's member by
 * `userEmail`. A login not in it is resolved by its public GitHub email, if it has one.
 */
export const HOUSE_LOGINS: Readonly<Record<string, string>> = {
  MariusWilsch: "marius@wilsch-ai.com",
  DaveX2001: "david@wilsch-ai.com",
};

/** The owner rule as a session reads it in the help (AC4: the help is its one home). */
export const OWNER_RULE =
  "An open Task has an owner: the workspace member --assignee names, else the assignee of the GitHub issue its note names (--issue), mapped to the workspace member whose email is that person's; where neither tells — no --assignee and no issue, an issue with no assignee, with two (both named, neither picked), or whose assignee is no workspace member — the write is refused, nothing is written, and --assignee names the owner. An open Task's owner can be changed (set-assignee), never cleared; a closed Task with no owner is reopened only with one.";

export interface WorkspaceMember {
  id: string;
  userEmail?: string | null;
  name?: { firstName?: string | null; lastName?: string | null } | null;
}

/** How the house reads GitHub; replaced in tests. */
export interface GitHubReader {
  /** The logins assigned to the issue. Throws when the issue cannot be read. */
  issueAssignees(ref: IssueRef): Promise<string[]>;
  /** The login's public email, or undefined when it shows none. */
  publicEmail(login: string): Promise<string | undefined>;
}

const run = promisify(execFile);

async function gh(args: string[]): Promise<string> {
  const { stdout } = await run("gh", args, { timeout: 30_000, maxBuffer: 1 << 20 });
  return stdout.trim();
}

export const githubViaGh: GitHubReader = {
  async issueAssignees(ref) {
    const out = await gh([
      "api",
      `repos/${ref.owner}/${ref.repo}/issues/${ref.number}`,
      "--jq",
      "[.assignees[].login]",
    ]);
    const logins = JSON.parse(out) as unknown;
    if (!Array.isArray(logins) || logins.some((l) => typeof l !== "string")) {
      throw new Error(`unexpected answer from GitHub: ${out.slice(0, 120)}`);
    }
    return logins as string[];
  },
  async publicEmail(login) {
    const email = await gh(["api", `users/${login}`, "--jq", ".email // empty"]);
    return email || undefined;
  },
};

/** The reader `ownerOf` uses when it is handed none; tests put a fake GitHub here. */
export const github: { reader: GitHubReader } = { reader: githubViaGh };

export type OwnerResolution =
  | { memberId: string; source: "assignee" | "issue"; login?: string }
  | { problem: string };

const ref = (issue: IssueRef) => `${issue.owner}/${issue.repo}#${issue.number}`;

const ASK =
  "--assignee names the owner: pass --assignee <workspaceMemberId>, the workspace member who owns it (twenty api list workspaceMembers lists them)";

/** The refusal line for a Task whose owner cannot be told, saying why and asking who. */
export function cannotTell(why: string): string {
  return `who owns the Task cannot be told: ${why} — ${ASK}`;
}

/**
 * Who owns a Task about to stand open: the named member, else the issue's assignee's member,
 * else a problem saying why nobody can be told. `members` is the workspace as stored.
 */
export async function ownerOf(input: {
  assignee?: string;
  issue?: IssueRef;
  members: WorkspaceMember[];
  github?: GitHubReader;
}): Promise<OwnerResolution> {
  const named = input.assignee?.trim();
  if (input.assignee !== undefined && !named) {
    return { problem: `--assignee is empty — ${ASK}` };
  }
  if (named) {
    return input.members.some((m) => m.id === named)
      ? { memberId: named, source: "assignee" }
      : { problem: `--assignee names workspace member ${named}, which is not on the instance` };
  }
  if (!input.issue) {
    return {
      problem: cannotTell(
        "no --assignee names its owner and no --issue names an issue whose assignee would",
      ),
    };
  }

  const reader = input.github ?? github.reader;
  let logins: string[];
  try {
    logins = await reader.issueAssignees(input.issue);
  } catch (error) {
    return {
      problem: cannotTell(
        `the assignee of ${ref(input.issue)} could not be read from GitHub (${firstLine(error)})`,
      ),
    };
  }
  if (logins.length === 0) {
    return { problem: cannotTell(`${ref(input.issue)} has no assignee`) };
  }
  if (logins.length > 1) {
    return {
      problem: cannotTell(
        `${ref(input.issue)} has ${logins.length} assignees, ${listed(logins)}, and the tool picks none of them`,
      ),
    };
  }

  const login = logins[0]!;
  let email: string | undefined = HOUSE_LOGINS[login];
  if (!email) {
    try {
      email = await reader.publicEmail(login);
    } catch {
      email = undefined;
    }
  }
  const member = email
    ? input.members.find((m) => (m.userEmail ?? "").toLowerCase() === email!.toLowerCase())
    : undefined;
  if (!member) {
    return {
      problem: cannotTell(
        `${ref(input.issue)}'s assignee ${login} is no member of Twenty's workspace (${
          email
            ? `no workspace member signs in as ${email}`
            : "the house knows no email for that login"
        })`,
      ),
    };
  }
  return { memberId: member.id, source: "issue", login };
}

function listed(items: string[]): string {
  return items.length <= 2
    ? items.join(" and ")
    : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function firstLine(error: unknown): string {
  const message =
    (error as { stderr?: string }).stderr?.trim() || (error as Error).message || String(error);
  return message.split("\n")[0]!.slice(0, 160);
}
