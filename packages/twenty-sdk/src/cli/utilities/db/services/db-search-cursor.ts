/**
 * Twenty's API search cursor format. The cursor is a base64-encoded JSON
 * payload that captures (a) the rank tuple of the last emitted row and (b) the
 * last `recordId` per object. This shape is what `--rs api` emits, and we
 * mirror it in `--rs db` so cursors are interchangeable across modes for the
 * same query.
 *
 * Reference: Twenty's `cursors.util.ts:52-54` (encoding) and
 * `search.service.ts:614-649` (`computeEdges`/next-cursor builder).
 */
export interface SearchCursor {
  lastRanks: { tsRankCD: number; tsRank: number };
  lastRecordIdsPerObject: Record<string, string | undefined>;
}

export function encodeSearchCursor(cursor: SearchCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64");
}

export function decodeSearchCursor(encoded: string): SearchCursor | null {
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

  if (!isSearchCursor(parsed)) {
    return null;
  }

  return parsed;
}

function isSearchCursor(value: unknown): value is SearchCursor {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  const lastRanks = candidate.lastRanks;

  if (typeof lastRanks !== "object" || lastRanks === null) {
    return false;
  }

  const ranks = lastRanks as Record<string, unknown>;

  if (typeof ranks.tsRankCD !== "number" || typeof ranks.tsRank !== "number") {
    return false;
  }

  const lastRecordIdsPerObject = candidate.lastRecordIdsPerObject;

  if (
    typeof lastRecordIdsPerObject !== "object" ||
    lastRecordIdsPerObject === null ||
    Array.isArray(lastRecordIdsPerObject)
  ) {
    return false;
  }

  return true;
}
