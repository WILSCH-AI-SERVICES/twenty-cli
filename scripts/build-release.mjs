import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  createReadStream,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { finished } from "node:stream/promises";

const ROOT = path.resolve(new URL("..", import.meta.url).pathname);
const RELEASE_DIR = path.join(ROOT, "dist", "release");
const TEMP_DIR = path.join(RELEASE_DIR, ".tmp");
const CLI_PACKAGE_JSON_PATH = path.join(ROOT, "packages", "twenty-sdk", "package.json");

const TARGETS = {
  "linux-x64": {
    archiveSuffix: "linux_amd64",
    pkgTarget: "node24-linux-x64",
  },
  "linux-arm64": {
    archiveSuffix: "linux_arm64",
    pkgTarget: "node24-linux-arm64",
  },
  "macos-x64": {
    archiveSuffix: "darwin_amd64",
    pkgTarget: "node24-macos-x64",
  },
  "macos-arm64": {
    archiveSuffix: "darwin_arm64",
    pkgTarget: "node24-macos-arm64",
  },
};

function parseArgs(argv) {
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

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: "utf8",
    stdio: "inherit",
    ...options,
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function normalizeVersion(input) {
  return input.replace(/^v/, "");
}

function updatePackageVersion(version) {
  const original = readFileSync(CLI_PACKAGE_JSON_PATH, "utf8");
  const packageJson = JSON.parse(original);

  packageJson.version = version;
  writeFileSync(CLI_PACKAGE_JSON_PATH, `${JSON.stringify(packageJson, null, 2)}\n`, "utf8");

  return original;
}

async function sha256(filePath) {
  const hash = createHash("sha256");
  const stream = createReadStream(filePath);

  stream.on("data", (chunk) => hash.update(chunk));

  await finished(stream);

  return hash.digest("hex");
}

async function writeChecksums(outputDir) {
  const archives = readdirSync(outputDir)
    .filter((name) => /^twenty_.*\.(tar\.gz)$/.test(name))
    .sort();

  const lines = [];
  for (const archive of archives) {
    const archivePath = path.join(outputDir, archive);
    lines.push(`${await sha256(archivePath)}  ${archive}`);
  }

  writeFileSync(path.join(outputDir, "checksums.txt"), `${lines.join("\n")}\n`, "utf8");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const version = args["--version"] ? normalizeVersion(args["--version"]) : undefined;
  const outputDir = args["--output-dir"] ? path.resolve(ROOT, args["--output-dir"]) : RELEASE_DIR;
  const shouldSkipBuild = args["--skip-build"] === "true";
  const requestedTargets = (args["--targets"] ?? Object.keys(TARGETS).join(","))
    .split(",")
    .map((target) => target.trim())
    .filter(Boolean);

  if (!version) {
    throw new Error("Missing --version.");
  }

  for (const target of requestedTargets) {
    if (!(target in TARGETS)) {
      throw new Error(`Unsupported release target: ${target}`);
    }
  }

  mkdirSync(outputDir, { recursive: true });
  rmSync(TEMP_DIR, { force: true, recursive: true });
  mkdirSync(TEMP_DIR, { recursive: true });

  const originalPackageJson = updatePackageVersion(version);

  try {
    if (!shouldSkipBuild) {
      run("pnpm", ["build"]);
    }

    for (const target of requestedTargets) {
      const config = TARGETS[target];
      const executableName = `twenty-${config.archiveSuffix}`;
      const executablePath = path.join(TEMP_DIR, executableName);
      const stagingDir = path.join(TEMP_DIR, `${config.archiveSuffix}-staging`);
      const archiveName = `twenty_${version}_${config.archiveSuffix}.tar.gz`;
      const archivePath = path.join(outputDir, archiveName);

      rmSync(stagingDir, { force: true, recursive: true });
      mkdirSync(stagingDir, { recursive: true });

      run("pnpm", [
        "exec",
        "pkg",
        "packages/twenty-sdk",
        "--targets",
        config.pkgTarget,
        "--output",
        executablePath,
        "--no-bytecode",
        "--public",
        "--public-packages",
        "*",
      ]);

      copyFileSync(executablePath, path.join(stagingDir, "twenty"));
      chmodSync(path.join(stagingDir, "twenty"), 0o755);
      writeFileSync(
        path.join(stagingDir, "twenty-release.json"),
        `${JSON.stringify(
          {
            archiveSuffix: config.archiveSuffix,
            nodeMajor: 24,
            pkgTarget: config.pkgTarget,
            target,
          },
          null,
          2,
        )}\n`,
        "utf8",
      );

      run("tar", ["-czf", archivePath, "-C", stagingDir, "twenty", "twenty-release.json"]);
    }

    await writeChecksums(outputDir);
  } finally {
    writeFileSync(CLI_PACKAGE_JSON_PATH, originalPackageJson, "utf8");
  }
}

await main();
