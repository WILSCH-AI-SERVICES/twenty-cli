import path from "path";

import { Command } from "commander";

import { requireGraphqlField, type GraphQLResponse } from "../../utilities/api/graphql-response";
import { API_TOKEN_ENV_VAR } from "../../utilities/config/services/config.service";
import { upsertEnvValue } from "../../utilities/config/services/environment.service";
import { CliError } from "../../utilities/errors/cli-error";
import { createCommandContext } from "../../utilities/shared/context";
import { applyGlobalOptions, resolveGlobalOptions } from "../../utilities/shared/global-options";
import { requestPublic } from "../../utilities/shared/request-transport";
import { createServices } from "../../utilities/shared/services";
import {
  buildRenewTokenRequestData,
  buildSsoUrlRequestData,
  resolveAuthRequestSurface,
} from "./auth-compat";

const CURRENT_WORKSPACE_QUERY = `query CurrentWorkspace {
  currentWorkspace {
    id
    displayName
    activationStatus
    inviteHash
    allowImpersonation
    isPublicInviteLinkEnabled
    isGoogleAuthEnabled
    isMicrosoftAuthEnabled
    isPasswordAuthEnabled
    isTwoFactorAuthenticationEnforced
    isCustomDomainEnabled
    subdomain
    customDomain
    workspaceMembersCount
    logo
    metadataVersion
    workspaceUrls {
      subdomainUrl
      customUrl
    }
    featureFlags {
      key
      value
    }
  }
}`;

const PUBLIC_WORKSPACE_QUERY = `query GetPublicWorkspaceDataByDomain($origin: String) {
  getPublicWorkspaceDataByDomain(origin: $origin) {
    id
    logo
    displayName
    workspaceUrls {
      subdomainUrl
      customUrl
    }
    authProviders {
      google
      magicLink
      password
      microsoft
      sso {
        id
        name
        type
        status
        issuer
      }
    }
    authBypassProviders {
      google
      password
      microsoft
    }
  }
}`;

function maskToken(token: string): string {
  if (token.length <= 8) return "****";
  return token.slice(0, 4) + "****" + token.slice(-4);
}

function applyEnvFileOption(command: Command): Command {
  return command.option("--env-file <path>", "Load environment variables from file");
}

