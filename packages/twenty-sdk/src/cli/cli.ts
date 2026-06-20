#!/usr/bin/env node
import { maybeHandleInlineHelp } from "./help";
import { buildProgram } from "./program";
import { loadCliEnvironment } from "./utilities/config/services/environment.service";
import { formatAgentError, formatError, toExitCode } from "./utilities/errors/error-handler";
import { normalizeOptionAliasArgv } from "./utilities/shared/option-aliases";
import { parseBooleanEnv } from "./utilities/shared/parse";
import { getLastSourceTracker, resetLastSourceTracker } from "./utilities/shared/services";

function argvRequestsAgentMode(argv: string[]): boolean {
  return argv.slice(2).some((arg) => arg === "--agent-mode");
}

function envRequestsAgentMode(): boolean {
  return parseBooleanEnv(process.env.TWENTY_AGENT_MODE) === true;
}

export async function main(argv: string[] = process.argv): Promise<void> {
  let normalizedArgv = argv;

  try {
    loadCliEnvironment({ argv, cwd: process.cwd() });
    const program = buildProgram();
    normalizedArgv = normalizeOptionAliasArgv(argv, program);
    if (!sameArgv(argv, normalizedArgv)) {
      loadCliEnvironment({ argv: normalizedArgv, cwd: process.cwd() });
    }
    program.configureOutput({
      writeErr: () => undefined,
    });

    if (await maybeHandleInlineHelp(program, normalizedArgv.slice(2))) {
      return;
    }

    resetLastSourceTracker();
    await program.parseAsync(normalizedArgv);
    emitFallbackDiagnostic(normalizedArgv);
  } catch (error) {
    const agentMode = argvRequestsAgentMode(normalizedArgv) || envRequestsAgentMode();
    if (agentMode) {
      // eslint-disable-next-line no-console
      console.error(JSON.stringify(formatAgentError(error)));
    } else {
      const messages = formatError(error);
      for (const line of messages) {
        // eslint-disable-next-line no-console
        console.error(line);
      }
    }
    process.exitCode = toExitCode(error);
  }
}

if (require.main === module) {
  void main();
}

function sameArgv(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function emitFallbackDiagnostic(argv: string[]): void {
  const reason = getLastSourceTracker()?.lastFallbackReason;
  if (!reason || argvRequestsAgentMode(argv) || envRequestsAgentMode()) {
    return;
  }

  process.stderr.write(`twenty: db read fell back to api (${reason})\n`);
}
