/**
 * Translate a saved view's filters into the REST filter expression `twenty api list`
 * sends, so a terminal re-applies a view by name and gets back exactly the records the
 * view selects (DaveX2001/deliverable-tracking#3236 AC3: "a saved view is a named filter,
 * not a screen").
 *
 * Only the operands whose meaning is unambiguous are translated; any other operand is a
 * hard error naming it, never a silently wider or narrower result.
 */

import { CliError } from "../../utilities/errors/cli-error";

export interface ViewFilterInput {
  fieldName: string;
  fieldType: string;
  operand: string;
  value: string;
  viewFilterGroupId?: string | null;
  positionInViewFilterGroup?: number | null;
}

export interface ViewFilterGroupInput {
  id: string;
  parentViewFilterGroupId?: string | null;
  logicalOperator: string;
  positionInViewFilterGroup?: number | null;
}

export interface TranslateContext {
  now: Date;
  timeZone: string;
}

const DATE_TYPES = new Set(["DATE", "DATE_TIME"]);

/** The UTC instant at which the calendar day containing `at` begins in `timeZone`, plus `days`. */
export function startOfDayIn(at: Date, timeZone: string, days = 0): Date {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  const localMidnightAsUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day) + days,
  );
  // The zone's offset at that instant (two passes settle a DST boundary).
  let guess = localMidnightAsUtc;
  for (let i = 0; i < 2; i++) guess = localMidnightAsUtc - offsetMs(new Date(guess), timeZone);
  return new Date(guess);
}

function offsetMs(at: Date, timeZone: string): number {
  const name = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" })
    .formatToParts(at)
    .find((p) => p.type === "timeZoneName")?.value;
  const m = /GMT([+-])(\d{2}):?(\d{2})?/.exec(name ?? "");
  if (!m) return 0;
  const sign = m[1] === "-" ? -1 : 1;
  return sign * (Number(m[2]) * 60 + Number(m[3] ?? 0)) * 60_000;
}

function dateOperand(f: ViewFilterInput, at: Date): string {
  return f.fieldType === "DATE" ? at.toISOString().slice(0, 10) : at.toISOString();
}

function selectValues(f: ViewFilterInput): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(f.value);
  } catch {
    parsed = f.value;
  }
  const values = Array.isArray(parsed) ? parsed : [parsed];
  if (values.length === 0 || values.some((v) => typeof v !== "string" || /[,()[\]]/.test(v))) {
    throw new CliError(
      `View filter on ${f.fieldName} carries a value this translator cannot express: ${f.value}`,
      "INVALID_ARGUMENTS",
    );
  }
  return values as string[];
}

export function translateFilter(f: ViewFilterInput, ctx: TranslateContext): string {
  const n = f.fieldName;
  switch (f.operand) {
    case "IS_EMPTY":
      return `${n}[is]:NULL`;
    case "IS_NOT_EMPTY":
    case "IS_NOT_NULL":
      return `${n}[is]:NOT_NULL`;
  }
  if (f.fieldType === "SELECT") {
    if (f.operand === "IS") return `${n}[in]:[${selectValues(f).join(",")}]`;
    // A record with no value is "not" any of them — the view's own reading.
    if (f.operand === "IS_NOT")
      return `or(${n}[is]:NULL,not(${n}[in]:[${selectValues(f).join(",")}]))`;
  }
  if (DATE_TYPES.has(f.fieldType)) {
    switch (f.operand) {
      case "IS_IN_PAST":
        return f.fieldType === "DATE"
          ? `${n}[lt]:${dateOperand(f, startOfDayIn(ctx.now, ctx.timeZone))}`
          : `${n}[lt]:${ctx.now.toISOString()}`;
      case "IS_IN_FUTURE":
        return f.fieldType === "DATE"
          ? `${n}[gte]:${dateOperand(f, startOfDayIn(ctx.now, ctx.timeZone, 1))}`
          : `${n}[gt]:${ctx.now.toISOString()}`;
      case "IS_TODAY": {
        if (f.fieldType === "DATE") {
          const day = new Intl.DateTimeFormat("en-CA", { timeZone: ctx.timeZone }).format(ctx.now);
          return `${n}[eq]:${day}`;
        }
        const from = startOfDayIn(ctx.now, ctx.timeZone);
        const to = startOfDayIn(ctx.now, ctx.timeZone, 1);
        return `and(${n}[gte]:${from.toISOString()},${n}[lt]:${to.toISOString()})`;
      }
    }
  }
  throw new CliError(
    `View filter operand ${f.operand} on ${n} (${f.fieldType}) is not one this CLI re-applies`,
    "INVALID_ARGUMENTS",
    "Re-apply the view in the browser, or extend view-filter-translator.ts for this operand.",
  );
}

function combine(op: string, parts: string[]): string {
  if (parts.length === 0) return "";
  switch (op) {
    case "AND":
      return parts.length === 1 ? (parts[0] as string) : `and(${parts.join(",")})`;
    case "OR":
      return parts.length === 1 ? (parts[0] as string) : `or(${parts.join(",")})`;
    case "NOT":
      return `not(${parts.length === 1 ? (parts[0] as string) : `and(${parts.join(",")})`})`;
    default:
      throw new CliError(`View filter group operator ${op} is not known`, "INVALID_ARGUMENTS");
  }
}

const byPosition = <T extends { positionInViewFilterGroup?: number | null }>(a: T, b: T) =>
  (a.positionInViewFilterGroup ?? 0) - (b.positionInViewFilterGroup ?? 0);

/** The whole view as one REST filter expression; "" when the view has no filters. */
export function translateView(
  filters: ViewFilterInput[],
  groups: ViewFilterGroupInput[],
  ctx: TranslateContext,
): string {
  const render = (groupId: string | null): string[] => {
    const leaves = filters
      .filter((f) => (f.viewFilterGroupId ?? null) === groupId)
      .sort(byPosition)
      .map((f) => translateFilter(f, ctx));
    const children = groups
      .filter((g) => (g.parentViewFilterGroupId ?? null) === groupId)
      .sort(byPosition)
      .map((g) => combine(g.logicalOperator, render(g.id)))
      .filter(Boolean);
    return [...leaves, ...children];
  };
  // Top level: filters with no group and root groups are ANDed, as the view applies them.
  return combine("AND", render(null));
}