export function registerAuthCommand(program: Command): void {
  const authCmd = program.command("auth").description("Manage authentication and workspaces");

  // auth list
  const listCmd = authCmd.command("list").description("List configured workspaces");
  applyGlobalOptions(listCmd);
  listCmd.action(async (_options: unknown, command: Command) => {
    const { globalOptions, services } = await createCommandContext(command);

    const workspaces = await services.config.listWorkspaces();

    if (workspaces.length === 0) {
      // eslint-disable-next-line no-console
      console.log('No workspaces configured. Use "twenty auth login" to add a workspace.');
      return;
    }

    const displayData = workspaces.map((ws) => ({
      name: ws.name,
      default: ws.isDefault ? "Y" : "",
      apiUrl: ws.apiUrl ?? "",
    }));

    await services.output.render(displayData, {
      format: globalOptions.output,
      query: globalOptions.query,
    });
  });

  // auth switch
  applyEnvFileOption(
    authCmd
      .command("switch")
      .description("Set default workspace")
      .argument("<workspace>", "Workspace name"),
  ).action(async (workspace: string, _options: { envFile?: string }, command: Command) => {
    const { services } = await createCommandContext(command);
    await services.config.setDefaultWorkspace(workspace);
    // eslint-disable-next-line no-console
    console.log(`Switched to workspace "${workspace}".`);
  });

  // auth status
  const statusCmd = authCmd
    .command("status")
    .description("Show current authentication status")
    .option("--show-token", "Show full API token");
  applyGlobalOptions(statusCmd);
  statusCmd.action(async (options: { showToken?: boolean }, command: Command) => {
    const { globalOptions, services } = await createCommandContext(command);

    try {
      const config = await services.config.getConfig({
        workspace: globalOptions.workspace,
      });
      const statusData = {
        authenticated: true,
        workspace: config.workspace,
        apiUrl: config.apiUrl,
        apiKey: options.showToken ? config.apiKey : maskToken(config.apiKey),
        tokenSource: config.tokenSource ?? "none",
      };

      await services.output.render(statusData, {
        format: globalOptions.output,
        query: globalOptions.query,
      });
    } catch (error) {
      if (error instanceof CliError && error.code === "AUTH") {
        const statusData = {
          authenticated: false,
          error: error.message,
        };
        await services.output.render(statusData, {
          format: globalOptions.output,
          query: globalOptions.query,
        });
      } else {
        throw error;
      }
    }
  });

  const workspaceCmd = authCmd
    .command("workspace")
    .description("Show current workspace from the Twenty API");
  applyGlobalOptions(workspaceCmd);
  workspaceCmd.action(async (_options: Record<string, unknown>, command: Command) => {
    const globalOptions = resolveGlobalOptions(command);
    const services = await createServices(globalOptions);
    const response = await services.api.post<GraphQLResponse<{ currentWorkspace: unknown }>>(
      "/metadata",
      {
        query: CURRENT_WORKSPACE_QUERY,
      },
    );

    await services.output.render(
      requireGraphqlField(
        response.data ?? {},
        "currentWorkspace",
        "Failed to fetch the current workspace.",
      ),
      {
        format: globalOptions.output,
        query: globalOptions.query,
      },
    );
  });

  const discoverCmd = authCmd
    .command("discover")
    .description("Look up public workspace auth settings by origin")
    .argument("<origin>", "Workspace origin or URL");
  applyGlobalOptions(discoverCmd);
  discoverCmd.action(
    async (origin: string, _options: Record<string, unknown>, command: Command) => {
      const globalOptions = resolveGlobalOptions(command);
      const services = await createServices(globalOptions);
      const response = await requestPublic<
        GraphQLResponse<{ getPublicWorkspaceDataByDomain: unknown }>
      >(services, {
        authMode: "none",
        method: "post",
        path: "/metadata",
        data: {
          query: PUBLIC_WORKSPACE_QUERY,
          variables: { origin },
        },
      });

      await services.output.render(
        requireGraphqlField(
          response.data ?? {},
          "getPublicWorkspaceDataByDomain",
          `Failed to discover public workspace data for ${origin}.`,
        ),
        {
          format: globalOptions.output,
          query: globalOptions.query,
        },
      );
    },
  );

  const renewTokenCmd = authCmd
    .command("renew-token")
    .description("Exchange an app refresh token for new auth tokens")
    .requiredOption("--app-token <token>", "App refresh token");
  applyGlobalOptions(renewTokenCmd);
  renewTokenCmd.action(async (options: { appToken: string }, commandOptions: Command) => {
    const globalOptions = resolveGlobalOptions(commandOptions);
    const services = await createServices(globalOptions);
    const surface = await resolveAuthRequestSurface(services.config, globalOptions.workspace);
    const payload = buildRenewTokenRequestData(options.appToken, surface.hosted);
    const response = await requestPublic<GraphQLResponse<{ renewToken: unknown }>>(services, {
      authMode: "none",
      method: "post",
      path: surface.path,
      data: {
        query: payload.query,
        variables: payload.variables,
      },
    });

    await services.output.render(
      requireGraphqlField(response.data ?? {}, "renewToken", "Failed to renew auth token."),
      {
        format: globalOptions.output,
        query: globalOptions.query,
      },
    );
  });

  const ssoUrlCmd = authCmd
    .command("sso-url")
    .description("Get the SSO authorization URL for an identity provider")
    .argument("<identityProviderId>", "Identity provider ID")
    .option("--workspace-invite-hash <hash>", "Optional workspace invite hash");
  applyGlobalOptions(ssoUrlCmd);
  ssoUrlCmd.action(
    async (
      identityProviderId: string,
      options: { workspaceInviteHash?: string },
      commandOptions: Command,
    ) => {
      const globalOptions = resolveGlobalOptions(commandOptions);
      const services = await createServices(globalOptions);
      const surface = await resolveAuthRequestSurface(services.config, globalOptions.workspace);
      const payload = buildSsoUrlRequestData(identityProviderId, options.workspaceInviteHash);
      const response = await requestPublic<GraphQLResponse<{ getAuthorizationUrlForSSO: unknown }>>(
        services,
        {
          authMode: "none",
          method: "post",
          path: surface.path,
          data: {
            query: payload.query,
            variables: payload.variables,
          },
        },
      );

      await services.output.render(
        requireGraphqlField(
          response.data ?? {},
          "getAuthorizationUrlForSSO",
          `Failed to fetch the SSO authorization URL for ${identityProviderId}.`,
        ),
        {
          format: globalOptions.output,
          query: globalOptions.query,
        },
      );
    },
  );

  // auth login
  authCmd
    .command("login")
    .description("Configure API credentials")
    .option("--token <token>", "API token to write to .env or --env-file")
    .option("--base-url <url>", "API base URL", "https://api.twenty.com")
    .option("--workspace <name>", "Workspace name", "default")
    .option("--env-file <path>", "Load environment variables from file")
    .action(
      async (
        options: { token?: string; baseUrl: string; workspace: string; envFile?: string },
        command: Command,
      ) => {
        const { services } = await createCommandContext(command);

        await services.config.saveWorkspace(options.workspace, {
          apiUrl: options.baseUrl,
        });

        if (options.token) {
          const envPath = path.resolve(process.cwd(), options.envFile ?? ".env");
          await upsertEnvValue(envPath, API_TOKEN_ENV_VAR, options.token);
          // eslint-disable-next-line no-console
          console.log(`Token written to ${envPath}.`);
        }

        // eslint-disable-next-line no-console
        console.log(`Workspace "${options.workspace}" configured.`);
        // eslint-disable-next-line no-console
        console.log(`API URL: ${options.baseUrl}`);
        if (!options.token) {
          // eslint-disable-next-line no-console
          console.log(
            `Set ${API_TOKEN_ENV_VAR} in .env, --env-file, or your shell before authenticated commands.`,
          );
        }
      },
    );

  // auth logout
  authCmd
    .command("logout")
    .description("Remove credentials")
    .option("--workspace <name>", "Workspace name to remove")
    .option("--all", "Remove all workspaces")
    .option("--env-file <path>", "Load environment variables from file")
    .action(
      async (
        options: { workspace?: string; all?: boolean; envFile?: string },
        command: Command,
      ) => {
        const { services } = await createCommandContext(command);

        if (options.all) {
          const workspaces = await services.config.listWorkspaces();
          for (const ws of workspaces) {
            await services.config.removeWorkspace(ws.name);
          }
          // eslint-disable-next-line no-console
          console.log("All workspaces removed.");
          return;
        }

        let workspaceToRemove: string;
        if (options.workspace) {
          workspaceToRemove = options.workspace;
        } else {
          // Get current default workspace
          try {
            const config = await services.config.getConfig();
            workspaceToRemove = config.workspace ?? "default";
          } catch {
            throw new CliError(
              "No workspace specified and no default workspace configured.",
              "INVALID_ARGUMENTS",
              "Use --workspace <name> or --all to specify what to remove.",
            );
          }
        }

        await services.config.removeWorkspace(workspaceToRemove);
        // eslint-disable-next-line no-console
        console.log(`Workspace "${workspaceToRemove}" removed.`);
      },
    );
}
