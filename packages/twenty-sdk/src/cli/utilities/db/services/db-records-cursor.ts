import { quoteIdentifier } from "./db-sql-identifiers";

/**
 * Twenty-compatible base64-JSON keyset cursor for records list. Replaces the
 * legacy `db:<offset>` cursor with `(sortField, id)` keyset semantics so
 * `listAll` over large tables walks the index in O(N) instead of paying
 * Postgres' OFFSET re-walk on every page (O(N²)).
 *
 * Format mirrors Phase 2's `db-search-cursor.ts` shape (base64-encoded JSON
 * payload). The exact field set differs from the API's `starting_after`
 * cursor format — Twenty's REST records API treats the cursor as opaque, and
 * the DB backend rejects API cursors via `UnsupportedDbReadError` so the
 * auto-mode router falls back to API. That same fallback applies to legacy
 * `db:<offset>` cursors emitted before this change.
 */
export interface RecordListCursor {
  lastSortValue: string | number | null;
  lastId: string;
  sortField: string;
  sortDirection: "asc" | "desc";
}

export function encodeRecordCursor(cursor: RecordListCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64");
}

export function decodeRecordCursor(encoded: string): RecordListCursor | null {
  let json: string;

  try {
    json = Buffer.from(encoded, "base64").toString("utf8");
  } catch {
    return null;
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }

  if (!isRecordListCursor(parsed)) {
    return null;
  }

  return parsed;
}

function isRecordListCursor(value: unknown): value is RecordListCursor {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Record<string, unknown>;

  if (typeof candidate.lastId !== "string") {
    return false;
  }

  if (typeof candidate.sortField !== "string") {
    return false;
  }

  if (candidate.sortDirection !== "asc" && candidate.sortDirection !== "desc") {
    return false;
  }

  const lastSortValue = candidate.lastSortValue;

  if (
    lastSortValue !== null &&
    typeof lastSortValue !== "string" &&
    typeof lastSortValue !== "number"
  ) {
    return false;
  }

  return true;
}

/**
 * Build a parameterised keyset WHERE clause for the next page. The clause is
 * direction-aware:
 *
 * - `desc` →  ( t.sortField < $N OR ( t.sortField = $N AND t.id::text > $N+1 ) )
 * - `asc`  →  ( t.sortField > $N OR ( t.sortField = $N AND t.id::text > $N+1 ) )
 *
 * The id tiebreaker uses `id::text > <param>` (always ascending) so the cursor
 * is stable across equal sort values regardless of sort direction. UUIDs are
 * non-empty strings so `id::text > ''` is true, matching Twenty's pattern.
 *
 * `paramOffset` is the 1-based placeholder index for `lastSortValue`; the id
 * placeholder uses `paramOffset + 1`. Caller is responsible for appending the
 * returned `params` to the final query parameter list in the same order.
 */
export function buildKeysetWhereClause(
  cursor: RecordListCursor,
  paramOffset: number,
): { sql: string; params: unknown[] } {
  const cmp = cursor.sortDirection === "desc" ? "<" : ">";
  const field = `t.${quoteIdentifier(cursor.sortField)}`;
  const sortPlaceholder = `$${paramOffset}`;
  const idPlaceholder = `$${paramOffset + 1}`;

  return {
    sql: `( ${field} ${cmp} ${sortPlaceholder} OR ( ${field} = ${sortPlaceholder} AND t."id"::text > ${idPlaceholder} ) )`,
    params: [cursor.lastSortValue, cursor.lastId],
  };
}
