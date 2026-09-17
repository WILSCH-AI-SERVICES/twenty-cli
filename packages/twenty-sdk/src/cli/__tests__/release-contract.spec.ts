import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(__dirname, "../../../../../");

function readRepoFile(...segments: string[]) {
  return readFileSync(path.join(repoRoot, ...segments), "utf8");
}

describe("repo release consistency", () => {
  it("keeps package metadata, workflows, and install docs aligned", () => {
    const readme = readRepoFile("README.md");
    const rootPackage = JSON.parse(readRepoFile("package.json")) as {
      engines?: Record<string, string>;
      packageManager?: string;
      scripts?: Record<string, string>;
    };
    const sdkPackage = JSON.parse(readRepoFile("packages", "twenty-sdk", "package.json")) as {
      engines?: Record<string, string>;
      name?: string;
      repository?: { url?: string };
      private?: boolean;
      files?: string[];
      dependencies?: Record<string, string>;
      publishConfig?: {
        access?: string;
      };
      pkg?: {
        scripts?: string[];
      };
    };
    const ciWorkflow = readRepoFile(".github", "workflows", "ci.yml");
    const liveSmokeWorkflow = readRepoFile(".github", "workflows", "live-smoke.yml");
    const releaseWorkflow = readRepoFile(".github", "workflows", "release.yml");
    const releaseBuildScript = readRepoFile("scripts", "build-release.mjs");
    const driftWorkflow = readRepoFile(".github", "workflows", "upstream-drift.yml");
    const dependabotConfig = readRepoFile(".github", "dependabot.yml");
    const envExample = readRepoFile(".env.example");
    const nvmrc = readRepoFile(".nvmrc").trim();

    expect(rootPackage.packageManager).toMatch(/^pnpm@/);
    // Fork (WILSCH-AI-SERVICES): the house's hosts run Node 25; see FORK.md.
    expect(rootPackage.engines?.node).toBe(">=24.5.0");
    expect(sdkPackage.engines?.node).toBe(">=24.5.0");
    expect(nvmrc).toBe("24.16.0");
    expect(rootPackage.scripts).toMatchObject({
      "check:audit": "node scripts/check-runtime-audit.mjs",
      "check:coverage": "pnpm --filter ./packages/twenty-sdk test:coverage",
      "check:repo-hygiene": "node scripts/check-repo-hygiene.mjs",
      "readme:generate": "node scripts/render-readme-snippets.mjs",
      "release:build": "node scripts/build-release.mjs",
      "release:metadata": "node scripts/write-release-metadata.mjs",
      "test:smoke:live": "pnpm --filter ./packages/twenty-sdk test:e2e:live",
      "verify:ci":
        "pnpm check:audit && pnpm build && pnpm check:coverage && pnpm test:e2e && pnpm check:repo-hygiene && pnpm exec prek run --all-files",
    });
    expect(sdkPackage.name).toBe("@wilsch-ai-services/twenty-cli");
    expect(sdkPackage.repository?.url).toContain("WILSCH-AI-SERVICES/twenty-cli");
    expect(sdkPackage.private).toBe(false);
    expect(sdkPackage.files).toEqual(expect.arrayContaining(["dist/**/*"]));
    expect(sdkPackage.dependencies?.["form-data"]).toBeDefined();
    expect(sdkPackage.publishConfig?.access).toBe("public");
    expect(sdkPackage.pkg?.scripts).toEqual(
      expect.arrayContaining(["node_modules/axios/dist/node/axios.cjs"]),
    );
    expect(existsSync(path.join(repoRoot, "packages", "twenty-sdk", "package-lock.json"))).toBe(
      false,
    );

    expect(ciWorkflow).toContain("pnpm/action-setup");
    expect(ciWorkflow).toContain("node-version: 24.16.0");
    expect(ciWorkflow).not.toContain("npm ci");
    expect(ciWorkflow).toContain("permissions:");
    expect(ciWorkflow).toContain("contents: read");
    expect(ciWorkflow).toContain("pnpm verify:ci");

    expect(liveSmokeWorkflow).toContain("workflow_run:");
    expect(liveSmokeWorkflow).toContain("node-version: 24.16.0");
    expect(liveSmokeWorkflow).toContain("workflow_dispatch:");
    expect(liveSmokeWorkflow).toContain("workflow_call:");
    expect(liveSmokeWorkflow).toContain("base_url:");
    expect(liveSmokeWorkflow).toContain("workspace:");
    expect(liveSmokeWorkflow).toContain("TWENTY_LIVE_TOKEN");
    expect(liveSmokeWorkflow).toContain("github.event.workflow_run.head_sha");
    expect(liveSmokeWorkflow).toContain("concurrency:");
    expect(liveSmokeWorkflow).toContain("environment: live-smoke");
    expect(liveSmokeWorkflow).toContain("TWENTY_API_TOKEN: ${{ secrets.TWENTY_LIVE_TOKEN }}");
    expect(liveSmokeWorkflow).not.toContain("secrets:\n      TWENTY_LIVE_TOKEN:");

    expect(releaseWorkflow).toContain("actions/setup-node");
    expect(releaseWorkflow).toContain("node-version: 24.16.0");
    expect(releaseWorkflow).toContain("pnpm check:audit");
    expect(releaseWorkflow).not.toContain("setup-go");
    expect(releaseWorkflow).not.toContain("goreleaser");
    // Fork (WILSCH-AI-SERVICES): release is not gated on the upstream's live-smoke
    // environment and dispatches no Homebrew tap; parity against the house's instance is
    // `twenty parity check`, run from the host.
    expect(releaseWorkflow).not.toContain("live-smoke.yml");
    expect(releaseWorkflow).toContain("needs: [verify]");
    expect(releaseWorkflow).toContain("contents: read");
    expect(releaseWorkflow).toContain("contents: write");
    expect(releaseWorkflow).toContain("pnpm release:build");
    expect(releaseWorkflow).toContain("node scripts/smoke-release-artifact.mjs");
    expect(releaseWorkflow).toContain("actions/upload-artifact@v7");
    expect(releaseWorkflow).toContain("actions/download-artifact@v8");
    expect(releaseWorkflow).toContain("checksums.txt");
    expect(releaseWorkflow).not.toContain("HOMEBREW_TAP_TOKEN");
    expect(releaseWorkflow).not.toContain("homebrew-tap");
    expect(releaseWorkflow).toContain("NPM_TOKEN: ${{ secrets.NPM_TOKEN }}");
    expect(releaseWorkflow).toContain("if: ${{ env.NPM_TOKEN != '' }}");
    expect(releaseWorkflow).toContain(
      "pnpm --filter ./packages/twenty-sdk publish --no-git-checks",
    );
    expect(releaseBuildScript).toContain('pkgTarget: "node24-linux-x64"');
    expect(releaseBuildScript).toContain('pkgTarget: "node24-linux-arm64"');
    expect(releaseBuildScript).toContain('pkgTarget: "node24-macos-x64"');
    expect(releaseBuildScript).toContain('pkgTarget: "node24-macos-arm64"');
    expect(releaseBuildScript).not.toMatch(/pkgTarget: "node2[0-3]-/u);

    expect(rootPackage.scripts?.["check:upstream-drift"]).toBeUndefined();
    expect(driftWorkflow).toContain("repository: twentyhq/twenty");
    expect(driftWorkflow).toContain("node-version: 24.16.0");
    expect(driftWorkflow).toContain("path: twenty-upstream");
    expect(driftWorkflow).toContain("coverage compare");
    expect(driftWorkflow).toContain("--upstream ../twenty-upstream");
    expect(driftWorkflow).toContain("gh issue edit");
    expect(driftWorkflow).toContain("gh issue close");
    expect(driftWorkflow).toContain("contents: read");
    expect(driftWorkflow).not.toContain("contents: write");
    expect(driftWorkflow).not.toContain("Bump audit SHA");
    expect(driftWorkflow).not.toContain("Commit updated SHA");
    expect(driftWorkflow).not.toContain("check:upstream-drift");
    expect(driftWorkflow).not.toContain("AUDIT_SHA");

    expect(dependabotConfig).toContain('package-ecosystem: "npm"');
    expect(dependabotConfig).toContain('directory: "/"');
    expect(dependabotConfig).toContain('interval: "weekly"');
    expect(dependabotConfig).not.toContain('directory: "/packages/twenty-sdk"');

    expect(readme).toContain("<!-- GENERATED:INSTALL_AND_AGENT_CONTRACT:START -->");
    expect(readme).toContain("<!-- GENERATED:INSTALL_AND_AGENT_CONTRACT:END -->");
    expect(readme).toContain("Homebrew formula");
    expect(readme).toContain("Requires Node 24.16.0");
    expect(readme).toContain("twenty --help-json");
    expect(readme).toContain("jsonl");
    expect(readme).toContain("escapes spreadsheet formulas");
    expect(readme).toContain("api list --all");
    expect(readme).toContain("--max-bytes 104857600");
    expect(readme).toContain("TWENTY_API_TOKEN");
    expect(readme).toContain(
      "Existing `apiKey` values in config JSON and `TWENTY_TOKEN` env vars remain readable as legacy fallbacks.",
    );
    expect(readme).toContain("--agent-mode");
    expect(readme).not.toContain("Stable agent envelope output");
    expect(readme).not.toContain("npm install -g twenty-sdk");

    expect(envExample).toContain("TWENTY_API_TOKEN=your-api-token");
    expect(envExample).not.toContain("TWENTY_TOKEN=your-api-token");
  });
});
