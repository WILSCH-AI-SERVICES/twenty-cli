import type { Command, Option } from "commander";

export interface OptionAliasEntry {
  canonical: string;
  aliases: string[];
}

export const OPTION_ALIAS_OVERRIDES: Readonly<Record<string, readonly string[]>> = Object.freeze({
  "account-owner-id": ["aoi"],
  "agent-mode": ["ai", "agm"],
  all: ["all"],
  "application-id": ["aid"],
  args: ["arg"],
  "args-file": ["arf"],
  baseline: ["bas"],
  "base-url": ["url"],
  "batch-size": ["bsz"],
  cursor: ["cur"],
  data: ["dat"],
  "database-url": ["dbu"],
  debug: ["dbg"],
  domain: ["dom"],
  "dry-run": ["dry"],
  endpoint: ["ep"],
  "env-file": ["env"],
  exclude: ["exc"],
  "expires-at": ["exp"],
  "fail-on-unexpected": ["fou"],
  field: ["fld"],
  file: ["fil"],
  filter: ["flt"],
  "filter-file": ["flf"],
  folder: ["fol"],
  format: ["fmt"],
  full: ["ful"],
  handle: ["hdl"],
  header: ["hdr"],
  include: ["inc"],
  "include-page-info": ["ipi"],
  iterations: ["itr"],
  keep: ["kp"],
  key: ["key"],
  kind: ["knd"],
  light: ["li", "lit"],
  limit: ["lim"],
  manifest: ["man"],
  "manifest-file": ["mnf"],
  method: ["mth"],
  name: ["nam"],
  "next-step-date-field": ["nsd"],
  "next-step-field": ["nsf"],
  notes: ["nts"],
  "no-retry": ["nr"],
  object: ["obj"],
  "object-command": ["oc"],
  "operation-name": ["opn"],
  order: ["ord"],
  output: ["out"],
  "output-file": ["opf"],
  "page-layout": ["ply"],
  "page-layout-tab": ["plt"],
  "page-layout-type": ["pty"],
  param: ["par"],
  priority: ["pri"],
  query: ["qry"],
  "read-source": ["rs", "rds"],
  "record-id": ["rid"],
  "role-id": ["rol"],
  selection: ["sel"],
  set: ["set"],
  "show-password": ["shp"],
  "show-secrets": ["sec"],
  "show-token": ["tok"],
  sort: ["srt"],
  source: ["src"],
  "stage-field": ["stf"],
  "stage-from": ["sfr"],
  "stage-to": ["sto"],
  strict: ["sct"],
  target: ["tgt"],
  "trail-object": ["tro"],
  "trail-relation": ["trr"],
  "ttl-hours": ["ttl"],
  upstream: ["ups"],
  value: ["val"],
  "variable-defs": ["vdf"],
  variables: ["var"],
  "variables-file": ["vaf"],
  version: ["ver"],
  "wait-seconds": ["wts"],
  warmup: ["wrm"],
  workspace: ["ws"],
  yes: ["yes"],
  // #3266: tasks create — "title" and "rests-on-label" collide with ttl-hours and role-id.
  "rests-on-label": ["rsl"],
  title: ["tit"],
});

export function collectOptionAliasEntries(program: Command): OptionAliasEntry[] {
  const canonicalNames = new Set<string>();
  walkCommands(program, (command) => {
    for (const option of command.options) {
      const canonical = canonicalOptionName(option);
      if (canonical && canonical !== "help") {
        canonicalNames.add(canonical);
      }
    }
  });

  return Array.from(canonicalNames)
    .sort()
    .map((canonical) => ({
      canonical,
      aliases: shortAliasesForOption(canonical),
    }));
}

export function buildOptionAliasIndex(program: Command): Map<string, string> {
  const index = new Map<string, string>();
  for (const entry of collectOptionAliasEntries(program)) {
    for (const alias of entry.aliases) {
      index.set(`--${alias}`, `--${entry.canonical}`);
    }
  }
  return index;
}

export function normalizeOptionAliasArgv(argv: string[], program: Command): string[] {
  const aliases = buildOptionAliasIndex(program);
  let afterSeparator = false;

  return argv.map((token) => {
    if (token === "--") {
      afterSeparator = true;
      return token;
    }
    if (afterSeparator) return token;
    const [flag, value] = token.split("=", 2);
    if (flag === undefined) return token;
    const canonical = aliases.get(flag);
    if (!canonical) return token;
    return value === undefined ? canonical : `${canonical}=${value}`;
  });
}

export interface OptionAliasCollision {
  alias: string;
  canonicals: string[];
}

export function findOptionAliasCollisions(entries: OptionAliasEntry[]): OptionAliasCollision[] {
  const seen = new Map<string, Set<string>>();
  for (const entry of entries) {
    for (const alias of entry.aliases) {
      const canonicals = seen.get(alias) ?? new Set<string>();
      canonicals.add(entry.canonical);
      seen.set(alias, canonicals);
    }
  }

  return Array.from(seen.entries())
    .map(([alias, canonicals]) => ({ alias, canonicals: Array.from(canonicals).sort() }))
    .filter((collision) => collision.canonicals.length > 1)
    .sort((left, right) => left.alias.localeCompare(right.alias));
}

export function shortAliasesForOption(canonical: string): string[] {
  if (/^[a-z][a-z0-9]{1,2}$/.test(canonical)) {
    return [canonical];
  }

  const override = OPTION_ALIAS_OVERRIDES[canonical];
  if (override) {
    return [...override];
  }

  const generated = generateShortOptionAlias(canonical);
  return generated ? [generated] : [];
}

function generateShortOptionAlias(name: string): string | undefined {
  const words = name.split(/[-_\s]+/).filter(Boolean);
  if (words.length > 1) {
    return words
      .map((word) => word[0])
      .join("")
      .slice(0, 3);
  }

  const compact = words[0];
  if (!compact || compact.length <= 3) return compact;
  const consonants = compact.replace(/[aeiou]/g, "");
  return (consonants.length >= 2 ? consonants : compact).slice(0, 3);
}

function canonicalOptionName(option: Option): string | undefined {
  const long = option.long ?? `--${option.attributeName()}`;
  return long.replace(/^--/, "");
}

function walkCommands(command: Command, visit: (command: Command) => void): void {
  visit(command);
  for (const child of command.commands) {
    if (child.name() !== "help" && !child.name().startsWith("completion")) {
      walkCommands(child, visit);
    }
  }
}
