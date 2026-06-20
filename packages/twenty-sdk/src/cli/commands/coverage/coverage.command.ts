import { Command } from "commander";
import { auditAliasCoverage } from "../../utilities/coverage/alias-coverage";
import { compareCoverage } from "../../utilities/coverage/coverage-auditor";
import { createOutputContext } from "../../utilities/shared/context";
import { applyGlobalOptions } from "../../utilities/shared/global-options";
import { registerCommand } from "../../utilities/shared/register-command";

interface CoverageCompareCommandOptions {
  upstream: string;
  baseline?: string;
  failOnUnexpected?: boolean;
}

interface CoverageAliasesCommandOptions {
  failOnMissing?: boolean;
}

export function registerCoverageCommand(program: Command): void {
  const coverage = program.command("coverage").description("Audit CLI coverage against upstream");

  applyGlobalOptions(coverage);

  registerCommand(
    coverage,
    "compare",
    "Compare CLI coverage against an upstream checkout",
    (command) => {
      command
        .requiredOption("--upstream <path>", "Path to upstream Twenty checkout")
        .option("--baseline <path>", "Path to coverage baseline JSON")
        .option("--fail-on-unexpected", "Exit with code 1 when unexpected gaps remain");
      applyGlobalOptions(command);
      command.action(async (_options: CoverageCompareCommandOptions, actionCommand: Command) => {
        const options = actionCommand.opts() as CoverageCompareCommandOptions;
        const { globalOptions, output } = createOutputContext(actionCommand);
        const result = await compareCoverage({
          upstreamPath: options.upstream,
          baselinePath: options.baseline,
        });

        await output.render(result, {
          format: globalOptions.output,
          query: globalOptions.query,
        });

        if (options.failOnUnexpected && result.unexpectedMissing.length > 0) {
          process.exitCode = 1;
        }
      });
    },
  );

  registerCommand(coverage, "aliases", "Audit command and flag short alias coverage", (command) => {
    command.option("--fail-on-missing", "Exit with code 1 when alias coverage is incomplete");
    applyGlobalOptions(command);
    command.action(async (_options: CoverageAliasesCommandOptions, actionCommand: Command) => {
      const options = actionCommand.opts() as CoverageAliasesCommandOptions;
      const { globalOptions, output } = createOutputContext(actionCommand);
      const result = auditAliasCoverage(getRootCommand(actionCommand));

      await output.render(result, {
        format: globalOptions.output,
        query: globalOptions.query,
      });

      if (options.failOnMissing && !result.ok) {
        process.exitCode = 1;
      }
    });
  });
}

function getRootCommand(command: Command): Command {
  let current = command;
  while (current.parent) {
    current = current.parent;
  }
  return current;
}
