import { Command } from "commander";

import { applyGlobalOptions, resolveGlobalOptions } from "../../utilities/shared/global-options";
import { createServices } from "../../utilities/shared/services";

export function registerDashboardsCommand(program: Command): void {
  const dashboardsCmd = program.command("dashboards").description("Manage dashboards");

  const duplicateCmd = dashboardsCmd
    .command("duplicate")
    .description("Duplicate a dashboard by ID")
    .argument("<dashboardId>", "Dashboard ID");

  applyGlobalOptions(duplicateCmd);

  duplicateCmd.action(
    async (dashboardId: string, _options: Record<string, unknown>, command: Command) => {
      const globalOptions = resolveGlobalOptions(command);
      const services = await createServices(globalOptions);
      const response = await services.api.post(`/rest/dashboards/${dashboardId}/duplicate`);

      await services.output.render(response.data, {
        format: globalOptions.output,
        query: globalOptions.query,
      });
    },
  );
}
