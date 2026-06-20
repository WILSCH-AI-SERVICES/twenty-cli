import { CliError } from "../errors/cli-error";

export function requireYes(options: { yes?: boolean }, action: string): void {
  if (!options.yes) {
    throw new CliError(
      `${action} requires --yes.`,
      "INVALID_ARGUMENTS",
      `Re-run with --yes to confirm ${action.toLowerCase()}.`,
    );
  }
}
