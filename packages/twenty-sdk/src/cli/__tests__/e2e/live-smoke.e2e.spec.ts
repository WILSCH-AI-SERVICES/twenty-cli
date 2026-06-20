import fs from "node:fs";

import { describe, expect, it } from "vitest";

import { resolveBuiltCliPath, runBuiltCli } from "./helpers/cli-runner";
import {
  isLiveSmokeEnabled,
  resolveLiveSmokeConfig,
  type LiveSmokeConfig,
} from "./helpers/live-config";

function buildEnv(config: LiveSmokeConfig): NodeJS.ProcessEnv {
  return {
    TWENTY_API_TOKEN: config.token,
    TWENTY_BASE_URL: config.baseUrl,
    ...(config.profile ? { TWENTY_PROFILE: config.profile } : {}),
  };
}

function runJson(args: string[], config: LiveSmokeConfig): unknown {
  const output = runBuiltCli(args, {
    env: buildEnv(config),
    throwOnNonZeroExit: true,
  }).stdout;

  return JSON.parse(output);
}

const config = resolveLiveSmokeConfig({ required: false });
const cliPath = resolveBuiltCliPath();
const canRun = isLiveSmokeEnabled() && !!config && fs.existsSync(cliPath);
const liveConfig = config as LiveSmokeConfig;
const describeIf = canRun ? describe : describe.skip;

describeIf("twenty live smoke", () => {
  it("auth status returns json", () => {
    const parsed = runJson(["auth", "status", "--output", "json"], liveConfig);
    expect(parsed).toMatchObject({
      authenticated: true,
      workspace: expect.any(String),
      apiUrl: expect.any(String),
    });
  });

  it("search returns json and tolerates empty results", () => {
    const parsed = runJson(["search", "Acme", "--output", "json"], liveConfig);
    expect(Array.isArray(parsed)).toBe(true);
  });

  it("api list people returns json", () => {
    const parsed = runJson(
      ["api", "list", "people", "--limit", "1", "--output", "json"],
      liveConfig,
    );
    expect(Array.isArray(parsed)).toBe(true);
    expect((parsed as unknown[]).length).toBeLessThanOrEqual(1);
  });

  it("mcp status returns json", () => {
    const parsed = runJson(["mcp", "status", "--output", "json"], liveConfig);
    expect(parsed).toMatchObject({
      state: expect.any(String),
    });
  });

  it("raw graphql query returns json", () => {
    const parsed = runJson(
      ["raw", "graphql", "query", "--document", "query Smoke { __typename }", "--output", "json"],
      liveConfig,
    ) as Record<string, unknown>;

    expect(parsed).toHaveProperty("data");
    expect((parsed.data as Record<string, unknown> | undefined)?.__typename).toBe("Query");
  });

  it("openapi core returns json", () => {
    const parsed = runJson(["openapi", "core", "--output", "json"], liveConfig) as Record<
      string,
      unknown
    >;
    expect(parsed).toHaveProperty("openapi");
  });
});

const routePath = process.env.TWENTY_SMOKE_ROUTE_PATH;
const describeRouteIf = canRun && routePath ? describe : describe.skip;

describeRouteIf("twenty live smoke route", () => {
  it("invokes a public route with get and json output", () => {
    const parsed = runJson(
      ["routes", "invoke", routePath!, "--method", "get", "--output", "json"],
      liveConfig,
    );
    expect(parsed).toBeDefined();
  });
});

const workflowId = process.env.TWENTY_SMOKE_WORKFLOW_ID;
const workflowWorkspaceId = process.env.TWENTY_SMOKE_WORKFLOW_WORKSPACE_ID;
const describeWorkflowIf = canRun && workflowId && workflowWorkspaceId ? describe : describe.skip;

describeWorkflowIf("twenty live smoke workflow", () => {
  it("invokes a workflow webhook with get and json output", () => {
    const parsed = runJson(
      [
        "workflows",
        "invoke-webhook",
        workflowId!,
        "--workspace-id",
        workflowWorkspaceId!,
        "--method",
        "get",
        "--output",
        "json",
      ],
      liveConfig,
    );

    expect(parsed).toBeDefined();
  });
});
