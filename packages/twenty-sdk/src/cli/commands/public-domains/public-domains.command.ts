import { Command } from "commander";

import { requireGraphqlField, type GraphQLResponse } from "../../utilities/api/graphql-response";
import { CliError } from "../../utilities/errors/cli-error";
import { requireYes } from "../../utilities/shared/confirmation";
import { createCommandContext } from "../../utilities/shared/context";
import { applyGlobalOptions } from "../../utilities/shared/global-options";

interface PublicDomainsOptions {
  domain?: string;
  yes?: boolean;
}

const PUBLIC_DOMAIN_FIELDS = `
  id
  domain
  isValidated
  createdAt
`;

const DOMAIN_VALID_RECORD_FIELDS = `
  id
  domain
  records {
    validationType
    type
    status
    key
    value
  }
`;

const LIST_PUBLIC_DOMAINS_QUERY = `query FindManyPublicDomains {
  findManyPublicDomains {
    ${PUBLIC_DOMAIN_FIELDS}
  }
}`;

const CREATE_PUBLIC_DOMAIN_MUTATION = `mutation CreatePublicDomain($domain: String!) {
  createPublicDomain(domain: $domain) {
    ${PUBLIC_DOMAIN_FIELDS}
  }
}`;

const DELETE_PUBLIC_DOMAIN_MUTATION = `mutation DeletePublicDomain($domain: String!) {
  deletePublicDomain(domain: $domain)
}`;

const CHECK_PUBLIC_DOMAIN_RECORDS_MUTATION = `mutation CheckPublicDomainValidRecords($domain: String!) {
  checkPublicDomainValidRecords(domain: $domain) {
    ${DOMAIN_VALID_RECORD_FIELDS}
  }
}`;

export function registerPublicDomainsCommand(program: Command): void {
  const endpoint = "/metadata";
  const cmd = program.command("public-domains").description("Manage public domains");
  applyGlobalOptions(cmd);

  const listCmd = cmd.command("list").description("List public domains");
  applyGlobalOptions(listCmd);
  listCmd.action(async (_options: unknown, command: Command) => {
    const { globalOptions, services } = await createCommandContext(command);
    const response = await services.api.post<
      GraphQLResponse<{ findManyPublicDomains?: unknown[] }>
    >(endpoint, {
      query: LIST_PUBLIC_DOMAINS_QUERY,
    });

    await services.output.render(
      requireGraphqlField(
        response.data ?? {},
        "findManyPublicDomains",
        "Failed to list public domains.",
      ) ?? [],
      {
        format: globalOptions.output,
        query: globalOptions.query,
      },
    );
  });

  const createCmd = cmd.command("create").description("Create a public domain");
  createCmd.option("--domain <domain>", "Public domain name");
  applyGlobalOptions(createCmd);
  createCmd.action(async (options: PublicDomainsOptions, command: Command) => {
    const { globalOptions, services } = await createCommandContext(command);
    const domain = requireDomain(options.domain);
    const response = await services.api.post<GraphQLResponse<{ createPublicDomain?: unknown }>>(
      endpoint,
      {
        query: CREATE_PUBLIC_DOMAIN_MUTATION,
        variables: { domain },
      },
    );

    await services.output.render(
      requireGraphqlField(
        response.data ?? {},
        "createPublicDomain",
        `Failed to create public domain ${domain}.`,
      ),
      {
        format: globalOptions.output,
        query: globalOptions.query,
      },
    );
  });

  const deleteCmd = cmd.command("delete").description("Delete a public domain");
  deleteCmd
    .option("--domain <domain>", "Public domain name")
    .option("--yes", "Confirm destructive operations");
  applyGlobalOptions(deleteCmd);
  deleteCmd.action(async (options: PublicDomainsOptions, command: Command) => {
    const { globalOptions, services } = await createCommandContext(command);
    const domain = requireDomain(options.domain);
    requireYes(options, "Delete");
    const response = await services.api.post<GraphQLResponse<{ deletePublicDomain?: boolean }>>(
      endpoint,
      {
        query: DELETE_PUBLIC_DOMAIN_MUTATION,
        variables: { domain },
      },
    );

    await services.output.render(
      {
        success: requireGraphqlField(
          response.data ?? {},
          "deletePublicDomain",
          `Failed to delete public domain ${domain}.`,
        ),
        domain,
      },
      {
        format: globalOptions.output,
        query: globalOptions.query,
      },
    );
  });

  const checkRecordsCmd = cmd
    .command("check-records")
    .description("Check public domain DNS records");
  checkRecordsCmd.option("--domain <domain>", "Public domain name");
  applyGlobalOptions(checkRecordsCmd);
  checkRecordsCmd.action(async (options: PublicDomainsOptions, command: Command) => {
    const { globalOptions, services } = await createCommandContext(command);
    const domain = requireDomain(options.domain);
    const response = await services.api.post<
      GraphQLResponse<{ checkPublicDomainValidRecords?: unknown }>
    >(endpoint, {
      query: CHECK_PUBLIC_DOMAIN_RECORDS_MUTATION,
      variables: { domain },
    });

    await services.output.render(
      requireGraphqlField(
        response.data ?? {},
        "checkPublicDomainValidRecords",
        `Failed to check DNS records for public domain ${domain}.`,
      ),
      {
        format: globalOptions.output,
        query: globalOptions.query,
      },
    );
  });
}

function requireDomain(domain: string | undefined): string {
  if (!domain) {
    throw new CliError("Missing --domain option.", "INVALID_ARGUMENTS");
  }

  return domain;
}
