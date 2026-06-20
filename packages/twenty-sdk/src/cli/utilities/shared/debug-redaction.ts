const REDACTED = "[REDACTED]";

export function redactSensitiveData(value: unknown): unknown {
  return redactValue(value, new WeakSet<object>());
}

export function stringifyDebugPreview(value: unknown, limit = 500): string {
  try {
    return truncatePreview(JSON.stringify(redactSensitiveData(value)), limit);
  } catch {
    return truncatePreview(redactSensitiveText(String(value)), limit);
  }
}

export function redactSensitiveText(value: string): string {
  return value
    .replace(
      /("(?:authorization|cookie|[^"]*(?:token|api[-_]?key|password|secret)[^"]*)"\s*:\s*")([^"]*)(")/gi,
      `$1${REDACTED}$3`,
    )
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, `Bearer ${REDACTED}`)
    .replace(/\bBasic\s+[A-Za-z0-9+/=-]+/gi, `Basic ${REDACTED}`)
    .replace(
      /([?&](?:access_token|refresh_token|token|api_key|apikey|key)=)([^&#\s]+)/gi,
      `$1${REDACTED}`,
    );
}

function redactValue(value: unknown, seen: WeakSet<object>): unknown {
  if (typeof value === "string") {
    return redactSensitiveText(value);
  }

  if (value === null || typeof value !== "object") {
    return value;
  }

  if (seen.has(value)) {
    return "[Circular]";
  }

  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((entry) => redactValue(entry, seen));
  }

  const record = value as Record<string, unknown>;
  const redacted: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(record)) {
    redacted[key] = isSensitiveKey(key) ? REDACTED : redactValue(entry, seen);
  }

  return redacted;
}

function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[-_]/g, "");
  return (
    normalized === "authorization" ||
    normalized === "cookie" ||
    normalized.includes("token") ||
    normalized.includes("apikey") ||
    normalized.includes("password") ||
    normalized.includes("secret")
  );
}

function truncatePreview(value: string, limit: number): string {
  if (value.length <= limit) {
    return value;
  }

  return `${value.slice(0, limit)}...`;
}
