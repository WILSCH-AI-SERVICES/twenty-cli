export type RestObject = Record<string, unknown>;

export function isRestObject(value: unknown): value is RestObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function getDataSection(payload: unknown): RestObject {
  if (!isRestObject(payload)) {
    return {};
  }

  const data = payload.data;
  return isRestObject(data) ? data : {};
}

export function extractFirstValue(dataSection: RestObject): unknown {
  const values = Object.values(dataSection);
  return values.length === 0 ? undefined : values[0];
}

export function extractCollection(payload: unknown, key: string): RestObject[] {
  if (Array.isArray(payload)) {
    return payload.filter(isRestObject);
  }

  if (!isRestObject(payload)) {
    return [];
  }

  const data = payload.data;
  if (isRestObject(data) && Array.isArray(data[key])) {
    return data[key].filter(isRestObject);
  }

  if (Array.isArray(payload[key])) {
    return payload[key].filter(isRestObject);
  }

  if (isRestObject(data)) {
    const firstArrayValue = Object.values(data).find(Array.isArray);
    if (firstArrayValue) {
      return firstArrayValue.filter(isRestObject);
    }
  }

  if (Array.isArray(data)) {
    return data.filter(isRestObject);
  }

  return [];
}

export function extractResource<T extends RestObject = RestObject>(
  payload: unknown,
  key: string,
): T {
  if (!isRestObject(payload)) {
    return {} as T;
  }

  const data = payload.data;
  if (isRestObject(data) && isRestObject(data[key])) {
    return data[key] as T;
  }

  if (isRestObject(payload[key])) {
    return payload[key] as T;
  }

  if (isRestObject(data)) {
    return data as T;
  }

  return payload as T;
}

export function extractDeleteResult(payload: unknown): boolean {
  if (typeof payload === "boolean") {
    return payload;
  }

  if (!isRestObject(payload)) {
    return false;
  }

  if (typeof payload.success === "boolean") {
    return payload.success;
  }

  const data = payload.data;
  if (isRestObject(data) && typeof data.success === "boolean") {
    return data.success;
  }

  if (typeof data === "boolean") {
    return data;
  }

  return false;
}
