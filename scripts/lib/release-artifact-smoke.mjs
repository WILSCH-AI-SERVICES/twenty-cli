import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const ARCHIVE_SUFFIXES = {
  darwin: {
    arm64: "darwin_arm64",
    x64: "darwin_amd64",
  },
  linux: {
    arm64: "linux_arm64",
    x64: "linux_amd64",
  },
};

export const SMOKE_COMMANDS = [["--help-json"], ["api", "list", "--help-json"]];
const RELEASE_MANIFEST_NAME = "twenty-release.json";

export function parseArgs(argv) {
  const args = {};

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith("--")) {
      continue;
    }

    const [flag, inlineValue] = value.split("=", 2);
    if (inlineValue !== undefined) {
      args[flag] = inlineValue;
      continue;
    }

    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      args[flag] = next;
      index += 1;
      continue;
    }

    args[flag] = "true";
  }

  return args;
}

function archiveSuffixForTarget({ platform, arch }) {
  const platformMap = ARCHIVE_SUFFIXES[platform];

  if (!platformMap) {
    throw new Error(`Unsupported release platform: ${platform}`);
  }

  const suffix = platformMap[arch];

  if (!suffix) {
    throw new Error(`Unsupported release architecture: ${platform}/${arch}`);
  }

  return suffix;
}

export function selectNativeArchivePath(
  releaseDir,
  { platform = os.platform(), arch = os.arch() } = {},
) {
  const archiveSuffix = archiveSuffixForTarget({ platform, arch });
  const releaseEntries = readdirSync(releaseDir).filter((name) =>
    /^twenty_.+\.tar\.gz$/.test(name),
  );
  const matchingArchives = releaseEntries
    .filter((name) => name.endsWith(`_${archiveSuffix}.tar.gz`))
    .sort();

  if (matchingArchives.length === 0) {
    throw new Error(`Could not find a ${archiveSuffix} release archive in ${releaseDir}`);
  }

  return path.join(releaseDir, matchingArchives[0]);
}

export function extractArchive(archivePath, extractionDir) {
  const result = spawnSync("tar", ["-xzf", archivePath, "-C", extractionDir], {
    encoding: "utf8",
    stdio: "inherit",
  });

  if (result.status !== 0) {
    throw new Error(`Failed to extract release archive: ${archivePath}`);
  }
}

export function runSmokeCommands(binaryPath, commands = SMOKE_COMMANDS) {
  for (const args of commands) {
    const result = spawnSync(binaryPath, args, {
      encoding: "utf8",
      stdio: "inherit",
    });

    if (result.status !== 0) {
      throw new Error(`Smoke command failed: ${[binaryPath, ...args].join(" ")}`);
    }
  }
}

export function verifyReleaseManifest(extractionDir, { archiveSuffix }) {
  const manifestPath = path.join(extractionDir, RELEASE_MANIFEST_NAME);
  let manifest;

  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      throw new Error(`Missing release manifest: ${manifestPath}`);
    }

    throw new Error(`Invalid release manifest: ${manifestPath}`);
  }

  if (manifest.nodeMajor !== 24) {
    throw new Error(`Release manifest must target Node 24, got ${manifest.nodeMajor}`);
  }

  if (manifest.archiveSuffix !== archiveSuffix) {
    throw new Error(
      `Release manifest archive suffix mismatch: expected ${archiveSuffix}, got ${manifest.archiveSuffix}`,
    );
  }

  if (typeof manifest.pkgTarget !== "string" || !manifest.pkgTarget.startsWith("node24-")) {
    throw new Error(`Release manifest must use a node24 pkg target, got ${manifest.pkgTarget}`);
  }
}

export function smokeReleaseArtifact({
  releaseDir,
  platform = os.platform(),
  arch = os.arch(),
  commands = SMOKE_COMMANDS,
} = {}) {
  if (!releaseDir) {
    throw new Error("Missing releaseDir.");
  }

  const archiveSuffix = archiveSuffixForTarget({ platform, arch });
  const archivePath = selectNativeArchivePath(releaseDir, { platform, arch });
  const extractionDir = mkdtempSync(path.join(os.tmpdir(), "twenty-release-artifact-"));

  try {
    extractArchive(archivePath, extractionDir);
    verifyReleaseManifest(extractionDir, { archiveSuffix });
    runSmokeCommands(path.join(extractionDir, "twenty"), commands);
  } finally {
    rmSync(extractionDir, { force: true, recursive: true });
  }
}

export function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const releaseDir = args["--release-dir"];
  const platform = args["--platform"];
  const arch = args["--arch"];

  smokeReleaseArtifact({
    releaseDir,
    platform,
    arch,
  });
}
