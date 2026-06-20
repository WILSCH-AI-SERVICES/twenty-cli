export class CliError extends Error {
  public code: string;
  public suggestion?: string;

  constructor(message: string, code: string, suggestion?: string) {
    super(message);
    this.code = code;
    this.suggestion = suggestion;
  }
}

export function errorWithCause(
  message: string,
  code: string,
  suggestion?: string,
  cause?: unknown,
): CliError {
  const err = new CliError(message, code, suggestion);
  if (cause) {
    (err as { cause?: unknown }).cause = cause;
  }
  return err;
}
