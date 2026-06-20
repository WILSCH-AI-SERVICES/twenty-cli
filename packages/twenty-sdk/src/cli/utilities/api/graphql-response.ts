import { CliError } from "../errors/cli-error";

export interface GraphQLResponse<T = unknown> {
  data?: T;
  errors?: Array<{ message?: string }>;
}

export function formatGraphqlErrors(response: GraphQLResponse<unknown>): string | undefined {
  if (!Array.isArray(response.errors) || response.errors.length === 0) {
    return undefined;
  }

  return response.errors
    .map((error) => error.message?.trim())
    .filter((message): message is string => Boolean(message))
    .join("\n");
}

export function assertGraphqlSuccess<T>(
  response: GraphQLResponse<T>,
  fallbackMessage: string,
  code = "API_ERROR",
): T {
  const message = formatGraphqlErrors(response);

  if (message) {
    throw new CliError(message, code);
  }

  if (response.data === undefined) {
    throw new CliError(fallbackMessage, code);
  }

  return response.data;
}

export function hasGraphqlField<T>(
  response: GraphQLResponse<Record<string, T>>,
  key: string,
): boolean {
  return hasOwnKey(response.data, key);
}

export function getGraphqlField<T>(
  response: GraphQLResponse<Record<string, T>>,
  key: string,
): T | undefined {
  if (!hasOwnKey(response.data, key)) {
    return undefined;
  }

  return response.data?.[key];
}

export function requireGraphqlField<T>(
  response: GraphQLResponse<Record<string, T>>,
  key: string,
  fallbackMessage: string,
  code = "API_ERROR",
): T {
  const data = assertGraphqlSuccess(response, fallbackMessage, code);

  if (!hasOwnKey(data, key)) {
    throw new CliError(fallbackMessage, code);
  }

  return data[key] as T;
}

export function hasSchemaErrorSymbol(
  response: GraphQLResponse<unknown>,
  symbols: string[],
): boolean {
  if (!Array.isArray(response.errors) || response.errors.length === 0) {
    return false;
  }

  return response.errors.some((error) => symbols.some((symbol) => error.message?.includes(symbol)));
}

function hasOwnKey(value: unknown, key: string): value is Record<string, unknown> {
  return (
    typeof value === "object" && value !== null && Object.prototype.hasOwnProperty.call(value, key)
  );
}
