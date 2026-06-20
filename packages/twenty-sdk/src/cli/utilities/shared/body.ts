import { readJsonInput } from "./io";
import { mergeSets } from "./parse";

export async function parseBody(
  data?: string,
  filePath?: string,
  sets?: string[],
): Promise<Record<string, unknown>> {
  const payload = await readJsonInput(data, filePath);
  let base: Record<string, unknown> = {};
  if (payload != null) {
    if (typeof payload !== "object" || Array.isArray(payload)) {
      throw new Error("Payload must be a JSON object");
    }
    base = payload as Record<string, unknown>;
  }

  const merged = mergeSets(base, sets);
  if (payload == null && (!sets || sets.length === 0)) {
    throw new Error("Missing JSON payload; use --data, --file, or --set");
  }

  return merged;
}

export async function parseArrayPayload(data?: string, filePath?: string): Promise<unknown[]> {
  const payload = await readJsonInput(data, filePath);
  if (payload == null) {
    throw new Error("Missing JSON payload; use --data or --file");
  }
  if (!Array.isArray(payload)) {
    throw new Error("Batch payload must be a JSON array");
  }
  return payload;
}
