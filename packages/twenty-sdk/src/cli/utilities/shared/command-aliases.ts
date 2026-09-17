import { Command } from "commander";

export const ROOT_COMMAND_ALIASES: Readonly<Record<string, readonly string[]>> = Object.freeze({
  "api-keys": ["ak"],
  "api-metadata": ["am"],
  "approved-access-domains": ["aad"],
  applications: ["app"],
  "application-registrations": ["ar"],
  auth: ["au"],
  "calendar-channels": ["cc"],
  config: ["cfg"],
  "connected-accounts": ["ca"],
  coverage: ["cov"],
  dashboards: ["dsh", "dh"],
  "emailing-domains": ["ed"],
  "event-logs": ["ev"],
  files: ["fl", "f"],
  graphql: ["gql"],
  "marketplace-apps": ["mp"],
  "message-channels": ["mc"],
  metadata: ["md"],
  openapi: ["oa"],
  parity: ["pty"],
  "postgres-proxy": ["pgp"],
  "public-domains": ["pd"],
  raw: ["rw"],
  records: ["rec", "r"],
  roles: ["rl"],
  routes: ["rt"],
  "route-triggers": ["rtr"],
  schema: ["sc"],
  search: ["sea", "s"],
  serverless: ["sv"],
  skills: ["sk"],
  webhooks: ["wh"],
  workflows: ["wf"],
});

export const COMMON_COMMAND_ALIASES: Readonly<Record<string, readonly string[]>> = Object.freeze({
  activate: ["on"],
  "assign-agent": ["aa"],
  "assign-role": ["ar"],
  "available-packages": ["ap"],
  "batch-create": ["bc"],
  "batch-delete": ["bd"],
  "batch-update": ["bu"],
  check: ["chk"],
  "check-records": ["ck"],
  clear: ["cl"],
  compare: ["cmp"],
  create: ["cr"],
  "create-development": ["cd"],
  "create-layer": ["cl"],
  "create-variable": ["cv"],
  deactivate: ["off"],
  delete: ["rm"],
  "delete-variable": ["dv"],
  destroy: ["ds"],
  disable: ["di"],
  discover: ["dc"],
  download: ["dl"],
  duplicate: ["dp"],
  enable: ["en"],
  execute: ["ex"],
  "find-duplicates": ["fd"],
  get: ["gt"],
  "group-by": ["gb"],
  install: ["in"],
  invoke: ["iv"],
  "invoke-webhook": ["iw"],
  list: ["ls"],
  login: ["lgn"],
  logout: ["lo"],
  logs: ["log"],
  merge: ["mg"],
  mutate: ["mut"],
  packages: ["pkg"],
  profile: ["pr"],
  "public-asset": ["pa"],
  publish: ["pub"],
  query: ["qry"],
  refresh: ["rf"],
  restore: ["rs"],
  "rotate-secret": ["rs"],
  revoke: ["rv"],
  "remove-agent": ["ra"],
  run: ["rn"],
  schema: ["sc"],
  search: ["sea", "s"],
  source: ["src"],
  "sso-url": ["sso"],
  stats: ["st"],
  status: ["st"],
  "stop-run": ["sr"],
  switch: ["sw"],
  sync: ["sy"],
  "tarball-url": ["tu"],
  "transfer-ownership": ["to"],
  uninstall: ["un"],
  update: ["up"],
  "update-variable": ["uv"],
  "upsert-field-permissions": ["ufp"],
  "upsert-object-permissions": ["uop"],
  "upsert-permission-flags": ["upf"],
  upload: ["ul"],
  validate: ["val"],
  verify: ["vf"],
  "view-filters": ["vfl"],
  "message-channel-message-associations": ["mca"],
});

export function applyCommandAliases(program: Command): void {
  applyAliasesForChildren(program);
}

export function resolveOperationAlias(
  operation: string,
  validOperations: readonly string[],
): string {
  const normalized = operation.toLowerCase();
  if (validOperations.includes(normalized)) {
    return normalized;
  }

  const matches = validOperations.filter((candidate) =>
    aliasesForOperation(candidate).includes(normalized),
  );
  return matches.length === 1 ? matches[0]! : normalized;
}

export function hasShortCommandCoverage(command: Command): boolean {
  if (/^[a-z][a-z0-9]{1,2}$/.test(command.name())) {
    return true;
  }

  return command.aliases().some((alias) => /^[a-z][a-z0-9]{1,2}$/.test(alias));
}

function applyAliasesForChildren(parent: Command): void {
  for (const command of parent.commands) {
    if (command.name() === "help" || command.name().startsWith("completion")) {
      continue;
    }

    addAliases(parent, command, aliasesFor(parent, command));
  }

  for (const command of parent.commands) {
    applyAliasesForChildren(command);
  }
}

function aliasesFor(parent: Command, command: Command): string[] {
  const name = command.name();
  const manual = parent.parent
    ? (COMMON_COMMAND_ALIASES[name] ?? [])
    : (ROOT_COMMAND_ALIASES[name] ?? []);
  const aliases = [...manual];

  if (aliases.length === 0) {
    const generated = generateShortAlias(name);
    if (generated) {
      aliases.push(generated);
    }
  }

  return aliases;
}

function aliasesForOperation(operation: string): string[] {
  const manual = COMMON_COMMAND_ALIASES[operation] ?? [];
  if (manual.length > 0) {
    return [...manual];
  }

  const generated = generateShortAlias(operation);
  return generated ? [generated] : [];
}

function addAliases(parent: Command, command: Command, aliases: string[]): void {
  if (aliases.length === 0) {
    return;
  }

  const blockedAliases = new Set<string>();
  for (const sibling of parent.commands) {
    if (sibling === command) {
      continue;
    }

    blockedAliases.add(sibling.name());
    for (const alias of sibling.aliases()) {
      blockedAliases.add(alias);
    }
  }

  const mergedAliases = new Set(command.aliases());
  for (const alias of aliases) {
    if (alias === command.name() || blockedAliases.has(alias) || mergedAliases.has(alias)) {
      continue;
    }

    command.alias(alias);
    mergedAliases.add(alias);
  }
}

export function generateShortAlias(commandName: string): string | undefined {
  const words = splitCommandName(commandName);
  if (words.length > 1) {
    return words
      .map((word) => word[0])
      .join("")
      .slice(0, 3);
  }

  const compact = words[0];
  if (!compact || compact.length <= 3) {
    return undefined;
  }

  const consonants = compact.replace(/[aeiou]/g, "");
  const candidate = (consonants.length >= 2 ? consonants : compact).slice(0, 3);
  return candidate.length >= 2 ? candidate : undefined;
}

function splitCommandName(commandName: string): string[] {
  return commandName
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .split(/[-_\s]+/)
    .map((word) => word.trim().toLowerCase())
    .filter(Boolean);
}
