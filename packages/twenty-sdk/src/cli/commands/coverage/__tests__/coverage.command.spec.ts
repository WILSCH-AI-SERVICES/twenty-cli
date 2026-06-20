import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Command } from "commander";
import { buildProgram } from "../../../program";
import { registerCoverageCommand } from "../coverage.command";

const openApiService = `
const metadata = [
  { nameSingular: 'object', namePlural: 'objects' },
  { nameSingular: 'apiKey', namePlural: 'apiKeys' },
  { nameSingular: 'viewFieldGroup', namePlural: 'viewFieldGroups' },
];
`;

const schema = `
type Query {
  currentUser: User!
  getViewFieldGroups(viewId: String!): [ViewFieldGroup!]!
}

type Mutation {
  createApiKey(input: CreateApiKeyInput!): ApiKey!
  deleteViewFieldGroup(input: DeleteViewFieldGroupInput!): ViewFieldGroup!
}
`;

describe("coverage command", () => {
  let program: Command;
  let tempRoot: string;
  let upstreamPath: string;
  let baselinePath: string;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let originalExitCode: string | number | undefined;

  beforeEach(async () => {
    program = new Command();
    program.exitOverride();
    registerCoverageCommand(program);

    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "twenty-coverage-command-"));
    upstreamPath = path.join(tempRoot, "twenty-upstream");
    baselinePath = path.join(tempRoot, "coverage-baseline.json");
    originalExitCode = process.exitCode;

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
    await fs.writeJson(baselinePath, {
      schemaVersion: 1,
      allowedMissing: [
        {
          surface: "metadata-rest",
          name: "viewFieldGroups.list",
          reason: "View field group metadata coverage is tracked as a known gap in this baseline.",
        },
      ],
    });

    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(async () => {
    consoleLogSpy.mockRestore();
    process.exitCode = originalExitCode;
    await fs.remove(tempRoot);
  });

  it("registers the top-level coverage command", () => {
    const command = program.commands.find((candidate) => candidate.name() === "coverage");

    expect(command).toBeDefined();
    expect(command?.description()).toBe("Audit CLI coverage against upstream");
  });

  it("registers compare with a required upstream option", () => {
    const coverage = program.commands.find((candidate) => candidate.name() === "coverage");
    const compare = coverage?.commands.find((candidate) => candidate.name() === "compare");
    const upstreamOption = compare?.options.find((option) => option.long === "--upstream");

    expect(compare).toBeDefined();
    expect(compare?.description()).toBe("Compare CLI coverage against an upstream checkout");
    expect(upstreamOption).toBeDefined();
    expect(upstreamOption?.required).toBe(true);
    expect(upstreamOption?.description).toBe("Path to upstream Twenty checkout");
    expect(compare?.options.find((option) => option.long === "--baseline")).toBeDefined();
    expect(compare?.options.find((option) => option.long === "--fail-on-unexpected")).toBeDefined();
  });

  it("rejects compare when upstream is missing", async () => {
    await expect(program.parseAsync(["node", "test", "coverage", "compare"])).rejects.toThrow(
      "required option",
    );
  });

  it("renders JSON coverage output for an upstream checkout", async () => {
    await program.parseAsync([
      "node",
      "test",
      "coverage",
      "compare",
      "--upstream",
      upstreamPath,
      "-o",
      "json",
      "--full",
    ]);

    expect(consoleLogSpy).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(consoleLogSpy.mock.calls[0]?.[0] as string) as Record<
      string,
      unknown
    >;
    expect(payload.status).toBeDefined();
    expect(payload.summary).toBeDefined();
  });

  it("applies a baseline file to the rendered coverage report", async () => {
    await program.parseAsync([
      "node",
      "test",
      "coverage",
      "compare",
      "--upstream",
      upstreamPath,
      "--baseline",
      baselinePath,
      "-o",
      "json",
      "--full",
    ]);

    const payload = JSON.parse(consoleLogSpy.mock.calls[0]?.[0] as string) as {
      allowedMissing: Array<{ surface: string; name: string; reason: string }>;
      summary: Record<string, number>;
    };
    expect(payload.summary["missing:allowed"]).toBe(1);
    expect(payload.allowedMissing).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          surface: "metadata-rest",
          name: "viewFieldGroups.list",
          reason: "View field group metadata coverage is tracked as a known gap in this baseline.",
        }),
      ]),
    );
  });

  it("sets a failing exit code when unexpected gaps remain and fail-on-unexpected is requested", async () => {
    await program.parseAsync([
      "node",
      "test",
      "coverage",
      "compare",
      "--upstream",
      upstreamPath,
      "--baseline",
      baselinePath,
      "--fail-on-unexpected",
      "-o",
      "json",
      "--full",
    ]);

    expect(process.exitCode).toBe(1);
  });

  it("includes coverage in the built program", () => {
    const builtProgram = buildProgram();

    expect(builtProgram.commands.some((command) => command.name() === "coverage")).toBe(true);
  });
});
