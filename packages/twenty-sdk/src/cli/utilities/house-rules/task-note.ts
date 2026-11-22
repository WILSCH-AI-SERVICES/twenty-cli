/**
 * The Task note in one shape (DaveX2001/deliverable-tracking#3266).
 *
 * The house's CRM design fixes what a Task's note holds: an open Task's note holds the
 * address of the artifact it rests on and, where there is one, the GitHub issue the work
 * sits on; a closed Task's note ends in one line, `Closed DD.MM · proof: [what it is](address)`
 * (https://docs.wilsch-ai.com/partner-lead-crm-design Part 2). This module is that shape as
 * code: `emitOpenNote` / `appendClosingLine` write it, `checkTaskNote` refuses anything else.
 *
 * The rendering, one markdown paragraph per line:
 *
 *   Rests on: [Svend, Ticket #20049, 05.10](https://mail.google.com/...)
 *   Issue: [DaveX2001/deliverable-tracking#2296](https://github.com/DaveX2001/deliverable-tracking/issues/2296)
 *   Closed 06.10 · proof: [Gregor, 02.10: access is set up](https://mail.google.com/...)
 *
 * `Issue:` is optional; the closing line is present exactly when the Task is done, and last.
 * Nothing else is part of the note: a retelling of the artifact is what the artifact is for —
 * save one line per close made in error (CCI#1341). Reopening a Task turns its closing line
 * into
 *
 *   Closed 06.10 in error — reopened 16.11: the reply was on another matter · proof was: [Gregor, 02.10: access is set up](https://mail.google.com/...)
 *
 * keeping the wrong close's date and proof, dated the day of the reopening, with why; the
 * Task is back to to do and can be closed again, its new proof line last (A Task's Life,
 * Parts 4 and 5). `reopenNote` writes it, `reopeningProblems` tells a reopening from any other
 * rewrite of a done Task's note, which stays refused. `sql/house-shape.sql` in
 * crm-2990-twenty holds the same rule in the store.
 */

export const DEFAULT_ISSUE_REPO = "DaveX2001/deliverable-tracking";

const RESTS_ON = /^Rests on: \[([^\]\n]+)\]\(([^\s)]+)\)$/;
const ISSUE = /^Issue: \[([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)#(\d+)\]\(([^\s)]+)\)$/;
const CLOSED = /^Closed (\d{2})\.(\d{2}) · proof: \[([^\]\n]+)\]\(([^\s)]+)\)$/;
const REOPENED =
  /^Closed (\d{2})\.(\d{2}) in error — reopened (\d{2})\.(\d{2}): (.+) · proof was: \[([^\]\n]+)\]\(([^\s)]+)\)$/;

export const RESTS_ON_SHAPE = "Rests on: [what it is](address)";
export const CLOSED_SHAPE = "Closed DD.MM · proof: [what it is](address)";
export const REOPENED_SHAPE =
  "Closed DD.MM in error — reopened DD.MM: why · proof was: [what it is](address)";

export interface IssueRef {
  owner: string;
  repo: string;
  number: number;
}

/** An address a reader can open: an absolute http(s) URL with a host. */
export function isAddress(value: unknown): value is string {
  if (typeof value !== "string" || value.trim() !== value || value === "") return false;
  if (/[\s()]/.test(value)) return false;
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && url.hostname !== "";
  } catch {
    return false;
  }
}

/** `owner/repo#N`, `#N` or `N` (the latter two on deliverable-tracking), or an issue URL. */
export function parseIssueRef(value: string): IssueRef | undefined {
  const trimmed = value.trim();
  const url = trimmed.match(
    /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/issues\/(\d+)\/?$/,
  );
  if (url) return { owner: url[1]!, repo: url[2]!, number: Number(url[3]) };
  const full = trimmed.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)#(\d+)$/);
  if (full) return { owner: full[1]!, repo: full[2]!, number: Number(full[3]) };
  const bare = trimmed.match(/^#?(\d+)$/);
  if (bare) {
    const [owner, repo] = DEFAULT_ISSUE_REPO.split("/") as [string, string];
    return { owner, repo, number: Number(bare[1]) };
  }
  return undefined;
}

/** The GitHub issue a note's `Issue:` line names, or undefined when it names none. */
export function noteIssue(markdown: string | undefined | null): IssueRef | undefined {
  for (const line of noteLines(markdown ?? "")) {
    const issue = line.match(ISSUE);
    if (issue) return { owner: issue[1]!, repo: issue[2]!, number: Number(issue[3]) };
  }
  return undefined;
}

function issueUrl(ref: IssueRef): string {
  return `https://github.com/${ref.owner}/${ref.repo}/issues/${ref.number}`;
}

