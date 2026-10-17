import { Command } from "commander";

import { formatGraphqlErrors, type GraphQLResponse } from "../../utilities/api/graphql-response";
import { CliError } from "../../utilities/errors/cli-error";
import { createCommandContext } from "../../utilities/shared/context";
import { applyGlobalOptions } from "../../utilities/shared/global-options";
import type { CliServices } from "../../utilities/shared/services";
import { findPhrase, likePatterns, phraseWords, transcriptText } from "./text-match";

type Kind = "mail" | "call";

interface SearchTextOptions {
  only?: string;
  limit: string;
}

interface Company {
  id: string;
  name: string;
}

export interface TextHit {
  kind: Kind;
  date: string | null;
  company: string | null;
  companyId: string | null;
  title: string;
  excerpt: string;
  record: string;
  open: string;
}

type Connection<T> = {
  edges?: Array<{ node: T }>;
  pageInfo?: { hasNextPage?: boolean; endCursor?: string | null };
};

interface MessageNode {
  id: string;
  subject: string | null;
  text: string | null;
  receivedAt: string | null;
  messageParticipants?: Connection<{ person?: { company?: Company | null } | null }>;
}

interface CallNode {
  id: string;
  title: string | null;
  startedAt: string | null;
  createdAt: string | null;
  transcript: unknown;
  company?: Company | null;
}

const MESSAGES_QUERY = `
  query SearchTextMessages($filter: MessageFilterInput, $after: String) {
    messages(filter: $filter, first: 100, after: $after, orderBy: [{ receivedAt: DescNullsLast }]) {
      edges { node {
        id subject text receivedAt
        messageParticipants { edges { node { person { company { id name } } } } }
      } }
      pageInfo { hasNextPage endCursor }
    }
  }`;

const CALLS_QUERY = `
  query SearchTextCalls($after: String) {
    callRecordings(filter: { transcript: { is: NOT_NULL } }, first: 20, after: $after) {
      edges { node { id title startedAt createdAt transcript company { id name } } }
      pageInfo { hasNextPage endCursor }
    }
  }`;

async function page<T>(
  services: CliServices,
  query: string,
  field: string,
  variables: Record<string, unknown>,
  visit: (node: T) => boolean,
): Promise<void> {
  let after: string | null | undefined;
  for (;;) {
    const response = await services.api.post<GraphQLResponse<Record<string, Connection<T>>>>(
      "/graphql",
      { query, variables: { ...variables, after } },
    );
    const message = formatGraphqlErrors(response.data);
    if (message) throw new CliError(message, "API_ERROR");
    const connection = response.data.data?.[field];
    if (!connection) throw new CliError(`The instance returned no ${field}.`, "API_ERROR");
    for (const edge of connection.edges ?? []) {
      if (!visit(edge.node)) return;
    }
    if (!connection.pageInfo?.hasNextPage) return;
    after = connection.pageInfo.endCursor;
  }
}

/**
 * A mail's Company is the Company of the people it was exchanged with, as Twenty files a mail
 * on a Company's timeline; a mail with none of its people on a Company has none, and when its
 * people sit on several, all are named.
 */
function mailCompanies(node: MessageNode): Company[] {
  const seen = new Map<string, Company>();
  for (const edge of node.messageParticipants?.edges ?? []) {
    const company = edge.node.person?.company;
    if (company?.id) seen.set(company.id, company);
  }
  return [...seen.values()];
}

async function searchMails(services: CliServices, phrase: string, limit: number) {
  const hits: TextHit[] = [];
  const filter = { or: likePatterns(phrase).map((ilike) => ({ text: { ilike } })) };
  await page<MessageNode>(services, MESSAGES_QUERY, "messages", { filter }, (node) => {
    const match = findPhrase(node.text ?? "", phrase);
    if (match) {
      const companies = mailCompanies(node);
      hits.push({
        kind: "mail",
        date: node.receivedAt,
        company: companies.length ? companies.map((c) => c.name).join(", ") : null,
        companyId: companies.length ? companies.map((c) => c.id).join(",") : null,
        title: node.subject ?? "",
        excerpt: match.excerpt,
        record: `message/${node.id}`,
        open: `twenty api get messages ${node.id}`,
      });
    }
    return hits.length < limit;
  });
  return hits;
}

/**
 * A transcript is stored as RAW_JSON, which the API filters only by a case-sensitive `like`,
 * so the calls are read whole from Twenty and the phrase is matched here — still only the
 * copy Twenty holds, never the transcript service.
 */
async function searchCalls(services: CliServices, phrase: string) {
  const hits: TextHit[] = [];
  await page<CallNode>(services, CALLS_QUERY, "callRecordings", {}, (node) => {
    const match = findPhrase(transcriptText(node.transcript), phrase);
    if (match) {
      hits.push({
        kind: "call",
        date: node.startedAt ?? node.createdAt,
        company: node.company?.name ?? null,
        companyId: node.company?.id ?? null,
        title: node.title ?? "",
        excerpt: match.excerpt,
        record: `callRecording/${node.id}`,
        open: `twenty api get callRecordings ${node.id}`,
      });
    }
    return true;
  });
  return hits;
}

function parseKinds(only?: string): Kind[] {
  if (!only) return ["mail", "call"];
  const kinds = only.split(",").map((kind) => kind.trim().toLowerCase());
  for (const kind of kinds) {
    if (kind !== "mail" && kind !== "call") {
      throw new CliError(`--only takes mail, call or both; got "${kind}".`, "INVALID_ARGUMENTS");
    }
  }
  return kinds as Kind[];
}

/**
 * `twenty search-text "<phrase>"` — finds a synced mail by a word in its text and a call by a
 * word in its transcript (#3355). Twenty's own `search` reads a mail's subject and a
 * recording's title only; this reads the text and the transcript Twenty stores, through the
 * same API every other command uses, and nothing outside the instance. Each hit names its
 * Company where it has one, its date, and the record to open; newest first.
 */
export function registerSearchTextCommand(program: Command): void {
  const cmd = program
    .command("search-text")
    .description("Find a mail by a word in its text and a call by a word in its transcript")
    .argument("<phrase>", "A word or a short phrase, German or English")
    .option("--only <kinds>", "mail, call, or both comma-separated (default: both)")
    .option("--limit <number>", "Maximum hits", "20");
  applyGlobalOptions(cmd);

  cmd.action(async (phrase: string, options: SearchTextOptions, command: Command) => {
    if (phraseWords(phrase).length === 0) {
      throw new CliError("Search for a word or a phrase, not nothing.", "INVALID_ARGUMENTS");
    }
    const limit = parseInt(options.limit, 10);
    if (!Number.isInteger(limit) || limit < 1) {
      throw new CliError(
        `--limit must be a positive number; got "${options.limit}".`,
        "INVALID_ARGUMENTS",
      );
    }
    const kinds = parseKinds(options.only);
    const { globalOptions, services } = await createCommandContext(command);

    const hits = [
      ...(kinds.includes("mail") ? await searchMails(services, phrase, limit) : []),
      ...(kinds.includes("call") ? await searchCalls(services, phrase) : []),
    ]
      .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""))
      .slice(0, limit);

    await services.output.render(hits, {
      format: globalOptions.output,
      query: globalOptions.query,
    });
  });
}
