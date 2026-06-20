export const liveEnabled = (): boolean =>
  process.env.TWENTY_EVALS_ENABLE_PROD === "1" &&
  Boolean(process.env.TWENTY_DATABASE_URL) &&
  Boolean(process.env.TWENTY_BASE_URL) &&
  Boolean(process.env.TWENTY_API_TOKEN || process.env.TWENTY_TOKEN);

export const parityObject = (): string => process.env.TWENTY_EVALS_PARITY_OBJECT ?? "people";

export function normalizeRecord(rec: Record<string, unknown>): Record<string, unknown> {
  const drop = new Set(["updatedAt", "createdAt", "searchVector", "position"]);
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(rec)) {
    if (!drop.has(key)) {
      out[key] = normalizeValue(value);
    }
  }
  return sortRecord(out);
}

export const byId = (a: { id?: string }, b: { id?: string }): number =>
  String(a.id).localeCompare(String(b.id));

export function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
}

export function assertRecordsEqualRedacted(
  dbRecords: Record<string, unknown>[],
  apiRecords: Record<string, unknown>[],
): void {
  const dbJson = JSON.stringify(dbRecords);
  const apiJson = JSON.stringify(apiRecords);

  if (dbJson === apiJson) {
    return;
  }

  throw new Error(
    `Live DB/API parity mismatch (record values redacted): dbCount=${dbRecords.length} apiCount=${apiRecords.length} dbShape=${shapeSummary(dbRecords)} apiShape=${shapeSummary(apiRecords)} firstDiff=${firstDifference(dbRecords, apiRecords)}`,
  );
}

function normalizeValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalizeValue);
  }

  if (typeof value === "object" && value !== null) {
    return sortRecord(
      Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([key, nested]) => [
          key,
          normalizeValue(nested),
        ]),
      ),
    );
  }

  return value;
}

function sortRecord(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(record).sort(([left], [right]) => left.localeCompare(right)),
  );
}

function shapeSummary(records: Record<string, unknown>[]): string {
  const first = records[0];
  if (!first) {
    return "empty";
  }

  return Object.keys(first).sort().join(",");
}

function firstDifference(left: unknown, right: unknown, path = "$"): string {
  if (Object.is(left, right)) {
    return "none";
  }

  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) {
      return `${path}:type ${describeValue(left)} != ${describeValue(right)}`;
    }

    if (left.length !== right.length) {
      return `${path}:length ${left.length} != ${right.length}`;
    }

    for (let index = 0; index < left.length; index += 1) {
      const diff = firstDifference(left[index], right[index], `${path}[${index}]`);
      if (diff !== "none") {
        return diff;
      }
    }

    return "none";
  }

  if (isRecord(left) || isRecord(right)) {
    if (!isRecord(left) || !isRecord(right)) {
      return `${path}:type ${describeValue(left)} != ${describeValue(right)}`;
    }

    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    if (leftKeys.join(",") !== rightKeys.join(",")) {
      return `${path}:keys ${leftKeys.join(",")} != ${rightKeys.join(",")}`;
    }

    for (const key of leftKeys) {
      const diff = firstDifference(left[key], right[key], `${path}.${key}`);
      if (diff !== "none") {
        return diff;
      }
    }

    return "none";
  }

  return `${path}:value ${describeValue(left)} != ${describeValue(right)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function describeValue(value: unknown): string {
  if (value === null) {
    return "null";
  }

  if (Array.isArray(value)) {
    return `array(${value.length})`;
  }

  if (typeof value === "string") {
    return describeString(value);
  }

  return typeof value;
}

function describeString(value: string): string {
  if (value.length === 0) {
    return "string(empty)";
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return `string(date,len=${value.length})`;
  }

  if (/^\d{4}-\d{2}-\d{2}T/.test(value)) {
    return `string(datetime,len=${value.length})`;
  }

  return `string(nonempty,len=${value.length})`;
}
