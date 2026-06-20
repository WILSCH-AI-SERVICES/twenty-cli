# Twenty CLI

[![CI](https://github.com/salmonumbrella/twenty-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/salmonumbrella/twenty-cli/actions/workflows/ci.yml)

`twenty` is a terminal and automation surface for [Twenty CRM](https://github.com/twentyhq/twenty). It gives humans and agents one command tree for records, metadata, workspace admin, files, workflows, serverless functions, applications, MCP tools, and raw API escape hatches.

- inspect and mutate records from scripts
- export, import, deduplicate, merge, and group CRM data
- discover workspace metadata and generated OpenAPI schemas
- operate admin surfaces such as roles, domains, API keys, dashboards, event logs, and Postgres proxy settings
- invoke automation surfaces such as workflows, route triggers, serverless functions, skills, and MCP tools
- produce predictable JSON, JSONL, CSV, or compact agent-mode output

<!-- GENERATED:INSTALL_AND_AGENT_CONTRACT:START -->

## Installation

Install a standalone release archive, use the Homebrew formula if your account has tap access, or build from source.

```bash
# Latest macOS ARM64 archive; use linux_amd64, linux_arm64, or darwin_amd64 as needed
gh release download --repo salmonumbrella/twenty-cli --pattern 'twenty_*_darwin_arm64.tar.gz'
tar -xzf twenty_*_darwin_arm64.tar.gz
mkdir -p ~/.local/bin
install -m 0755 twenty ~/.local/bin/twenty

# Homebrew formula, updated by tagged releases; tap access required
brew install salmonumbrella/tap/twenty-cli
```

Tagged releases publish standalone `twenty` archives for macOS and Linux and update the maintained Homebrew formula. When `NPM_TOKEN` is configured, releases also publish the scoped npm package.

```bash
# Build from source
# Requires Node 24.16.0; .nvmrc is authoritative
pnpm install
pnpm build
node packages/twenty-sdk/dist/cli/cli.js --help
```

## Agents

The CLI ships with agent-mode output plus a curated root help contract and machine-readable help for automation.

```bash
twenty --help
twenty --help-json
twenty --hj
twenty roles --help-json
twenty routes invoke --hj
twenty auth list --help-json
```

- Use `--agent-mode`, `--ai`, or `TWENTY_AGENT_MODE=true` to force JSON output and default to light fields
- Add `--full` when an agent or script needs canonical field names instead of compact light keys
- Prefer twenty CMD --help-json before executing mutations
- Stable JSON fields: path, args, options, operations, capabilities, exit_codes, output_contract
- In agent mode, failures print one JSON error object to stderr

### Environment Loading

.env then .env.local then the explicit env file; existing environment variables win.

### Output Guarantees

- no-flag output is compact JSON
- --query runs before light projection and output formatting
- --light/--li renders compact short-key JSON fields
- --full renders canonical JSON field names
- --agent-mode forces JSON and behaves like --li unless --full is present
- agent-mode failures print one JSON error object to stderr
- jsonl renders one compact JSON record per line
- csv wraps singleton values, JSON-encodes nested objects/arrays, and escapes spreadsheet formulas
- text renders best-effort tables

### Exit Codes

```text
0  Success, help output, or version output
1  General or unexpected error
2  Invalid arguments or command usage error
3  Authentication or permission error
4  Network error or request failed before a response
5  Rate limited (429)
```

<!-- GENERATED:INSTALL_AND_AGENT_CONTRACT:END -->

## Quick Start

Use an API token from Twenty and keep it in env-backed storage. The CLI saves workspace metadata in `~/.twenty/config.json`; new tokens should live in `.env`, `.env.local`, an explicit env file, or the shell.

```bash
# Writes TWENTY_API_TOKEN into ./.env and stores the workspace URL/profile.
twenty auth login --token "$TWENTY_API_TOKEN" --base-url https://api.twenty.com

# Confirm which profile and workspace are active.
twenty auth status
twenty auth workspace

# Start with narrow reads.
twenty search "acme" --objects companies,people --limit 5
twenty api list people --limit 25 -o text
twenty api get companies <company-id>
```

`twenty auth login --token "$TWENTY_API_TOKEN"` writes or updates `TWENTY_API_TOKEN` in
`./.env`, or in the file passed with `--env-file`; it does not write new tokens
to `~/.twenty/config.json`. For self-hosted Twenty, pass your instance URL with
`--base-url`.

Use named profiles when you have multiple workspaces:

```bash
twenty auth login --workspace staging --token "$STAGING_TOKEN" --base-url https://crm.example.com --env-file .env.staging
twenty auth switch staging
twenty auth status --workspace staging --env-file .env.staging
```

## What To Use It For

| Job                          | Commands                                                                           | Example                                                                |
| ---------------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Records                      | `api`, `search`, `records`                                                         | `twenty api list people --limit 50`                                    |
| Metadata                     | `api-metadata`, `metadata`, `schema`, `openapi`                                    | `twenty api-metadata fields list --object person`                      |
| Workspace admin              | `roles`, `api-keys`, `public-domains`, `event-logs`, `dashboards`                  | `twenty roles list --include-targets`                                  |
| Apps and automation          | `workflows`, `routes`, `route-triggers`, `serverless`, `applications`, `skills`    | `twenty workflows run <workflow-version-id> --data '{"source":"cli"}'` |
| Integrations                 | `webhooks`, `connected-accounts`, `message-channels`, `calendar-channels`, `files` | `twenty files upload ./report.pdf --target files-field`                |
| Escape hatches               | `raw`, `graphql`, `mcp`                                                            | `twenty raw rest GET /health`                                          |
| Self-hosted read diagnostics | `db`                                                                               | `twenty db doctor --full`                                              |

Every command family supports `twenty <command> --help` for human help and `twenty <command> --help-json` for machine-readable contracts. For mutations, inspect `--help-json` before composing scripts.

## Cookbook

### Records

Record commands use Twenty object names. Standard and custom objects both work as long as the object exists in the active workspace.

```bash
twenty api list people --limit 25 -o text
twenty api get opportunities <opportunity-id> --include company
twenty api create companies --data '{"name":"Acme"}'
twenty api update people <person-id> --set city="Chicago"
twenty api delete notes <note-id> --yes
twenty api import people ./people.csv --dry-run
twenty api export companies --format csv --output-file companies.csv
twenty api group-by opportunities --field stage
twenty api find-duplicates people --ids <person-id>
```

Broad reads are intentionally bounded. `api list --all` uses a page size of 200 by default, requires `--limit` to stay between 1 and 500, and stops with an error if it would exceed `--max-records` (default 10,000, maximum 1,000,000). `api export --all` uses the same stdout cap; file exports default to 100,000 records.

Batch and destructive operations support `--ids`, `--filter`, `--data`, `--file`, and `--yes` depending on the operation:

```bash
twenty api batch-update --help-json
twenty api destroy --help-json
```

### Metadata And Schema

Use metadata commands when you need to inspect or change the CRM model, generated REST shape, or UI metadata:

```bash
twenty api-metadata objects list
twenty api-metadata objects get person
twenty api-metadata fields list --object person
twenty api-metadata views list --object person
twenty api-metadata page-layouts list --object person --page-layout-type RECORD_PAGE
twenty schema refresh -o json
twenty schema status
twenty openapi core
twenty openapi metadata --output-file metadata-openapi.json
```

The metadata surface covers objects, fields, command menu items, front components, navigation menu items, views, view fields, view filters, view filter groups, view groups, view sorts, page layouts, page layout tabs, and page layout widgets.

### Automation, Apps, And MCP

Use these commands to drive Twenty automation and app surfaces from a terminal:

```bash
twenty workflows invoke-webhook <workflow-id> --workspace-id <workspace-id>
twenty workflows run <workflow-version-id> --data '{"source":"cli"}'
twenty workflows stop-run <workflow-run-id>
twenty routes invoke public/ping
twenty route-triggers list
twenty serverless list
twenty serverless logs <serverless-function-id> --max-events 1 -o jsonl
twenty applications list
twenty applications create-development com.example.app --name "Example App"
twenty application-registrations tarball-url <application-registration-id>
twenty marketplace-apps list
twenty skills list
twenty mcp status
twenty mcp catalog -o json
twenty mcp schema find_companies
twenty mcp exec find_companies --data '{"query":"Acme"}'
```

Some upstream Twenty GraphQL surfaces require a user-authenticated bearer token instead of a workspace API key. When a command hits one of those surfaces, the CLI fails explicitly rather than silently returning partial data.

### Files

`twenty files` uploads and downloads through verified Twenty file APIs. It does not download arbitrary URLs. Downloads accept relative `/file/...` or `/public-assets/...` paths, file IDs with `--folder` and `--token`, or same-origin absolute URLs under those routes. Downloads stream to disk, default to a 100 MiB size cap, and remove partial files on failure.

```bash
twenty files upload ./report.pdf --target files-field
twenty files download <file-id> --folder files-field --token "$FILE_TOKEN" --output-file report.pdf --max-bytes 104857600
twenty files public-asset logo.png --workspace-id <workspace-id> --application-id <application-id>
```

### Raw Access

Use raw commands when the dedicated command surface does not cover a request:

```bash
twenty raw rest GET /health
twenty raw graphql query --document 'query { currentWorkspace { id displayName } }'
twenty graphql currentUser --selection 'id email'
twenty graphql schema --output-file schema.json
```

Prefer dedicated commands for stable automation. Raw commands are thin wrappers around the active workspace API.

### Optional DB-First Reads

For supported self-hosted deployments, reads can use a direct read-only database profile. Mutations always stay on the official Twenty API. Default `auto` reads use the API for stability, including in agent mode. Use `--rs db` only when you are benchmarking or diagnosing supported DB read paths.

```bash
twenty db status
twenty db doctor --full
twenty db benchmark --iterations 5 --warmup 1 --output-file tmp/twenty-db-benchmark.json
twenty search acme --rs db --limit 10
```

The CLI auto-discovers the active Twenty workspace schema from `core.workspace` when possible. Set `TWENTY_DATABASE_SCHEMA` or initialize a DB profile with `--database-schema` when a database has multiple workspaces.

## Agent And Script Patterns

Use `--agent-mode` when an automation agent or script will consume output. Agent mode forces JSON, defaults to compact light fields, still applies `--query` before output projection, and can be expanded with `--full` when canonical field names matter.

```bash
twenty --help-json
twenty api create --help-json
twenty roles upsert-object-permissions --help-json
twenty search "acme" --objects companies,people --agent-mode
twenty api list people --limit 10 --query 'data[*].id' --full
twenty serverless logs <serverless-function-id> --max-events 1 -o jsonl
```

Practical rules:

- discover with `--help-json` before a mutation
- use `--limit`, `--query`, `--light`, or `--agent-mode` to control token volume
- add `--full` when downstream code depends on canonical field names
- use `--dry-run` where a command supports it
- prefer `-o jsonl` for streams and append-only logs
- treat exit code `2` as a usage issue an agent can self-correct

Every public command and flag has a compact 2-3 character alias for agent use. Inspect `twenty --help-json` or `twenty <command> --help-json`; command aliases appear under `subcommands[].aliases`, and flag aliases appear under `options[].aliases`.

```bash
twenty --ws demo --out json s acme --lim 5
twenty cov aliases --fail-on-missing --out json
twenty dsh dp <dashboard-id> --yes
```

## Configuration

Workspace metadata is stored in `~/.twenty/config.json`; tokens should come from env-backed storage. Existing `apiKey` values in config JSON and `TWENTY_TOKEN` env vars remain readable as legacy fallbacks.

```json
{
  "defaultWorkspace": "default",
  "workspaces": {
    "default": {
      "apiUrl": "https://api.twenty.com"
    }
  }
}
```

Environment variables can override saved configuration:

| Variable                      | Purpose                                                      |
| ----------------------------- | ------------------------------------------------------------ |
| `TWENTY_API_TOKEN`            | API token from `.env`, `.env.local`, `--env-file`, or shell. |
| `TWENTY_BASE_URL`             | API base URL.                                                |
| `TWENTY_PROFILE`              | Default workspace profile.                                   |
| `TWENTY_DB_PROFILE`           | Default DB profile.                                          |
| `TWENTY_DATABASE_URL`         | Direct database URL for supported self-hosted reads.         |
| `TWENTY_DATABASE_SCHEMA`      | Optional workspace schema for direct DB reads.               |
| `TWENTY_DB_STATEMENT_TIMEOUT` | Direct DB statement timeout in milliseconds.                 |
| `TWENTY_EVALS_ENABLE_PROD`    | Enable gated live DB/API parity checks when `1`.             |
| `TWENTY_OUTPUT`               | Default output format.                                       |
| `TWENTY_AGENT_MODE`           | Enable agent mode.                                           |
| `TWENTY_QUERY`                | Default JMESPath output filter.                              |
| `TWENTY_ENV_FILE`             | Default explicit env file path.                              |
| `TWENTY_DEBUG`                | Enable debug output.                                         |
| `TWENTY_NO_RETRY`             | Disable retries.                                             |

## Troubleshooting

**`twenty auth status` says no workspace is configured.** Run `twenty auth login --token "$TWENTY_API_TOKEN" --base-url <url>`. For multiple environments, add `--workspace <name>` and `--env-file <path>`.

**A command returns an auth or permission error.** Confirm the active profile with `twenty auth status`, then confirm the workspace with `twenty auth workspace`. Some commands require a user bearer token rather than a workspace API key.

**Output is too large for an agent.** Add `--limit`, `--query`, `--light`, or `--agent-mode`. For broad record reads, use `--max-records` so the command fails before producing unbounded output.

**CSV opens strangely in a spreadsheet.** CSV output JSON-encodes nested values and escapes spreadsheet formulas by design. Use JSON or JSONL when preserving exact values matters more than spreadsheet compatibility.

**A file download fails.** `twenty files download` only accepts Twenty file routes or same-origin URLs under `/file/...` and `/public-assets/...`. Pass `--folder` and `--token` when downloading by file ID, and raise `--max-bytes` only when you expect a larger file.

**DB reads do not work.** DB-first reads are optional and intended for supported self-hosted diagnostics. Run `twenty db doctor --full`; if no DB URL resolves, set `TWENTY_DATABASE_URL` or choose a DB profile with `twenty db profile use <name>`.

## Development

Use Node 24.16.0; `.nvmrc` is authoritative.

```bash
pnpm install
pnpm setup
pnpm check:audit
pnpm build
pnpm lint
pnpm format:check
pnpm typecheck
pnpm check:coverage
pnpm test
pnpm test:e2e
```

Refresh generated README snippets after changing root help text:

```bash
pnpm readme:generate
```

Run the full repository verification used by CI:

```bash
pnpm verify:ci
```

## Links

- [Twenty CRM](https://github.com/twentyhq/twenty)
- [Twenty API documentation](https://docs.twenty.com/developers/extend/api)
