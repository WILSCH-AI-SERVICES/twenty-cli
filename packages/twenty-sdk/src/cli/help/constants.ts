import { HelpExitCode, HelpMetadata, HelpOutputContract } from "./types";

export const ROOT_HELP_FALLBACK = `twenty - CLI for Twenty

Discovery:
  twenty --help-json
  twenty --hj
  twenty CMD --help-json
  twenty CMD --hj
  twenty CMD --help
  Canonical command names, command aliases, and option aliases are all discoverable with --help-json.

Agent Use:
  Prefer twenty CMD --help-json before executing mutations.
  Stable JSON fields: path, args, options, operations, capabilities, exit_codes, output_contract.
  In agent mode, failures print one JSON error object to stderr.

Env Precedence:
  .env then .env.local then the explicit env file; existing environment variables win.

Integrations:
  twenty mcp status
  twenty mcp catalog -o json
  twenty mcp schema find_companies
  twenty mcp exec find_companies --data '{"query":"Acme"}'

Environment:
  TWENTY_API_TOKEN                  API token from .env, .env.local, --env-file, or shell
  TWENTY_DATABASE_URL           Default database URL
  TWENTY_DATABASE_SCHEMA        Optional workspace DB schema
  TWENTY_AGENT_MODE             Enable agent mode

Records:
  Normal auto reads use the API, including agent mode.
  Use --rs api for a one-off API read or --rs db for strict DB benchmarking.

Raw Access:
  twenty openapi core
  twenty graphql currentUser --selection 'id email'
  twenty raw graphql query --document 'query { currentWorkspace { id } }'
  twenty raw graphql schema --output-file schema.json
  twenty raw rest GET /health
`;

export const HELP_JSON_FLAG_ALIASES = ["--help-json", "--hj"];

export const EXIT_CODES: HelpExitCode[] = [
  {
    code: 0,
    summary: "Success, help output, or version output",
  },
  {
    code: 1,
    summary: "General or unexpected error",
  },
  {
    code: 2,
    summary: "Invalid arguments or command usage error",
  },
  {
    code: 3,
    summary: "Authentication or permission error",
  },
  {
    code: 4,
    summary: "Network error or request failed before a response was received",
  },
  {
    code: 5,
    summary: "Rate limited (HTTP 429)",
  },
];

export const OUTPUT_CONTRACT: HelpOutputContract = {
  query_language: "JMESPath",
  query_applies_before_format: true,
  formats: [
    {
      name: "json",
      summary:
        "Compact JSON. Default no-flag output; --li uses short keys and --full preserves canonical keys.",
    },
    {
      name: "jsonl",
      summary: "Newline-delimited JSON, one record per line for arrays.",
    },
    {
      name: "csv",
      summary:
        "Wraps singleton values as one record, JSON-encodes nested values, and escapes spreadsheet formulas.",
    },
    {
      name: "text",
      summary: "Best-effort table rendering for objects and arrays.",
    },
  ],
};

