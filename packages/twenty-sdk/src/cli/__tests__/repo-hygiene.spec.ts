import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(__dirname, "../../../../../");

async function loadRepoHygieneModule() {
  return import(pathToFileURL(path.join(repoRoot, "scripts", "lib", "repo-hygiene.mjs")).href);
}

describe("repo hygiene scanner", () => {
  it("flags workspace urls in env example files", async () => {
    const { scanFileContent } = await loadRepoHygieneModule();
    const scheme = ["https", "://"].join("");
    const workspaceDomain = ["workspace", "example", "com"].join(".");

    const result = scanFileContent(".env.example", `TWENTY_BASE_URL=${scheme}${workspaceDomain}`);

    expect(result).toEqual([expect.objectContaining({ code: "UNAPPROVED_URL_LITERAL" })]);
  });

  it("flags bracketed IPv6 urls in env example files", async () => {
    const { scanFileContent } = await loadRepoHygieneModule();
    const ipv6Host = ["2001", "db8", "", "1"].join(":");
    const bracketedUrl = ["http", "://", "[", ipv6Host, "]"].join("");

    const result = scanFileContent(".env.example", `BASE_URL=${bracketedUrl}`);

    expect(result).toEqual([expect.objectContaining({ code: "UNAPPROVED_URL_LITERAL" })]);
  });

  it("flags escaped windows home paths in tracked files", async () => {
    const { scanFileContent } = await loadRepoHygieneModule();
    const escapedWindowsHomePath = ["C:", "\\\\", "Users", "\\\\", "alice", "\\\\", "repo"].join(
      "",
    );

    const result = scanFileContent("README.md", `See ${escapedWindowsHomePath} in the docs.`);

    expect(result).toEqual([
      expect.objectContaining({
        code: "ABSOLUTE_HOME_PATH",
        match: escapedWindowsHomePath,
      }),
    ]);
  });

  it("flags raw windows home paths in tracked files", async () => {
    const { scanFileContent } = await loadRepoHygieneModule();
    const rawWindowsHomePath = ["D:", "\\", "Users", "\\", "alice", "\\", "repo"].join("");

    const result = scanFileContent("README.md", `See ${rawWindowsHomePath} in the docs.`);

    expect(result).toEqual([
      expect.objectContaining({
        code: "ABSOLUTE_HOME_PATH",
        match: rawWindowsHomePath,
      }),
    ]);
  });

  it("flags lowercase windows home paths in tracked files", async () => {
    const { scanFileContent } = await loadRepoHygieneModule();
    const lowercaseWindowsHomePath = ["c:", "\\", "users", "\\", "alice", "\\", "repo"].join("");

    const result = scanFileContent("README.md", `See ${lowercaseWindowsHomePath} in the docs.`);

    expect(result).toEqual([
      expect.objectContaining({
        code: "ABSOLUTE_HOME_PATH",
        match: lowercaseWindowsHomePath,
      }),
    ]);
  });

  it("flags unix home paths in tracked files", async () => {
    const { scanFileContent } = await loadRepoHygieneModule();
    const unixHomePath = path.posix.join("/Users", "alice", "repo");

    const result = scanFileContent("README.md", `See ${unixHomePath} in the docs.`);

    expect(result).toEqual([
      expect.objectContaining({
        code: "ABSOLUTE_HOME_PATH",
        match: unixHomePath,
      }),
    ]);
  });

  it("flags common bearer token secret forms", async () => {
    const { scanFileContent } = await loadRepoHygieneModule();
    const token = Array.from({ length: 8 }, () => "abcd1234").join("");

    const result = scanFileContent(
      "packages/twenty-sdk/src/cli/commands/auth/__tests__/auth.command.spec.ts",
      [
        `Authorization: "Bearer ${token}"`,
        `"Authorization":"Bearer ${token}"`,
        `-H "Authorization: Bearer ${token}"`,
      ].join("\n"),
    );

    expect(result.filter((finding) => finding.code === "POSSIBLE_SECRET_LITERAL")).toHaveLength(3);
  });

  it("flags token-like query params on approved hosts", async () => {
    const { scanFileContent } = await loadRepoHygieneModule();
    const token = Array.from({ length: 6 }, () => "secreT1234").join("");
    const signedUrl = [
      ["https", "://"].join(""),
      ["api", "twenty", "com"].join("."),
      "/file/files-field/file-123?token=",
      token,
    ].join("");

    const result = scanFileContent(
      "packages/twenty-sdk/src/cli/commands/files/__tests__/files.command.spec.ts",
      `const signedUrl = "${signedUrl}";`,
    );

    expect(result).toEqual([expect.objectContaining({ code: "POSSIBLE_SECRET_LITERAL" })]);
  });

  it("flags quoted json and js secret fields", async () => {
    const { scanFileContent } = await loadRepoHygieneModule();
    const token = Array.from({ length: 4 }, () => "abcdefghijklmnopqrstuvwxyz").join("");

    const result = scanFileContent(
      "README.md",
      [`"token": "${token}"`, `"apiKey": "${token}"`].join("\n"),
    );

    expect(result.filter((finding) => finding.code === "POSSIBLE_SECRET_LITERAL")).toHaveLength(2);
  });

  it("flags unquoted assignment secrets in ordinary tracked files", async () => {
    const { scanFileContent } = await loadRepoHygieneModule();
    const token = Array.from({ length: 4 }, () => "abcdefghijklmnopqrstuvwxyz").join("");
    const assignmentKey = ["TWENTY", "_TOKEN"].join("");

    const result = scanFileContent("README.md", `${assignmentKey}=${token}`);

    expect(result).toEqual([expect.objectContaining({ code: "POSSIBLE_SECRET_LITERAL" })]);
  });

  it("flags camelCase auth token query params on approved hosts", async () => {
    const { scanFileContent } = await loadRepoHygieneModule();
    const token = Array.from({ length: 4 }, () => "abcdefghijklmnopqrstuvwxyz").join("");
    const signedUrl = [
      ["https", "://"].join(""),
      ["api", "twenty", "com"].join("."),
      "/file?authToken=",
      token,
    ].join("");

    const result = scanFileContent("README.md", `See ${signedUrl}.`);

    expect(result).toEqual([expect.objectContaining({ code: "POSSIBLE_SECRET_LITERAL" })]);
  });

  it("flags sha256 signature query params on approved hosts", async () => {
    const { scanFileContent } = await loadRepoHygieneModule();
    const token = Array.from({ length: 4 }, () => "abcdefghijklmnopqrstuvwxyz").join("");
    const signedUrl = [
      ["https", "://"].join(""),
      ["api", "twenty", "com"].join("."),
      "/file?signature=sha256:",
      token,
    ].join("");

    const result = scanFileContent("README.md", `See ${signedUrl}.`);

    expect(result).toEqual([expect.objectContaining({ code: "POSSIBLE_SECRET_LITERAL" })]);
  });

  it("flags credentials in approved-host url userinfo", async () => {
    const { scanFileContent } = await loadRepoHygieneModule();
    const password = Array.from({ length: 4 }, () => "abcdefghijklmnopqrstuvwxyz").join("");
    const signedUrl = [
      ["https", "://"].join(""),
      "user:",
      password,
      "@",
      ["api", "twenty", "com"].join("."),
      "/files/123",
    ].join("");

    const result = scanFileContent("README.md", `See ${signedUrl}.`);

    expect(result).toEqual([expect.objectContaining({ code: "POSSIBLE_SECRET_LITERAL" })]);
  });

  it("flags token fragments on approved-host urls", async () => {
    const { scanFileContent } = await loadRepoHygieneModule();
    const token = Array.from({ length: 4 }, () => "abcdefghijklmnopqrstuvwxyz").join("");
    const signedUrl = [
      ["https", "://"].join(""),
      ["api", "twenty", "com"].join("."),
      "/callback#access_token=",
      token,
    ].join("");

    const result = scanFileContent("README.md", `See ${signedUrl}.`);

    expect(result).toEqual([expect.objectContaining({ code: "POSSIBLE_SECRET_LITERAL" })]);
  });

  it("flags token-like query params in ordinary tracked files", async () => {
    const { scanFileContent } = await loadRepoHygieneModule();
    const token = Array.from({ length: 6 }, () => "secreT1234").join("");
    const signedUrl = [
      ["https", "://"].join(""),
      ["api", "twenty", "com"].join("."),
      "/file/files-field/file-123?token=",
      token,
    ].join("");

    const result = scanFileContent("README.md", `See ${signedUrl} for details.`);

    expect(result).toEqual([expect.objectContaining({ code: "POSSIBLE_SECRET_LITERAL" })]);
  });

  it("does not flag benign query param names like design or assign", async () => {
    const { scanFileContent } = await loadRepoHygieneModule();
    const token = Array.from({ length: 4 }, () => "abcdefghijklmnopqrstuvwxyz").join("");
    const benignUrl = [
      ["https", "://"].join(""),
      ["api", "twenty", "com"].join("."),
      "/file?design=",
      token,
      "&assign=",
      token,
    ].join("");

    const result = scanFileContent("README.md", `See ${benignUrl}.`);

    expect(result).toEqual([]);
  });

  it("allows bracketed loopback urls in env example files", async () => {
    const { scanFileContent } = await loadRepoHygieneModule();
    const loopbackHost = ["", "", "1"].join(":");
    const loopbackUrl = ["http", "://", "[", loopbackHost, "]", ":3000"].join("");

    const result = scanFileContent(".env.example", `BASE_URL=${loopbackUrl}`);

    expect(result).toEqual([]);
  });

  it("redacts secret literals in output formatting", async () => {
    const { formatFindingsForOutput } = await loadRepoHygieneModule();
    const token = Array.from({ length: 8 }, () => "abcd1234").join("");
    const workspaceDomain = ["workspace", "example", "com"].join(".");
    const workspaceUrl = ["https", "://", workspaceDomain].join("");
    const homePath = path.posix.join("/home", "testuser");

    const output = formatFindingsForOutput([
      {
        code: "POSSIBLE_SECRET_LITERAL",
        filePath: "packages/twenty-sdk/src/cli/commands/auth/__tests__/auth.command.spec.ts",
        match: `Authorization: Bearer ${token}`,
      },
      {
        code: "UNAPPROVED_URL_LITERAL",
        filePath: "packages/twenty-sdk/src/cli/commands/auth/__tests__/auth.command.spec.ts",
        match: workspaceUrl,
      },
      {
        code: "ABSOLUTE_HOME_PATH",
        filePath: "packages/twenty-sdk/src/cli/commands/files/__tests__/files.command.spec.ts",
        match: homePath,
      },
    ]);

    expect(output).toEqual([
      "- packages/twenty-sdk/src/cli/commands/auth/__tests__/auth.command.spec.ts (2 findings)",
      "  - POSSIBLE_SECRET_LITERAL [redacted]",
      "  - UNAPPROVED_URL_LITERAL",
      "- packages/twenty-sdk/src/cli/commands/files/__tests__/files.command.spec.ts (1 finding)",
      "  - ABSOLUTE_HOME_PATH",
    ]);
    expect(output.join("\n")).not.toContain(token);
  });

  it("flags ordinary workspace URLs in nested tracked test files", async () => {
    const { scanFileContent } = await loadRepoHygieneModule();
    const scheme = ["https", "://"].join("");
    const workspaceDomain = ["workspace", "example", "com"].join(".");

    const result = scanFileContent(
      "packages/twenty-sdk/src/cli/utilities/config/services/__tests__/fixture.spec.ts",
      `const baseUrl = "${scheme}${workspaceDomain}";`,
    );

    expect(result).toEqual([expect.objectContaining({ code: "UNAPPROVED_URL_LITERAL" })]);
  });

  it("flags ordinary workspace URLs in command test files", async () => {
    const { scanFileContent } = await loadRepoHygieneModule();
    const scheme = ["https", "://"].join("");
    const workspaceDomain = ["crm", "example", "com"].join(".");

    const result = scanFileContent(
      "packages/twenty-sdk/src/cli/commands/auth/__tests__/auth.command.spec.ts",
      `const baseUrl = "${scheme}${workspaceDomain}";`,
    );

    expect(result).toEqual([expect.objectContaining({ code: "UNAPPROVED_URL_LITERAL" })]);
  });

  it("does not flag approved urls followed by prose punctuation in strict surfaces", async () => {
    const { scanFileContent } = await loadRepoHygieneModule();

    const result = scanFileContent("README.example.md", "See https://example.com.");

    expect(result).toEqual([]);
  });

  it("does not treat config source files as strict url surfaces", async () => {
    const { scanFileContent } = await loadRepoHygieneModule();
    const scheme = ["https", "://"].join("");
    const workspaceDomain = ["workspace", "example", "com"].join(".");

    const result = scanFileContent(
      "packages/twenty-sdk/src/cli/utilities/config/services/config.service.ts",
      `const baseUrl = "${scheme}${workspaceDomain}";`,
    );

    expect(result).toEqual([]);
  });

  it("flags ordinary workspace URLs in workflow fixtures", async () => {
    const { scanFileContent } = await loadRepoHygieneModule();
    const scheme = ["https", "://"].join("");
    const workspaceDomain = ["workspace", "example", "com"].join(".");

    const result = scanFileContent(
      ".github/workflows/example.yml",
      `TWENTY_BASE_URL: ${scheme}${workspaceDomain}`,
    );

    expect(result).toEqual([expect.objectContaining({ code: "UNAPPROVED_URL_LITERAL" })]);
  });

  it("flags home paths in non-allowlisted fixture paths", async () => {
    const { scanFileContent } = await loadRepoHygieneModule();
    const homePath = path.posix.join("/home", "testuser");

    const result = scanFileContent(
      "packages/twenty-sdk/src/cli/utilities/search/services/__tests__/fixtures/fixture.spec.ts",
      `const home = "${homePath}";`,
    );

    expect(result).toEqual([expect.objectContaining({ code: "ABSOLUTE_HOME_PATH" })]);
  });

  it("allows explicit safe fixture paths and planning docs", async () => {
    const { scanFileContent } = await loadRepoHygieneModule();
    const homePath = path.posix.join("/home", "testuser");
    const designDocPath = path.posix.join(
      "/Users",
      "someone",
      "code",
      "twenty-cli",
      ".github",
      "workflows",
      "ci.yml",
    );

    expect(
      scanFileContent(
        "packages/twenty-sdk/src/cli/utilities/config/services/__tests__/config.service.spec.ts",
        `const home = "${homePath}";`,
      ),
    ).toEqual([]);

    expect(
      scanFileContent(
        "docs/superpowers/specs/2026-03-25-ci-hardening-and-live-smoke-design.md",
        `[ci.yml](${designDocPath})`,
      ),
    ).toEqual([]);

    expect(
      scanFileContent(
        "plans/2026-03-24-twenty-mcp-gap-audit.md",
        `Use ${homePath} while drafting the plan.`,
      ),
    ).toEqual([]);
  });

  it("scans tracked text files from a git repository", async () => {
    const { checkRepoHygiene } = await loadRepoHygieneModule();
    const tempRoot = mkdtempSync(path.join(process.cwd(), ".tmp-repo-hygiene-"));

    try {
      execFileSync("git", ["init", "-q"], { cwd: tempRoot });
      execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: tempRoot });
      execFileSync("git", ["config", "user.name", "Test User"], { cwd: tempRoot });

      const trackedTextPath = path.join(tempRoot, "README.example.md");
      const trackedBinaryPath = path.join(tempRoot, "image.bin");
      const untrackedPath = path.join(tempRoot, "UNTRACKED.md");

      writeFileSync(trackedTextPath, "See https://example.com.");
      writeFileSync(trackedBinaryPath, Buffer.from([0, 1, 2, 3]));
      writeFileSync(untrackedPath, "TOKEN=abcdefghijklmnopqrstuvwxyz");

      execFileSync("git", ["add", "README.example.md", "image.bin"], { cwd: tempRoot });
      rmSync(trackedTextPath);

      const result = checkRepoHygiene({ rootDir: tempRoot });

      expect(result).toEqual({
        findings: [],
        hasFindings: false,
      });
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
