import { AxiosError } from "axios";

import { CliError } from "./cli-error";

export interface AgentErrorPayload {
  ok: false;
  error: {
    message: string;
    code: string;
    exit_code: number;
    retryable: boolean;
    suggestion?: string;
    details?: unknown;
  };
}

export function toExitCode(error: unknown): number {
  if (isCommanderError(error)) {
    const code = String(error.code ?? "");
    if (code.startsWith("commander.help") || code === "commander.version") {
      return typeof error.exitCode === "number" ? error.exitCode : 0;
    }
    if (typeof error.exitCode === "number") {
      return error.exitCode;
    }
  }

  if (error instanceof CliError) {
    switch (error.code) {
      case "INVALID_ARGUMENTS":
        return 2;
      case "AUTH":
        return 3;
      case "NETWORK":
        return 4;
      case "RATE_LIMIT":
        return 5;
      default:
        return 1;
    }
  }

  if (isCommanderError(error)) {
    return 2;
  }

  if (isAxiosError(error)) {
    const status = error.response?.status;
    if (status === 401 || status === 403) {
      return 3;
    }
    if (status === 429) {
      return 5;
    }
    if (!status) {
      return 4;
    }
    return 1;
  }

  return 1;
}

export function formatError(error: unknown): string[] {
  if (isCommanderError(error)) {
    const code = String(error.code ?? "");
    if (code.startsWith("commander.help") || code === "commander.version") {
      return [];
    }
  }

  if (error instanceof CliError) {
    const lines = [error.message];
    if (error.suggestion) {
      lines.push(`Suggestion: ${error.suggestion}`);
    }
    return lines;
  }

  if (isCommanderError(error)) {
    return [error.message];
  }

  if (isAxiosError(error)) {
    const status = error.response?.status;
    if (status) {
      const detail =
        typeof error.response?.data === "string"
          ? error.response?.data
          : JSON.stringify(error.response?.data ?? {}, null, 2);
      return [`Request failed with status ${status}.`, detail].filter(Boolean) as string[];
    }
    return [`Network error: ${error.message}`];
  }

  if (error instanceof Error) {
    return [error.message];
  }

  return ["Unknown error"];
}

export function formatAgentError(error: unknown): AgentErrorPayload {
  const exitCode = toExitCode(error);
  const firstLine = formatError(error)[0] ?? "Unknown error";

  if (error instanceof CliError) {
    return {
      ok: false,
      error: {
        message: error.message,
        code: error.code,
        exit_code: exitCode,
        retryable: error.code === "NETWORK" || error.code === "RATE_LIMIT",
        suggestion: error.suggestion,
      },
    };
  }

  if (isAxiosError(error)) {
    const status = error.response?.status;
    return {
      ok: false,
      error: {
        message: firstLine,
        code:
          status === 429
            ? "RATE_LIMIT"
            : status === 401 || status === 403
              ? "AUTH"
              : status
                ? "HTTP"
                : "NETWORK",
        exit_code: exitCode,
        retryable: status === 429 || !status,
        details: status ? { status } : undefined,
      },
    };
  }

  if (isCommanderError(error)) {
    return {
      ok: false,
      error: {
        message: error.message,
        code: "INVALID_ARGUMENTS",
        exit_code: exitCode,
        retryable: false,
      },
    };
  }

  return {
    ok: false,
    error: {
      message: firstLine,
      code: "UNKNOWN",
      exit_code: exitCode,
      retryable: false,
    },
  };
}

function isCommanderError(
  error: unknown,
): error is { message: string; code?: string; exitCode?: number } {
  return typeof error === "object" && error !== null && "code" in error && "message" in error;
}

function isAxiosError(error: unknown): error is AxiosError {
  return !!error && typeof error === "object" && (error as AxiosError).isAxiosError === true;
}
