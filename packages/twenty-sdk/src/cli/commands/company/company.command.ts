import { Command } from "commander";

import { createCommandContext } from "../../utilities/shared/context";
import { applyGlobalOptions } from "../../utilities/shared/global-options";
import { assembleCompanyRead, fetchCompanyRead } from "./company-read.service";

/**
 * `twenty company read <name-or-id>` — one read of a Company: the Company, its People, its
 * Opportunities and every open Task that hangs on the Company or on any of its
 * Opportunities, each Task spelled out with title, due date, assignee by name and the
 * address its note holds (#3267). The read the Daily Settle, a Manager session and a
 * Junior Architect session each make first.
 */
export function registerCompanyCommand(program: Command): void {
  const company = program.command("company").description("One read of a Company");
  applyGlobalOptions(company);

  const read = company
    .command("read")
    .description(
      "The Company with its People, Opportunities and open Tasks (its own and its Opportunities'), spelled out",
    )
    .argument("<company>", "The Company's name (exact, else a unique partial match) or its id");
  applyGlobalOptions(read);

  read.action(async (ref: string, _options: unknown, command: Command) => {
    const { globalOptions, services } = await createCommandContext(command);
    const answer = assembleCompanyRead(await fetchCompanyRead(services.records, ref));
    // The answer is already curated; abbreviating its keys would only obscure it.
    await services.output.render(answer, {
      format: globalOptions.output,
      query: globalOptions.query,
      full: true,
    });
  });
}
