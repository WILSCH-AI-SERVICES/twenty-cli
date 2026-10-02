import { Command } from "commander";

import { registerApiKeysCommand } from "./commands/api-keys/api-keys.command";
import { registerApiMetadataCommand } from "./commands/api-metadata/api-metadata.command";
import { registerApiCommand } from "./commands/api/api.command";
import { registerApplicationRegistrationsCommand } from "./commands/application-registrations/application-registrations.command";
import { registerApplicationsCommand } from "./commands/applications/applications.command";
import { registerApprovedAccessDomainsCommand } from "./commands/approved-access-domains/approved-access-domains.command";
import { registerAuthCommand } from "./commands/auth/auth.command";
import { registerCalendarChannelsCommand } from "./commands/calendar-channels/calendar-channels.command";
import { registerConfigCommand } from "./commands/config/config.command";
import { registerConnectedAccountsCommand } from "./commands/connected-accounts/connected-accounts.command";
import { registerCoverageCommand } from "./commands/coverage/coverage.command";
import { registerDashboardsCommand } from "./commands/dashboards/dashboards.command";
import { registerDbCommand } from "./commands/db/db.command";
import { registerEmailingDomainsCommand } from "./commands/emailing-domains/emailing-domains.command";
import { registerEventLogsCommand } from "./commands/event-logs/event-logs.command";
import { registerFilesCommand } from "./commands/files/files.command";
import { registerGraphqlCommand } from "./commands/graphql/graphql.command";
import { registerMarketplaceAppsCommand } from "./commands/marketplace-apps/marketplace-apps.command";
import { registerMcpCommand } from "./commands/mcp/mcp.command";
import { registerMessageChannelsCommand } from "./commands/message-channels/message-channels.command";
import { registerOpenApiCommand } from "./commands/openapi/openapi.command";
import { registerParityCommand } from "./commands/parity/parity.command";
import { registerPostgresProxyCommand } from "./commands/postgres-proxy/postgres-proxy.command";
import { registerPublicDomainsCommand } from "./commands/public-domains/public-domains.command";
import { registerRawCommand } from "./commands/raw/raw.command";
import { registerRolesCommand } from "./commands/roles/roles.command";
import { registerRouteTriggersCommand } from "./commands/route-triggers/route-triggers.command";
import { registerRoutesCommand } from "./commands/routes/routes.command";
import { registerSchemaCommand } from "./commands/schema/schema.command";
import { registerSearchCommand } from "./commands/search/search.command";
import { registerServerlessCommand } from "./commands/serverless/serverless.command";
import { registerSkillsCommand } from "./commands/skills/skills.command";
import { registerViewsCommand } from "./commands/views/views.command";
import { registerWebhooksCommand } from "./commands/webhooks/webhooks.command";
import { registerWorkflowsCommand } from "./commands/workflows/workflows.command";
import { registerCachedSchemaCommands } from "./utilities/schema/schema-command-materializer";
import { applyCommandAliases } from "./utilities/shared/command-aliases";
import { applyGlobalOptions } from "./utilities/shared/global-options";
import { formatVersionLine } from "./version";

export function buildProgram(): Command {
  const program = new Command();
  program.name("twenty");
  program.description("Twenty CLI (TypeScript port) — WILSCH-AI-SERVICES fork");
  // The fork's version line carries its build commit and the upstream it was cut from, so
  // a harness that records `twenty --version` records provenance, not a bare number.
  program.version(formatVersionLine());
  applyGlobalOptions(program);
  program.exitOverride();

  registerApiCommand(program);
  registerDbCommand(program);
  registerApprovedAccessDomainsCommand(program);
  registerApiMetadataCommand(program);
  registerRawCommand(program);
  registerGraphqlCommand(program);
  registerAuthCommand(program);
  registerSearchCommand(program);
  registerWebhooksCommand(program);
  registerApiKeysCommand(program);
  registerCalendarChannelsCommand(program);
  registerConnectedAccountsCommand(program);
  registerDashboardsCommand(program);
  registerEmailingDomainsCommand(program);
  registerEventLogsCommand(program);
  registerFilesCommand(program);
  registerMessageChannelsCommand(program);
  registerOpenApiCommand(program);
  registerCoverageCommand(program);
  registerSchemaCommand(program);
  registerCachedSchemaCommands(program);
  registerPostgresProxyCommand(program);
  registerPublicDomainsCommand(program);
  registerRolesCommand(program);
  registerRoutesCommand(program);
  registerRouteTriggersCommand(program);
  registerServerlessCommand(program);
  registerApplicationsCommand(program);
  registerApplicationRegistrationsCommand(program);
  registerMarketplaceAppsCommand(program);
  registerMcpCommand(program);
  registerSkillsCommand(program);
  registerWorkflowsCommand(program);
  // Fork (WILSCH-AI-SERVICES): the configuration read-back, the parity check, and saved
  // views re-applied from a terminal.
  registerConfigCommand(program);
  registerParityCommand(program);
  registerViewsCommand(program);
  applyCommandAliases(program);

  return program;
}