/** A label sits inside `[...]` on one line. */
export function labelProblem(label: string | undefined, what: string): string | undefined {
  if (label === undefined || label.trim() === "") return `${what} has no label (what it is)`;
  if (/[\]\n\r]/.test(label)) return `${what}'s label may not contain "]" or a line break`;
  return undefined;
}

export function formatDayMonth(date: Date): string {
  return `${String(date.getDate()).padStart(2, "0")}.${String(date.getMonth() + 1).padStart(2, "0")}`;
}

/** The days a close made now may be dated: today on this machine's calendar, and in UTC. */
export function todaysDayMonths(now: Date = new Date()): string[] {
  const utc = `${String(now.getUTCDate()).padStart(2, "0")}.${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  return [...new Set([formatDayMonth(now), utc])];
}

export function emitOpenNote(input: {
  restsOnLabel: string;
  restsOnUrl: string;
  issue?: IssueRef;
}): string {
  const lines = [`Rests on: [${input.restsOnLabel.trim()}](${input.restsOnUrl})`];
  if (input.issue) {
    const ref = input.issue;
    lines.push(`Issue: [${ref.owner}/${ref.repo}#${ref.number}](${issueUrl(ref)})`);
  }
  return lines.join("\n\n");
}

export function closingLine(label: string, url: string, now: Date = new Date()): string {
  return `Closed ${formatDayMonth(now)} · proof: [${label.trim()}](${url})`;
}

export function appendClosingLine(note: string, line: string): string {
  return `${note.trimEnd()}\n\n${line}`;
}

/** The lines a reopening left in `markdown`, in order — each a close made in error. */
export function reopenLines(markdown: string | undefined | null): string[] {
  return noteLines(markdown ?? "").filter((line) => REOPENED.test(line));
}

/** Whether a reason for a reopening is one line of text. */
export function reasonProblem(why: string | undefined): string | undefined {
  if (why === undefined || why.trim() === "") {
    return "the reopening does not say why the close was made in error — pass --why <reason>";
  }
  if (/[\n\r]/.test(why)) return "the reason may not contain a line break";
  return undefined;
}

/**
 * The note of a done Task reopened today: its closing line turned into the reopen line,
 * every other line as it stood. Problems are returned when the note does not end in a
 * closing line, so there is no close to undo.
 */
export function reopenNote(
  markdown: string,
  why: string,
  now: Date = new Date(),
): { markdown?: string; problems: string[] } {
  const lines = noteLines(markdown);
  const closed = lines[lines.length - 1]?.match(CLOSED);
  if (!closed) {
    return {
      problems: [
        `the note does not end in a closing line (${CLOSED_SHAPE}), so there is no close to undo`,
      ],
    };
  }
  const [, dd, mm, label, url] = closed;
  const line = `Closed ${dd}.${mm} in error — reopened ${formatDayMonth(now)}: ${why.trim()} · proof was: [${label}](${url})`;
  return { markdown: [...lines.slice(0, -1), line].join("\n\n"), problems: [] };
}

/**
 * Why rewriting a done Task's note from `before` to `after` is not its reopening; empty when
 * it is. A reopening moves the Task off DONE and turns the closing line alone into the
 * reopen line, keeping the close's date and proof, dated one of `reopenDates`, with a reason.
 */
export function reopeningProblems(
  before: unknown,
  after: unknown,
  check: { nowOpen: boolean; reopenDates?: string[] },
): string[] {
  const rule =
    "the Task is done — its note ends in its proof line, and a rewrite would lose it; a done Task's note is rewritten only by its reopening (twenty tasks reopen), which keeps the wrong close as a dated line";
  if (!check.nowOpen || typeof before !== "string" || typeof after !== "string") return [rule];
  const old = noteLines(before);
  const next = noteLines(after);
  if (old.length === 0 || next.length !== old.length) {
    return [`${rule}: the reopening rewrites the closing line alone`];
  }
  const closed = old[old.length - 1]!.match(CLOSED);
  const reopened = next[next.length - 1]!.match(REOPENED);
  if (!closed || !reopened) return [`${rule}: the closing line becomes ${REOPENED_SHAPE}`];
  if (old.slice(0, -1).some((line, i) => line !== next[i])) {
    return [`${rule}: the reopening rewrites the closing line alone`];
  }
  const [, cd, cm, label, url] = closed;
  const [, rd, rm, od, om, why, rLabel, rUrl] = reopened;
  if (rd !== cd || rm !== cm || rLabel !== label || rUrl !== url) {
    return [`${rule}: the reopen line must keep the wrong close's date and proof as they stood`];
  }
  if (check.reopenDates && !check.reopenDates.includes(`${od}.${om}`)) {
    return [
      `the reopen line is dated ${od}.${om}, not the day of the reopening (${check.reopenDates[0]})`,
    ];
  }
  if (why!.trim() === "") return ["the reopening does not say why the close was made in error"];
  return [];
}

