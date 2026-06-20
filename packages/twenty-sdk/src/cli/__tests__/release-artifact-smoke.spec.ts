import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(__dirname, "../../../../../");

async function loadReleaseArtifactSmokeModule() {
  return import(
    pathToFileURL(path.join(repoRoot, "scripts", "lib", "release-artifact-smoke.mjs")).href
  );
}

describe("release artifact smoke helper", () => {
  it("selects the native archive from a mixed archive list", async () => {
    const { selectNativeArchivePath } = await loadReleaseArtifactSmokeModule();
    const releaseDir = mkdtempSync(path.join(os.tmpdir(), "twenty-release-artifact-"));

    writeFileSync(path.join(releaseDir, "twenty_0.0.0-test_linux_amd64.tar.gz"), "");
    writeFileSync(path.join(releaseDir, "twenty_0.0.0-test_linux_arm64.tar.gz"), "");
    writeFileSync(path.join(releaseDir, "twenty_0.0.0-test_darwin_amd64.tar.gz"), "");
    writeFileSync(path.join(releaseDir, "twenty_0.0.0-test_darwin_arm64.tar.gz"), "");

    expect(selectNativeArchivePath(releaseDir, { platform: "darwin", arch: "arm64" })).toBe(
      path.join(releaseDir, "twenty_0.0.0-test_darwin_arm64.tar.gz"),
    );
  });

  it("extracts and smokes the packaged binary", async () => {
    const { smokeReleaseArtifact } = await loadReleaseArtifactSmokeModule();
    const releaseDir = mkdtempSync(path.join(os.tmpdir(), "twenty-release-artifact-"));
    const stagingDir = mkdtempSync(path.join(os.tmpdir(), "twenty-release-staging-"));
    const archivePath = path.join(releaseDir, "twenty_0.0.0-test_linux_amd64.tar.gz");
    const binaryPath = path.join(stagingDir, "twenty");

    try {
      writeFileSync(binaryPath, "#!/bin/sh\nexit 0\n", "utf8");
      chmodSync(binaryPath, 0o755);
      writeFileSync(
        path.join(stagingDir, "twenty-release.json"),
        `${JSON.stringify({
          archiveSuffix: "linux_amd64",
          nodeMajor: 24,
          pkgTarget: "node24-linux-x64",
        })}\n`,
        "utf8",
      );

      execFileSync("tar", ["-czf", archivePath, "-C", stagingDir, "twenty", "twenty-release.json"]);

      expect(() =>
        smokeReleaseArtifact({
          releaseDir,
          platform: "linux",
          arch: "x64",
        }),
      ).not.toThrow();
    } finally {
      rmSync(releaseDir, { force: true, recursive: true });
      rmSync(stagingDir, { force: true, recursive: true });
    }
  });

  it("requires Node 24 release metadata in the packaged archive", async () => {
    const { smokeReleaseArtifact } = await loadReleaseArtifactSmokeModule();
    const releaseDir = mkdtempSync(path.join(os.tmpdir(), "twenty-release-artifact-"));
    const stagingDir = mkdtempSync(path.join(os.tmpdir(), "twenty-release-staging-"));
    const archivePath = path.join(releaseDir, "twenty_0.0.0-test_linux_amd64.tar.gz");
    const binaryPath = path.join(stagingDir, "twenty");

    try {
      writeFileSync(binaryPath, "#!/bin/sh\nexit 0\n", "utf8");
      chmodSync(binaryPath, 0o755);

      execFileSync("tar", ["-czf", archivePath, "-C", stagingDir, "twenty"]);

      expect(() =>
        smokeReleaseArtifact({
          releaseDir,
          platform: "linux",
          arch: "x64",
        }),
      ).toThrow(/Missing release manifest/u);
    } finally {
      rmSync(releaseDir, { force: true, recursive: true });
      rmSync(stagingDir, { force: true, recursive: true });
    }
  });
});
