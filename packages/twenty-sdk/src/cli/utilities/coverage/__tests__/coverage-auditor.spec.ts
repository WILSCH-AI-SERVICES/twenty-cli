import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  compareCoverage,
  extractMetadataResourcesFromSource,
  parseGraphqlOperationNames,
} from "../coverage-auditor";

const openApiService = `
const metadata = [
  { nameSingular: 'object', namePlural: 'objects' },
  { nameSingular: 'webhook', namePlural: 'webhooks' },
  { nameSingular: 'apiKey', namePlural: 'apiKeys' },
  { nameSingular: 'viewFieldGroup', namePlural: 'viewFieldGroups' },
];
`;

const schema = `
type Query {
  currentUser: User!
  account: Account!
  getViewFieldGroups(viewId: String!): [ViewFieldGroup!]!
}

type Mutation {
  createApiKey(input: CreateApiKeyInput!): ApiKey!
  deleteViewFieldGroup(input: DeleteViewFieldGroupInput!): ViewFieldGroup!
}
`;

describe("coverage auditor", () => {
  let tempRoot: string;
  let upstreamPath: string;
  let cliRoot: string;

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "twenty-coverage-auditor-"));
    upstreamPath = path.join(tempRoot, "twenty-upstream");
    cliRoot = path.join(tempRoot, "cli");

    await fs.outputFile(
      path.join(
        upstreamPath,
        "packages/twenty-server/src/engine/core-modules/open-api/open-api.service.ts",
      ),
      openApiService,
    );
    await fs.outputFile(
      path.join(upstreamPath, "packages/twenty-client-sdk/src/metadata/generated/schema.graphql"),
      schema,
    );
    await fs.outputFile(
      path.join(cliRoot, "commands/raw/graphql.command.ts"),
      `const command = "raw graphql";
const examples = "currentUser account getViewFieldGroups createApiKey deleteViewFieldGroup";`,
    );
    await fs.outputFile(
      path.join(cliRoot, "commands/accounts/accounts.command.spec.ts"),
      `const coveredInSpecOnly = "query { currentUser { id } }";`,
    );
    await fs.outputFile(
      path.join(cliRoot, "commands/accounts/__tests__/accounts.command.ts"),
      `const coveredInTestsOnly = "query { getViewFieldGroups { id } }";`,
    );
    await fs.outputFile(
      path.join(cliRoot, "commands/accounts/accounts.command.ts"),
      `const notAnOperation = "query { accountSettings { id } }";`,
    );
    await fs.outputFile(
      path.join(cliRoot, "help.ts"),
      `const helpExample = "mutation { createApiKey { id } }";`,
    );
    await fs.outputFile(
      path.join(cliRoot, "help/constants.ts"),
      `const helpConstant = "mutation { deleteViewFieldGroup { id } }";`,
    );
  });

  afterEach(async () => {
    await fs.remove(tempRoot);
  });

  it("normalizes metadata resource plurals from upstream OpenAPI source", () => {
    expect(extractMetadataResourcesFromSource(openApiService)).toEqual([
      { name: "objects", commandName: "objects" },
      { name: "webhooks", commandName: "webhooks" },
      { name: "apiKeys", commandName: "api-keys" },
      { name: "viewFieldGroups", commandName: "view-field-groups" },
    ]);
  });

  it("parses GraphQL Query and Mutation operation names from SDL", () => {
    expect(parseGraphqlOperationNames(schema)).toEqual({
      Query: ["account", "currentUser", "getViewFieldGroups"],
      Mutation: ["createApiKey", "deleteViewFieldGroup"],
    });
  });

  it("reports first-class metadata and GraphQL coverage gaps while noting raw GraphQL fallback", async () => {
    const report = await compareCoverage({ upstreamPath, cliRoot });

    expect(report.status).toBe("missing_coverage");
    expect(report.summary["metadata-rest:missing"]).toBe(5);
    expect(report.summary["graphql:missing"]).toBe(5);
    expect(report.missing).toEqual(
      expect.arrayContaining([
        {
          surface: "metadata-rest",
          name: "viewFieldGroups.list",
          upstreamPath: "/metadata/viewFieldGroups",
          suggestedCommand: "twenty api-metadata view-field-groups list",
        },
        {
          surface: "metadata-rest",
          name: "viewFieldGroups.get",
          upstreamPath: "/metadata/viewFieldGroups/{id}",
          suggestedCommand: "twenty api-metadata view-field-groups get <id>",
        },
        {
          surface: "metadata-rest",
          name: "viewFieldGroups.create",
          upstreamPath: "/metadata/viewFieldGroups",
          suggestedCommand: "twenty api-metadata view-field-groups create",
        },
        {
          surface: "metadata-rest",
          name: "viewFieldGroups.update",
          upstreamPath: "/metadata/viewFieldGroups/{id}",
          suggestedCommand: "twenty api-metadata view-field-groups update <id>",
        },
        {
          surface: "metadata-rest",
          name: "viewFieldGroups.delete",
          upstreamPath: "/metadata/viewFieldGroups/{id}",
          suggestedCommand: "twenty api-metadata view-field-groups delete <id>",
        },
        {
          surface: "graphql",
          name: "Query.currentUser",
          upstreamPath: "type Query { currentUser }",
          suggestedCommand: "twenty graphql currentUser",
        },
        {
          surface: "graphql",
          name: "Query.account",
          upstreamPath: "type Query { account }",
          suggestedCommand: "twenty graphql account",
        },
        {
          surface: "graphql",
          name: "Mutation.deleteViewFieldGroup",
          upstreamPath: "type Mutation { deleteViewFieldGroup }",
          suggestedCommand: "twenty graphql deleteViewFieldGroup",
        },
      ]),
    );
    expect(report.notes).toContain(
      "Raw GraphQL is available through twenty raw graphql, but raw fallback is not counted as first-class GraphQL coverage.",
    );
    expect(report.missing).not.toContainEqual(
      expect.objectContaining({
        surface: "metadata-rest",
        name: expect.stringMatching(/^webhooks\./),
      }),
    );
    expect(report.missing).not.toContainEqual(
      expect.objectContaining({
        surface: "metadata-rest",
        name: "apiKeys.delete",
      }),
    );
  }, 30000);

  it("counts GraphQL operation literals in compiled JavaScript command sources", async () => {
    await fs.outputFile(
      path.join(cliRoot, "commands/users/users.command.js"),
      `const query = "query { currentUser { id } }";`,
    );

    const report = await compareCoverage({ upstreamPath, cliRoot });

    expect(report.summary["graphql:missing"]).toBe(4);
    expect(report.missing).not.toContainEqual(
      expect.objectContaining({
        surface: "graphql",
        name: "Query.currentUser",
      }),
    );
  });

  it("counts the dynamic top-level GraphQL operation executor as first-class GraphQL coverage", async () => {
    await fs.outputFile(
      path.join(cliRoot, "commands/graphql/graphql.command.ts"),
      `command("graphql").argument("<operation>", "GraphQL field name");
const query = buildGraphqlOperationDocument(operation, options);`,
    );

    const report = await compareCoverage({ upstreamPath, cliRoot });

    expect(report.summary["graphql:missing"]).toBe(0);
    expect(report.missing).not.toContainEqual(
      expect.objectContaining({
        surface: "graphql",
      }),
    );
  });

  it("separates baseline-allowed missing coverage from unexpected gaps", async () => {
    const baselinePath = path.join(tempRoot, "coverage-baseline.json");
    const initialReport = await compareCoverage({ upstreamPath, cliRoot });
    await fs.writeJson(
      baselinePath,
      {
        schemaVersion: 1,
        allowedMissing: [
          {
            surface: "metadata-rest",
            name: "viewFieldGroups.list",
            reason: "View field group metadata commands are deferred in this slice.",
          },
          {
            surface: "graphql",
            name: "Query.currentUser",
            reason: "Raw GraphQL remains the fallback for auth/session queries in this slice.",
          },
          {
            surface: "graphql",
            name: "Query.noLongerMissing",
            reason: "Stale baseline entries should be reported.",
          },
        ],
      },
      { spaces: 2 },
    );

    const report = await compareCoverage({ upstreamPath, cliRoot, baselinePath });

    expect(report.status).toBe("missing_coverage");
    expect(report.summary["missing:allowed"]).toBe(2);
    expect(report.summary["missing:unexpected"]).toBe(initialReport.missing.length - 2);
    expect(report.summary["baseline:unused"]).toBe(1);
    expect(report.allowedMissing).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          surface: "metadata-rest",
          name: "viewFieldGroups.list",
          reason: "View field group metadata commands are deferred in this slice.",
        }),
        expect.objectContaining({
          surface: "graphql",
          name: "Query.currentUser",
          reason: "Raw GraphQL remains the fallback for auth/session queries in this slice.",
        }),
      ]),
    );
    expect(report.unexpectedMissing).not.toContainEqual(
      expect.objectContaining({
        surface: "metadata-rest",
        name: "viewFieldGroups.list",
      }),
    );
    expect(report.unusedBaseline).toEqual([
      {
        surface: "graphql",
        name: "Query.noLongerMissing",
        reason: "Stale baseline entries should be reported.",
      },
    ]);
  });

  it("reports ok when the baseline allows every current missing gap", async () => {
    const baselinePath = path.join(tempRoot, "complete-coverage-baseline.json");
    const initialReport = await compareCoverage({ upstreamPath, cliRoot });
    await fs.writeJson(
      baselinePath,
      {
        schemaVersion: 1,
        allowedMissing: initialReport.missing.map((gap) => ({
          surface: gap.surface,
          name: gap.name,
          reason: "Current audited baseline.",
        })),
      },
      { spaces: 2 },
    );

    const report = await compareCoverage({ upstreamPath, cliRoot, baselinePath });

    expect(report.status).toBe("ok");
    expect(report.summary["missing:allowed"]).toBe(initialReport.missing.length);
    expect(report.summary["missing:unexpected"]).toBe(0);
    expect(report.unexpectedMissing).toEqual([]);
  });

  it("throws a clear error when the upstream OpenAPI source file is missing", async () => {
    const missingRoot = path.join(tempRoot, "missing-upstream");
    const expectedFile = path.join(
      missingRoot,
      "packages/twenty-server/src/engine/core-modules/open-api/open-api.service.ts",
    );

    await expect(compareCoverage({ upstreamPath: missingRoot, cliRoot })).rejects.toThrow(
      `Missing expected upstream file: ${expectedFile}`,
    );
  });

  it("throws a clear error for invalid baseline files", async () => {
    const baselinePath = path.join(tempRoot, "invalid-baseline.json");
    await fs.writeJson(baselinePath, { allowedMissing: [{ surface: "graphql" }] });

    await expect(compareCoverage({ upstreamPath, cliRoot, baselinePath })).rejects.toThrow(
      "Invalid coverage baseline entry",
    );
  });
});