function noteLines(markdown: string): string[] {
  return markdown
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

function excerpt(line: string): string {
  return line.length > 80 ? `${line.slice(0, 77)}...` : line;
}

export interface NoteCheck {
  /** Whether the note's Task is done after the write. */
  done: boolean;
  /** When the write is the close itself, the closing line must carry one of these dates. */
  closingDates?: string[];
}

/**
 * Every way `markdown` falls outside the one shape, each naming what is missing or wrong.
 * An empty list means the note is in shape.
 */
export function checkTaskNote(markdown: unknown, check: NoteCheck): string[] {
  if (markdown === undefined || markdown === null) {
    return [
      `the Task has no note — it is missing the address of the artifact it rests on (${RESTS_ON_SHAPE})`,
    ];
  }
  if (typeof markdown !== "string") return ["the note's markdown is not text"];
  const lines = noteLines(markdown);
  if (lines.length === 0) {
    return [
      `the note is empty — it is missing the address of the artifact it rests on (${RESTS_ON_SHAPE})`,
    ];
  }

  const problems: string[] = [];
  let index = 0;

  const restsOn = lines[0]!.match(RESTS_ON);
  if (!restsOn) {
    problems.push(
      `the note does not open with the address of the artifact it rests on — its first line must be ${RESTS_ON_SHAPE}, found "${excerpt(lines[0]!)}"`,
    );
  } else {
    index = 1;
    const label = labelProblem(restsOn[1], "the Rests on line");
    if (label) problems.push(label);
    if (!isAddress(restsOn[2])) {
      problems.push(`the Rests on line's address "${restsOn[2]}" is not an http(s) URL`);
    }
  }

  if (index < lines.length && lines[index]!.startsWith("Issue:")) {
    const issue = lines[index]!.match(ISSUE);
    if (!issue) {
      problems.push(
        `the Issue line must be Issue: [owner/repo#N](https://github.com/owner/repo/issues/N), found "${excerpt(lines[index]!)}"`,
      );
    } else if (issue[4] !== `https://github.com/${issue[1]}/${issue[2]}/issues/${issue[3]}`) {
      problems.push(`the Issue line's link does not point at ${issue[1]}/${issue[2]}#${issue[3]}`);
    }
    index += 1;
  }

  const rest = lines.slice(index);
  const last = rest.length > 0 ? rest[rest.length - 1]! : undefined;
  const closed = last?.match(CLOSED);
  const extra = closed ? rest.slice(0, -1) : rest;

  for (const line of extra) {
    const reopened = line.match(REOPENED);
    if (reopened) {
      const [, cd, cm, od, om, why, label, url] = reopened;
      if (
        ![
          [cd, cm],
          [od, om],
        ].every(([d, m]) => Number(m) >= 1 && Number(m) <= 12 && Number(d) >= 1 && Number(d) <= 31)
      ) {
        problems.push(
          `the reopen line "${excerpt(line)}" carries a date that is not a day of the year`,
        );
      }
      if (why!.trim() === "") {
        problems.push(
          `the reopen line "${excerpt(line)}" does not say why the close was made in error`,
        );
      }
      const labelIssue = labelProblem(label, "the reopen line's proof");
      if (labelIssue) problems.push(labelIssue);
      if (!isAddress(url))
        problems.push(`the reopen line's proof address "${url}" is not an http(s) URL`);
      continue;
    }
    problems.push(
      CLOSED.test(line)
        ? `the closing line "${excerpt(line)}" is not the note's last line`
        : `the note carries a line outside its shape: "${excerpt(line)}" — a note holds the address it rests on, the issue, a line for each close made in error, and on close the proof line, nothing else`,
    );
  }

  if (check.done) {
    if (!closed) {
      problems.push(
        `the Task is done but its note does not end in its proof line — the close is missing ${CLOSED_SHAPE}`,
      );
    } else {
      const [, dd, mm, label, url] = closed;
      const day = Number(dd);
      const month = Number(mm);
      if (!(month >= 1 && month <= 12 && day >= 1 && day <= 31)) {
        problems.push(`the proof line's date ${dd}.${mm} is not a day of the year`);
      } else if (check.closingDates && !check.closingDates.includes(`${dd}.${mm}`)) {
        problems.push(
          `the proof line is dated ${dd}.${mm}, not the day of the close (${check.closingDates[0]})`,
        );
      }
      const labelIssue = labelProblem(label, "the proof");
      if (labelIssue) problems.push(labelIssue);
      if (!isAddress(url)) problems.push(`the proof's address "${url}" is not an http(s) URL`);
    }
  } else if (closed) {
    problems.push(
      `the note ends in a proof line but the Task is not done — set its status to DONE with the close, or drop the line`,
    );
  }

  return problems;
}
