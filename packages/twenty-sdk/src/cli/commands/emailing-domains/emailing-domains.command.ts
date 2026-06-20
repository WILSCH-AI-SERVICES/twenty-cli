import { Command } from "commander";

import { requireGraphqlField, type GraphQLResponse } from "../../utilities/api/graphql-response";
import { CliError } from "../../utilities/errors/cli-error";
import { requireYes } from "../../utilities/shared/confirmation";
import { createCommandContext } from "../../utilities/shared/context";
import { applyGlobalOptions } from "../../utilities/shared/global-options";

interface EmailingDomainsOptions {
  domain?: string;
  driver?: string;
  yes?: boolean;
}

const EMAILING_DOMAIN_FIELDS = `
  id
  createdAt
  updatedAt
  domain
  driver
  status
  verificationRecords {
    type
    key
    value
    priority
  }
  verifiedAt
`;

const LIST_EMAILING_DOMAINS_QUERY = `query GetEmailingDomains {
  getEmailingDomains {
    ${EMAILING_DOMAIN_FIELDS}
  }
}`;

const CREATE_EMAILING_DOMAIN_MUTATION = `mutation CreateEmailingDomain($domain: String!, $driver: EmailingDomainDriver!) {
  createEmailingDomain(domain: $domain, driver: $driver) {
    ${EMAILING_DOMAIN_FIELDS}
  }
}`;

const VERIFY_EMAILING_DOMAIN_MUTATION = `mutation VerifyEmailingDomain($id: String!) {
  verifyEmailingDomain(id: $id) {
    ${EMAILING_DOMAIN_FIELDS}
  }
}`;

const DELETE_EMAILING_DOMAIN_MUTATION = `mutation DeleteEmailingDomain($id: String!) {
  deleteEmailingDomain(id: $id)
}`;

export function registerEmailingDomainsCommand(program: Command): void {
  const endpoint = "/metadata";
  const cmd = program.command("emailing-domains").description("Manage emailing domains");
  applyGlobalOptions(cmd);

  const listCmd = cmd.command("list").description("List emailing domains");
  applyGlobalOptions(listCmd);
  listCmd.action(async (_options: unknown, command: Command) => {
    const { globalOptions, services } = await createCommandContext(command);
    const response = await services.api.post<GraphQLResponse<{ getEmailingDomains?: unknown[] }>>(
      endpoint,
      {
        query: LIST_EMAILING_DOMAINS_QUERY,
      },
    );

    await services.output.render(
      requireGraphqlField(
        response.data ?? {},
        "getEmailingDomains",
        "Failed to list emailing domains.",
      ) ?? [],
      {
        format: globalOptions.output,
        query: globalOptions.query,
      },
    );
  });

  const createCmd = cmd.command("create").description("Create an emailing domain");
  createCmd
    .option("--domain <domain>", "Emailing domain name")
    .option("--driver <driver>", "Emailing domain driver", "AWS_SES");
  applyGlobalOptions(createCmd);
  createCmd.action(async (options: EmailingDomainsOptions, command: Command) => {
    const { globalOptions, services } = await createCommandContext(command);
    const domain = requireDomain(options.domain);
    const driver = normalizeDriver(options.driver);
    const response = await services.api.post<GraphQLResponse<{ createEmailingDomain?: unknown }>>(
      endpoint,
      {
        query: CREATE_EMAILING_DOMAIN_MUTATION,
        variables: { domain, driver },
      },
    );

    await services.output.render(
      requireGraphqlField(
        response.data ?? {},
        "createEmailingDomain",
        `Failed to create emailing domain ${domain}.`,
      ),
      {
        format: globalOptions.output,
        query: globalOptions.query,
      },
    );
  });

  const verifyCmd = cmd
    .command("verify")
    .description("Verify an emailing domain")
    .argument("[id]", "Emailing domain ID");
  applyGlobalOptions(verifyCmd);
  verifyCmd.action(async (id: string | undefined, _options: unknown, command: Command) => {
    const { globalOptions, services } = await createCommandContext(command);
    if (!id) {
      throw new CliError("Missing emailing domain ID.", "INVALID_ARGUMENTS");
    }

    const response = await services.api.post<GraphQLResponse<{ verifyEmailingDomain?: unknown }>>(
      endpoint,
      {
        query: VERIFY_EMAILING_DOMAIN_MUTATION,
        variables: { id },
      },
    );

    await services.output.render(
      requireGraphqlField(
        response.data ?? {},
        "verifyEmailingDomain",
        `Failed to verify emailing domain ${id}.`,
      ),
      {
        format: globalOptions.output,
        query: globalOptions.query,
      },
    );
  });

  const deleteCmd = cmd
    .command("delete")
    .description("Delete an emailing domain")
    .argument("[id]", "Emailing domain ID")
    .option("--yes", "Confirm destructive operations");
  applyGlobalOptions(deleteCmd);
  deleteCmd.action(
    async (id: string | undefined, options: EmailingDomainsOptions, command: Command) => {
      const { globalOptions, services } = await createCommandContext(command);
      if (!id) {
        throw new CliError("Missing emailing domain ID.", "INVALID_ARGUMENTS");
      }
      requireYes(options, "Delete");

      const response = await services.api.post<GraphQLResponse<{ deleteEmailingDomain?: boolean }>>(
        endpoint,
        {
          query: DELETE_EMAILING_DOMAIN_MUTATION,
          variables: { id },
        },
      );

      await services.output.render(
        {
          success: requireGraphqlField(
            response.data ?? {},
            "deleteEmailingDomain",
            `Failed to delete emailing domain ${id}.`,
          ),
          id,
        },
        {
          format: globalOptions.output,
          query: globalOptions.query,
        },
      );
    },
  );
}

function requireDomain(domain: string | undefined): string {
  if (!domain) {
    throw new CliError("Missing --domain option.", "INVALID_ARGUMENTS");
  }

  return domain;
}

function normalizeDriver(driver: string | undefined): string {
  const normalized = driver?.trim().toUpperCase() ?? "AWS_SES";

  if (normalized !== "AWS_SES") {
    throw new CliError(`Unsupported emailing domain driver "${driver}".`, "INVALID_ARGUMENTS");
  }

  return normalized;
}