export const METADATA: Record<string, HelpMetadata> = {
  twenty: {
    examples: [
      "twenty auth status",
      "twenty api list people -o json",
      "twenty records people list -o json",
      "twenty metadata views list -o json",
      "twenty dashboards duplicate <dashboard-id>",
      "twenty public-domains list",
      "twenty emailing-domains list",
      "twenty event-logs list --table workspace-event",
      "twenty postgres-proxy get",
      "twenty roles list --include-targets",
      "twenty skills list",
      "twenty openapi core",
      "twenty graphql currentUser --selection 'id email'",
      "twenty schema refresh -o json",
      "twenty schema status",
      "twenty serverless list",
      "twenty routes invoke public/ping",
      "twenty coverage compare --upstream /path/to/twenty -o json",
      "twenty workflows invoke-webhook <workflow-id>",
      "twenty mcp status",
      "twenty mcp catalog -o json",
      "twenty mcp schema find_companies",
      'twenty mcp exec find_companies --data \'{"query":"Acme"}\'',
    ],
  },
  "twenty api": {
    operations: [
      { name: "list" },
      { name: "get" },
      { name: "create" },
      { name: "update" },
      { name: "delete" },
      {
        name: "destroy",
        summary: "Permanently destroy a record",
      },
      {
        name: "restore",
        summary: "Restore a soft-deleted record",
      },
      {
        name: "batch-create",
        summary: "Create multiple records",
      },
      {
        name: "batch-update",
        summary: "Update multiple records",
      },
      {
        name: "batch-delete",
        summary: "Delete multiple records",
      },
      {
        name: "import",
        summary: "Import records",
      },
      {
        name: "export",
        summary: "Export records",
        mutates: false,
      },
      {
        name: "group-by",
        summary: "Group records by a field",
        mutates: false,
      },
      {
        name: "find-duplicates",
        summary: "Find duplicate records",
        mutates: false,
      },
      {
        name: "merge",
        summary: "Merge duplicate records",
      },
    ],
    examples: [
      "twenty api list people --limit 10 -o json",
      "twenty api list people --all --max-records 10000 -o json",
      'twenty api create notes --data \'{"title":"Hello"}\'',
    ],
  },
  "twenty records": {
    examples: [
      "twenty schema refresh core",
      "twenty records people list -o json",
      "twenty records people get <record-id>",
    ],
  },
  "twenty metadata": {
    examples: [
      "twenty schema refresh metadata",
      "twenty metadata views list -o json",
      "twenty metadata views get <metadata-id>",
    ],
  },
  "twenty raw": {
    examples: [
      "twenty raw graphql query --document 'query { currentWorkspace { id } }'",
      "twenty raw graphql schema --output-file schema.json",
      "twenty raw rest GET /health",
    ],
  },
  "twenty raw rest": {
    mutates: true,
  },
  "twenty raw graphql": {
    operations: [
      { name: "query", summary: "Run a GraphQL query", mutates: false },
      { name: "mutate", summary: "Run a GraphQL mutation", mutates: true },
      { name: "schema", summary: "Inspect the GraphQL schema", mutates: false },
    ],
  },
  "twenty graphql": {
    mutates: true,
    examples: [
      "twenty graphql currentUser --selection 'id email'",
      'twenty graphql updateWorkspace --kind mutation --variable-defs "$input: UpdateWorkspaceInput!" --args "input: $input" --variables \'{"input":{"displayName":"Acme"}}\' --selection "id displayName"',
    ],
  },
  "twenty routes": {
    examples: [
      "twenty routes invoke public/ping",
      'twenty routes invoke hooks/import --method post --data \'{"source":"cli"}\'',
    ],
  },
  "twenty coverage": {
    operations: [
      {
        name: "compare",
        summary: "Compare CLI coverage against upstream",
        mutates: false,
      },
      {
        name: "aliases",
        summary: "Audit command and option alias coverage",
        mutates: false,
      },
    ],
    examples: ["twenty coverage compare --upstream /path/to/twenty -o json"],
  },
  "twenty schema": {
    operations: [
      {
        name: "refresh",
        summary: "Fetch and cache discovery schemas",
        mutates: true,
      },
      {
        name: "status",
        summary: "Show cached discovery schema status",
        mutates: false,
      },
      {
        name: "clear",
        summary: "Clear cached discovery schemas",
        mutates: true,
      },
    ],
    examples: [
      "twenty schema refresh -o json",
      "twenty schema status",
      "twenty schema clear graphql",
    ],
  },
  "twenty mcp": {
    operations: [
      { name: "status", summary: "Show MCP status", mutates: false },
      { name: "catalog", summary: "List available MCP tools", mutates: false },
      { name: "schema", summary: "Get schema guidance for MCP tools", mutates: false },
      { name: "exec", summary: "Execute a Twenty MCP tool", mutates: true },
      { name: "skills", summary: "Load MCP skills", mutates: true },
      { name: "search", summary: "Search MCP help resources", mutates: false },
    ],
    examples: [
      "twenty mcp status",
      "twenty mcp catalog -o json",
      "twenty mcp schema find_companies",
      'twenty mcp exec find_companies --data \'{"query":"Acme"}\'',
    ],
  },
  "twenty roles": {
    operations: [
      {
        name: "upsert-permission-flags",
        summary: "Upsert permission flags for a role",
      },
      {
        name: "upsert-object-permissions",
        summary: "Upsert object permissions for a role",
      },
      {
        name: "upsert-field-permissions",
        summary: "Upsert field permissions for a role",
      },
      {
        name: "assign-agent",
        summary: "Assign a role to an agent",
      },
      {
        name: "remove-agent",
        summary: "Remove a role from an agent",
      },
    ],
    examples: [
      "twenty roles list --include-targets",
      "twenty roles get <role-id> --include-permissions",
      'twenty roles create --data \'{"label":"Support"}\'',
    ],
  },
  "twenty skills": {
    operations: [
      { name: "list", summary: "List skills", mutates: false },
      { name: "get", summary: "Get a skill", mutates: false },
      { name: "create", summary: "Create a skill", mutates: true },
      { name: "update", summary: "Update a skill", mutates: true },
      { name: "delete", summary: "Delete a skill", mutates: true },
      { name: "activate", summary: "Activate a skill", mutates: true },
      { name: "deactivate", summary: "Deactivate a skill", mutates: true },
    ],
    examples: [
      "twenty skills list",
      "twenty skills get <skill-id> -o json",
      'twenty skills create --data \'{"name":"workflow-building"}\'',
    ],
  },
  "twenty workflows": {
    operations: [
      { name: "invoke-webhook", summary: "Invoke a public workflow webhook", mutates: true },
      { name: "activate", summary: "Activate a workflow version", mutates: true },
      { name: "deactivate", summary: "Deactivate a workflow version", mutates: true },
      { name: "run", summary: "Run a workflow version", mutates: true },
      { name: "stop-run", summary: "Stop a workflow run", mutates: true },
    ],
    examples: [
      "twenty workflows invoke-webhook <workflow-id> --workspace-id <workspace-id>",
      "twenty workflows invoke-webhook <workflow-id> --method get --param source=cli",
      "twenty workflows activate <workflow-version-id>",
      'twenty workflows run <workflow-version-id> --data \'{"source":"cli"}\'',
      "twenty workflows stop-run <workflow-run-id>",
    ],
  },
  "twenty api-keys": {
    operations: [
      { name: "list", summary: "List API keys", mutates: false },
      { name: "get", summary: "Get an API key", mutates: false },
      { name: "create", summary: "Create an API key", mutates: true },
      { name: "update", summary: "Update an API key", mutates: true },
      { name: "revoke", summary: "Revoke an API key" },
      { name: "assign-role", summary: "Assign a role to an API key" },
    ],
    examples: [
      "twenty api-keys list",
      "twenty api-keys get <api-key-id>",
      'twenty api-keys create --data \'{"name":"CI key"}\'',
    ],
  },
  "twenty applications": {
    operations: [
      { name: "list", summary: "List applications", mutates: false },
      { name: "get", summary: "Get one application", mutates: false },
      { name: "sync", summary: "Sync an application manifest" },
      { name: "uninstall", summary: "Uninstall an application" },
      {
        name: "update-variable",
        summary: "Update an application variable",
      },
      {
        name: "create-development",
        summary: "Create a development application",
      },
      {
        name: "generate-token",
        summary: "Generate tokens for an application",
      },
    ],
    examples: [
      "twenty applications list",
      "twenty applications get <application-id>",
      "twenty applications sync --manifest-file ./manifest.json",
      "twenty applications create-development com.example.app --name 'Example App'",
      "twenty applications uninstall com.example.app --yes",
    ],
  },
  "twenty application-registrations": {
    operations: [
      {
        name: "stats",
        summary: "Get stats for an application registration",
        mutates: false,
      },
      {
        name: "tarball-url",
        summary: "Get the tarball URL for an application registration",
        mutates: false,
      },
      {
        name: "list-variables",
        summary: "List variables for an application registration",
        mutates: false,
      },
      {
        name: "create-variable",
        summary: "Create a variable for an application registration",
        mutates: true,
      },
      {
        name: "update-variable",
        summary: "Update a variable for an application registration",
        mutates: true,
      },
      {
        name: "delete-variable",
        summary: "Delete a variable for an application registration",
        mutates: true,
      },
      {
        name: "rotate-secret",
        summary: "Rotate the client secret for an application registration",
        mutates: true,
      },
      {
        name: "transfer-ownership",
        summary: "Transfer ownership of an application registration",
        mutates: true,
      },
    ],
    examples: [
      "twenty application-registrations list",
      "twenty application-registrations get <application-registration-id>",
      "twenty application-registrations rotate-secret <application-registration-id>",
    ],
  },
  "twenty marketplace-apps": {
    operations: [
      { name: "list", summary: "List marketplace apps", mutates: false },
      { name: "get", summary: "Get a marketplace app", mutates: false },
      { name: "install", summary: "Install a marketplace app", mutates: true },
    ],
    examples: [
      "twenty marketplace-apps list",
      "twenty marketplace-apps get com.example.app",
      "twenty marketplace-apps install com.example.app --version 1.2.0",
    ],
  },
  "twenty dashboards duplicate": {
    examples: ["twenty dashboards duplicate <dashboard-id>"],
  },
  "twenty public-domains": {
    operations: [
      { name: "list", summary: "List public domains", mutates: false },
      { name: "create", summary: "Create a public domain", mutates: true },
      { name: "delete", summary: "Delete a public domain", mutates: true },
      {
        name: "check-records",
        summary: "Check DNS records for a public domain",
        mutates: false,
      },
    ],
    examples: [
      "twenty public-domains list",
      "twenty public-domains create --domain app.example.com",
      "twenty public-domains check-records --domain app.example.com",
    ],
  },
  "twenty approved-access-domains": {
    operations: [
      { name: "list", summary: "List approved access domains", mutates: false },
      { name: "delete", summary: "Delete an approved access domain", mutates: true },
      {
        name: "validate",
        summary: "Validate an approved access domain",
        mutates: true,
      },
    ],
  },
  "twenty emailing-domains": {
    operations: [
      { name: "list", summary: "List emailing domains", mutates: false },
      { name: "create", summary: "Create an emailing domain", mutates: true },
      {
        name: "verify",
        summary: "Verify an emailing domain",
        mutates: true,
      },
      {
        name: "delete",
        summary: "Delete an emailing domain",
        mutates: true,
      },
    ],
    examples: [
      "twenty emailing-domains list",
      "twenty emailing-domains create --domain mail.example.com",
      "twenty emailing-domains verify <emailing-domain-id>",
    ],
  },
  "twenty postgres-proxy": {
    operations: [
      { name: "get", summary: "Get Postgres proxy credentials", mutates: false },
      { name: "enable", summary: "Enable the Postgres proxy" },
      { name: "disable", summary: "Disable the Postgres proxy" },
    ],
    examples: [
      "twenty postgres-proxy get --show-password",
      "twenty postgres-proxy enable",
      "twenty postgres-proxy disable",
    ],
  },
  "twenty webhooks": {
    operations: [
      { name: "list", summary: "List webhooks", mutates: false },
      { name: "get", summary: "Get a webhook", mutates: false },
      { name: "create", summary: "Create a webhook", mutates: true },
      { name: "update", summary: "Update a webhook", mutates: true },
      { name: "delete", summary: "Delete a webhook", mutates: true },
    ],
  },
  "twenty route-triggers": {
    operations: [
      { name: "list", summary: "List route triggers", mutates: false },
      { name: "get", summary: "Get a route trigger", mutates: false },
      { name: "create", summary: "Create a route trigger", mutates: true },
      { name: "update", summary: "Update a route trigger", mutates: true },
      { name: "delete", summary: "Delete a route trigger", mutates: true },
    ],
  },
  "twenty connected-accounts": {
    operations: [
      {
        name: "sync",
        summary: "Start a sync for a connected account",
      },
      {
        name: "get-imap-smtp-caldav",
        summary: "Get IMAP, SMTP, and CalDAV settings for a connected account",
        mutates: false,
      },
      {
        name: "save-imap-smtp-caldav",
        summary: "Save IMAP, SMTP, and CalDAV settings for a connected account",
      },
    ],
    examples: [
      "twenty connected-accounts list",
      "twenty connected-accounts get <connected-account-id>",
      "twenty connected-accounts get-imap-smtp-caldav <connected-account-id>",
      "twenty connected-accounts save-imap-smtp-caldav --account-owner-id <workspace-member-id> --handle mailbox@example.com --file account.json",
    ],
  },
  "twenty serverless": {
    operations: [
      { name: "list", summary: "List serverless functions", mutates: false },
      { name: "get", summary: "Get one serverless function", mutates: false },
      { name: "create", summary: "Create a serverless function", mutates: true },
      { name: "update", summary: "Update a serverless function", mutates: true },
      { name: "delete", summary: "Delete a serverless function", mutates: true },
      { name: "publish", summary: "Publish a serverless function", mutates: true },
      { name: "execute", summary: "Execute a serverless function", mutates: true },
      {
        name: "packages",
        summary: "List available packages for a serverless function",
        mutates: false,
      },
      {
        name: "source",
        summary: "Get the source code for a serverless function",
        mutates: false,
      },
      {
        name: "logs",
        summary: "Stream logs for a serverless function",
        mutates: false,
      },
      { name: "create-layer", summary: "Create a serverless layer", mutates: true },
      {
        name: "available-packages",
        summary: "List available packages for a serverless function",
        mutates: false,
      },
    ],
    examples: [
      "twenty serverless list",
      "twenty serverless source <serverless-function-id> -o json",
      "twenty serverless logs <serverless-function-id> --max-events 1 -o jsonl",
      "twenty serverless create-layer --package-json '{\"dependencies\":{}}' --yarn-lock 'lockfile'",
      "twenty serverless publish <serverless-function-id>",
    ],
  },
  "twenty event-logs": {
    operations: [{ name: "list", summary: "Query event logs", mutates: false }],
    examples: [
      "twenty event-logs list --table workspace-event",
      "twenty event-logs list --table pageview --include-page-info -o json",
      "twenty event-logs list --table object-event --object-metadata-id <object-metadata-id>",
    ],
  },
  "twenty openapi": {
    examples: [
      "twenty openapi core",
      "twenty openapi metadata --output-file metadata-openapi.json",
    ],
  },
  "twenty files": {
    operations: [
      { name: "upload", summary: "Upload a file", mutates: true },
      { name: "download", summary: "Download a file", mutates: false },
      { name: "public-asset", summary: "Download a public asset", mutates: false },
    ],
    examples: [
      "twenty files upload ./report.pdf --target files-field",
      'twenty files download <file-id> --folder files-field --token "$FILE_TOKEN" --max-bytes 104857600',
      "twenty files public-asset logo.png --workspace-id <workspace-id> --application-id <application-id>",
    ],
  },
};
