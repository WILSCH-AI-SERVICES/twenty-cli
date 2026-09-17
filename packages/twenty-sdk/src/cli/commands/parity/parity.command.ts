import { Command } from "commander";

import { CliError } from "../../utilities/errors/cli-error";
import { createCommandContext } from "../../utilities/shared/context";
import { applyGlobalOptions } from "../../utilities/shared/global-options";
import { formatVersionLine } from "../../version";
import {
  DEFAULT_PARITY_CHECK_OPTIONS,
  runParityCheck,
  type ParityCheckOptions,
  type ParityReport,
} from "./parity-check.service";

export function registerParityCommand(program: Command): void {
  const parity = program
    .command("parity")
    .description("Parity between this CLI and the Twenty instance it runs against");
  applyGlobalOptions(parity);

  const defaults = DEFAULT_PARITY_CHECK_OPTIONS;
  const check = parity
    .command("check")
    .description(
      "Drive the seven acts the house relies on against the live instance, witness each on a re-read from the store, and exit non-zero if any does not land",
    )
    .option("--object <plural>", "Counterparty object, plural REST name", defaults.object)
    .option("--trail-object <plural>", "Trail object, plural REST name", defaults.trailObject)
    .option(
      "--trail-relation <field>",
      "The trail object's relation field pointing at the counterparty",
      defaults.trailRelation,
    )
    .option("--stage-field <name>", "Stage field on the counterparty", defaults.stageField)
    .option("--stage-from <value>", "Stage the fixture starts in", defaults.stageFrom)
    .option("--stage-to <value>", "Stage the fixture is moved to", defaults.stageTo)
    .option(
      "--next-step-field <name>",
      "Next step field on the counterparty",
      defaults.nextStepField,
    )
    .option(
      "--next-step-date-field <name>",
      "Next step date field on the counterparty",
      defaults.nextStepDateField,
    )
    .option("--keep", "Leave the fixtures standing; skip cleanup", false);
  applyGlobalOptions(check);

  check.action(async (_options: unknown, command: Command) => {
    const { globalOptions, services } = await createCommandContext(command);
    const options = resolveParityOptions(command.opts());
    const report = await runParityCheck(services, options);
    const payload = { version: formatVersionLine(), ...report };

    const format = globalOptions.output ?? "json";
    if (format === "text" || format === "markdown") {
      process.stdout.write(formatParityReport(payload));
    } else {
      await services.output.render(payload, {
        format,
        query: globalOptions.query,
        full: true,
      });
    }

    if (!report.ok) {
      const failedActs = report.acts
        .filter((act) => !act.ok)
        .map((act) => `${act.act} ${act.name}`);
      const failedCleanup = report.cleanup.filter((step) => !step.ok).map((step) => step.step);
      throw new CliError(
        `parity check failed: ${[...failedActs, ...failedCleanup].join("; ")}`,
        "PARITY_FAILED",
      );
    }
  });
}

export function resolveParityOptions(raw: Record<string, unknown>): ParityCheckOptions {
  const resolved: ParityCheckOptions = { ...DEFAULT_PARITY_CHECK_OPTIONS };
  for (const key of Object.keys(DEFAULT_PARITY_CHECK_OPTIONS) as Array<keyof ParityCheckOptions>) {
    const value = raw[key];
    if (key === "keep") {
      resolved.keep = value === true;
    } else if (typeof value === "string" && value !== "") {
      resolved[key] = value;
    }
  }

  return resolved;
}

export function formatParityReport(report: ParityReport & { version: string }): string {
  const lines: string[] = [];
  lines.push(`parity check — twenty ${report.version}`);
  lines.push(
    `object ${report.object} · trail ${report.trailObject} · stamp ${report.stamp}${report.kept ? " · fixtures kept" : ""}`,
  );
  for (const act of report.acts) {
    const mark = act.ok ? "PASS" : "FAIL";
    lines.push(
      `  ${mark}  ${act.act} ${act.name.padEnd(28)} ${act.ok ? act.witness : (act.error ?? "")}`,
    );
    lines.push(`        witnessed at: ${act.layer}`);
  }
  if (report.cleanup.length > 0) {
    const okCount = report.cleanup.filter((step) => step.ok).length;
    lines.push(`  cleanup ${okCount}/${report.cleanup.length} ok`);
    for (const step of report.cleanup.filter((candidate) => !candidate.ok)) {
      lines.push(`    FAIL  ${step.step}: ${step.detail}`);
    }
  }
  lines.push(`RESULT: ${report.ok ? "PASS" : "FAIL"}`);

  return `${lines.join("\n")}\n`;
}
