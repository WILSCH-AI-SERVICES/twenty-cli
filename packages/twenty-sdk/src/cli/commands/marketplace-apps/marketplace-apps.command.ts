import { Command } from "commander";

import { assertGraphqlSuccess, type GraphQLResponse } from "../../utilities/api/graphql-response";
import { CliError } from "../../utilities/errors/cli-error";
import { createCommandContext } from "../../utilities/shared/context";
import { applyGlobalOptions } from "../../utilities/shared/global-options";

interface MarketplaceAppsOptions {
  version?: string;
}

const endpoint = "/metadata";

const MARKETPLACE_APP_FIELDS = `
  id
  name
  description
  icon
  version
  author
  category
  logo
  aboutDescription
  websiteUrl
  termsUrl
  sourcePackage
  isFeatured
`;

const LIST_MARKETPLACE_APPS_QUERY = `query FindManyMarketplaceApps {
  findManyMarketplaceApps {
    ${MARKETPLACE_APP_FIELDS}
  }
}`;

const GET_MARKETPLACE_APP_QUERY = `query FindOneMarketplaceApp($universalIdentifier: String!) {
  findOneMarketplaceApp(universalIdentifier: $universalIdentifier) {
    ${MARKETPLACE_APP_FIELDS}
  }
}`;

const INSTALL_MARKETPLACE_APP_MUTATION = `mutation InstallMarketplaceApp($universalIdentifier: String!, $version: String) {
  installMarketplaceApp(universalIdentifier: $universalIdentifier, version: $version)
}`;

function requireTarget(target: string | undefined, label: string): string {
  if (!target) {
    throw new CliError(`Missing ${label}.`, "INVALID_ARGUMENTS");
  }

  return target;
}

export function registerMarketplaceAppsCommand(program: Command): void {
  const cmd = program.command("marketplace-apps").description("Manage marketplace apps");
  applyGlobalOptions(cmd);

  const listCmd = cmd.command("list").description("List marketplace apps");
  applyGlobalOptions(listCmd);
  listCmd.action(async (_options: unknown, command: Command) => {
    const { globalOptions, services } = await createCommandContext(command);
    const response = await services.api.post<
      GraphQLResponse<{ findManyMarketplaceApps: unknown[] }>
    >(endpoint, {
      query: LIST_MARKETPLACE_APPS_QUERY,
    });
    const data = assertGraphqlSuccess(response.data ?? {}, "Failed to list marketplace apps.");
    await services.output.render(data.findManyMarketplaceApps ?? [], {
      format: globalOptions.output,
      query: globalOptions.query,
    });
  });

  const getCmd = cmd
    .command("get")
    .description("Get a marketplace app")
    .argument("[target]", "Marketplace app universal identifier");
  applyGlobalOptions(getCmd);
  getCmd.action(async (target: string | undefined, _options: unknown, command: Command) => {
    const { globalOptions, services } = await createCommandContext(command);
    const universalIdentifier = requireTarget(target, "marketplace app universal identifier");
    const response = await services.api.post<GraphQLResponse<{ findOneMarketplaceApp: unknown }>>(
      endpoint,
      {
        query: GET_MARKETPLACE_APP_QUERY,
        variables: { universalIdentifier },
      },
    );
    const data = assertGraphqlSuccess(
      response.data ?? {},
      `Failed to fetch marketplace app ${universalIdentifier}.`,
    );
    await services.output.render(data.findOneMarketplaceApp, {
      format: globalOptions.output,
      query: globalOptions.query,
    });
  });

  const installCmd = cmd
    .command("install")
    .description("Install a marketplace app")
    .argument("[target]", "Marketplace app universal identifier")
    .option("--version <version>", "Marketplace app version to install");
  applyGlobalOptions(installCmd);
  installCmd.action(
    async (target: string | undefined, options: MarketplaceAppsOptions, command: Command) => {
      const { globalOptions, services } = await createCommandContext(command);
      const universalIdentifier = requireTarget(target, "marketplace app universal identifier");
      const response = await services.api.post<GraphQLResponse<{ installMarketplaceApp: boolean }>>(
        endpoint,
        {
          query: INSTALL_MARKETPLACE_APP_MUTATION,
          variables: {
            universalIdentifier,
            version: options.version,
          },
        },
      );
      const data = assertGraphqlSuccess(
        response.data ?? {},
        `Failed to install marketplace app ${universalIdentifier}.`,
      );
      await services.output.render(
        {
          success: data.installMarketplaceApp ?? false,
          universalIdentifier,
          version: options.version,
        },
        {
          format: globalOptions.output,
          query: globalOptions.query,
        },
      );
    },
  );
}
