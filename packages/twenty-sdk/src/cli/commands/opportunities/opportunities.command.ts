import { Command } from "commander";

import { CliError } from "../../utilities/errors/cli-error";
import { isAddress } from "../../utilities/house-rules/task-note";
import { REFUSED } from "../../utilities/house-rules/write-guard";
import { createCommandContext } from "../../utilities/shared/context";
import { applyGlobalOptions } from "../../utilities/shared/global-options";

interface OpportunityCloseOptions {
  won?: boolean;
  lost?: boolean;
  why?: string;
  whyLabel?: string;
}

type OpportunityRecord = {
  id: string;
  name?: string;
  stage?: string;
  whyStopped?: { primaryLinkUrl?: string | null; primaryLinkLabel?: string | null } | null;
};

/**
 * `twenty opportunities close <id> --won|--lost --why <address>` — close an Opportunity
 * with why it stopped progressing: the address of the mail or recording moment that ended
 * it, in `whyStopped` (#3266). A close without it is refused before anything is sent, and
 * the transport's guard refuses the same close by any other route.
 */
export function registerOpportunitiesCommand(program: Command): void {
  const opportunities = program
    .command("opportunities")
    .description("Opportunities closed with why they stopped progressing");
  applyGlobalOptions(opportunities);

  const close = opportunities
    .command("close")
    .description("Move an Opportunity to closed won or lost, with why it stopped progressing")
    .argument("<id>", "The Opportunity's id")
    .option("--won", "Close as won")
    .option("--lost", "Close as lost")
    .option("--why <address>", "Address of the mail or recording moment that ended it")
    .option("--why-label <text>", "What that artifact is, in a few words");
  applyGlobalOptions(close);

  close.action(async (id: string, _options: unknown, command: Command) => {
    const { globalOptions, services } = await createCommandContext(command);
    const options = command.opts() as OpportunityCloseOptions;

    const missing: string[] = [];
    if (!options.won === !options.lost) missing.push("pass exactly one of --won or --lost");
    if (!options.why) {
      missing.push(
        "why it stopped progressing is empty — pass --why <address of the mail or recording moment that ended it>; the Opportunity keeps its stage",
      );
    } else if (!isAddress(options.why)) {
      missing.push(
        `--why "${options.why}" is not an http(s) address; the Opportunity keeps its stage`,
      );
    }
    if (missing.length > 0) {
      throw new CliError(
        `Refused before it reached the instance:\n  - ${missing.join("\n  - ")}`,
        REFUSED,
      );
    }

    await services.records.update("opportunities", id, {
      stage: options.won ? "CLOSED_WON" : "CLOSED_LOST",
      whyStopped: {
        primaryLinkUrl: options.why,
        primaryLinkLabel: options.whyLabel?.trim() ?? "",
        secondaryLinks: [],
      },
    });

    const response = await services.api.get<{ data?: { opportunity?: OpportunityRecord } }>(
      `/rest/opportunities/${encodeURIComponent(id)}`,
    );
    const stored = response.data?.data?.opportunity;
    await services.output.render(
      {
        id: stored?.id ?? id,
        name: stored?.name,
        stage: stored?.stage,
        whyStopped: stored?.whyStopped ?? null,
      },
      { format: globalOptions.output, query: globalOptions.query },
    );
  });
}
