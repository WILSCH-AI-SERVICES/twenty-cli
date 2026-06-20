import { safeJsonParse } from "./io";

const UNSAFE_PATH_SEGMENTS = new Set(["__proto__", "constructor", "prototype"]);

export function capitalize(value: string): string {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

const irregularSingulars: Record<string, string> = {
  people: "person",
  men: "man",
  women: "woman",
  children: "child",
};

export function singularize(value: string): string {
  const lower = value.toLowerCase();
  if (irregularSingulars[lower]) {
    return irregularSingulars[lower];
  }
  if (lower.endsWith("ies") && lower.length > 3) {
    return value.slice(0, -3) + "y";
  }
  if (lower.endsWith("ses") && lower.length > 3) {
    return value.slice(0, -2);
  }
  if (lower.endsWith("s") && !lower.endsWith("ss")) {
    return value.slice(0, -1);
  }
  return value;
}

export function parsePrimitive(value: string): unknown {
  const trimmed = value.trim();
  if (trimmed === "") {
    return "";
  }
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed === "null") return null;
  if (!Number.isNaN(Number(trimmed)) && trimmed !== "") {
    return Number(trimmed);
  }
  if (trimmed.startsWith("{") || trimmed.startsWith("[") || trimmed.startsWith('"')) {
    try {
      return safeJsonParse(trimmed);
    } catch {
      return trimmed;
    }
  }
  return trimmed;
}

export function applySet(target: Record<string, unknown>, expr: string): void {
  const [rawPath, rawValue] = splitOnce(expr, "=");
  if (!rawPath) {
    throw new Error(`Invalid set expression ${JSON.stringify(expr)} (expected key=value)`);
  }
  const path = rawPath.trim();
  if (!path) {
    throw new Error(`Invalid set expression ${JSON.stringify(expr)} (empty key)`);
  }
  const parts = path.split(".");
  let current: Record<string, unknown> = target;
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i];
    if (!part) {
      throw new Error(`Invalid set expression ${JSON.stringify(expr)} (empty path segment)`);
    }
    if (UNSAFE_PATH_SEGMENTS.has(part)) {
      throw new Error(
        `Invalid set expression ${JSON.stringify(expr)} (unsafe path segment ${JSON.stringify(part)})`,
      );
    }
    if (i === parts.length - 1) {
      current[part] = parsePrimitive(rawValue ?? "");
      return;
    }
    const next = current[part];
    if (next == null) {
      current[part] = {};
      current = current[part] as Record<string, unknown>;
      continue;
    }
    if (typeof next !== "object" || Array.isArray(next)) {
      throw new Error(`Set path ${JSON.stringify(path)} conflicts with non-object value`);
    }
    current = next as Record<string, unknown>;
  }
}

export function mergeSets(
  base: Record<string, unknown>,
  sets: string[] | undefined,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base };
  if (!sets) return result;
  for (const expr of sets) {
    applySet(result, expr);
  }
  return result;
}

export function parseKeyValuePairs(pairs: string[] | undefined): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  if (!pairs) return out;
  for (const pair of pairs) {
    const [key, value] = splitOnce(pair, "=");
    if (!key) {
      throw new Error(`Invalid param ${JSON.stringify(pair)} (expected key=value)`);
    }
    if (!out[key]) {
      out[key] = [];
    }
    out[key].push(value ?? "");
  }
  return out;
}

export function splitOnce(input: string, delimiter: string): [string, string] {
  const index = input.indexOf(delimiter);
  if (index === -1) {
    return [input, ""];
  }
  return [input.slice(0, index), input.slice(index + delimiter.length)];
}

export function chunkArray<T>(items: T[], size: number): T[][] {
  if (!Number.isInteger(size) || size <= 0) {
    throw new Error("Chunk size must be a positive integer.");
  }

  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

export function parseBooleanEnv(value: string | undefined): boolean | undefined {
  if (value == null) return undefined;
  const normalized = value.toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes") return true;
  if (normalized === "false" || normalized === "0" || normalized === "no") return false;
  return undefined;
}
