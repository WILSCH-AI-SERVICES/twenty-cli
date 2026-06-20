import { spawnSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(__dirname, "../../../../../");

async function loadRuntimeAuditModule() {
  return import(pathToFileURL(path.join(repoRoot, "scripts", "lib", "runtime-audit.mjs")).href);
}

function auditReport({
  dev,
  severity,
}: {
  dev: boolean;
  severity: "moderate" | "high" | "critical";
}) {
  return {
    advisories: {
      "1001": {
        module_name: "fixture-package",
        severity,
        title: `${severity} fixture advisory`,
        findings: [
          {
            paths: [dev ? "fixture-package>dev-only" : "fixture-package"],
            dev,
          },
        ],
      },
    },
  };
}

describe("runtime audit policy", () => {
  it("fails on high runtime dependency advisories", async () => {
    const { findBlockingRuntimeAdvisories } = await loadRuntimeAuditModule();

    const findings = findBlockingRuntimeAdvisories(auditReport({ dev: false, severity: "high" }));

    expect(findings).toEqual([
      expect.objectContaining({
        moduleName: "fixture-package",
        severity: "high",
        title: "high fixture advisory",
      }),
    ]);
  });

  it("fails on critical runtime dependency advisories", async () => {
    const { findBlockingRuntimeAdvisories } = await loadRuntimeAuditModule();

    const findings = findBlockingRuntimeAdvisories(
      auditReport({ dev: false, severity: "critical" }),
    );

    expect(findings).toHaveLength(1);
  });

  it("does not fail on moderate dev-only advisories", async () => {
    const { findBlockingRuntimeAdvisories } = await loadRuntimeAuditModule();

    const findings = findBlockingRuntimeAdvisories(
      auditReport({ dev: true, severity: "moderate" }),
    );

    expect(findings).toEqual([]);
  });

  it("does not fail on moderate runtime dependency advisories", async () => {
    const { findBlockingRuntimeAdvisories } = await loadRuntimeAuditModule();

    const findings = findBlockingRuntimeAdvisories(
      auditReport({ dev: false, severity: "moderate" }),
    );

    expect(findings).toEqual([]);
  });

  it("does not fail on high dev-only advisories", async () => {
    const { findBlockingRuntimeAdvisories } = await loadRuntimeAuditModule();

    const findings = findBlockingRuntimeAdvisories(auditReport({ dev: true, severity: "high" }));

    expect(findings).toEqual([]);
  });

  it("supports checking fixture audit JSON through stdin", () => {
    const result = spawnSync(
      process.execPath,
      [path.join(repoRoot, "scripts", "check-runtime-audit.mjs"), "--stdin"],
      {
        cwd: repoRoot,
        encoding: "utf8",
        input: JSON.stringify(auditReport({ dev: false, severity: "high" })),
      },
    );

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("High or critical runtime dependency advisories found");
    expect(result.stdout).toContain("fixture-package");
  });
});
