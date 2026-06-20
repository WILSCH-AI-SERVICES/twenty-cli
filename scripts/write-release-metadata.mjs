import { createHash } from "node:crypto";
import { createReadStream, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { finished } from "node:stream/promises";

const ROOT = path.resolve(new URL("..", import.meta.url).pathname);

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

function normalizeVersion(input) {
  return input.replace(/^v/, "");
}

async function sha256(filePath) {
  const hash = createHash("sha256");
  const stream = createReadStream(filePath);

  stream.on("data", (chunk) => hash.update(chunk));

  await finished(stream);

  return hash.digest("hex");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const outputDir = args["--output-dir"]
    ? path.resolve(ROOT, args["--output-dir"])
    : path.join(ROOT, "dist", "release");
  const outputFile = args["--output-file"]
    ? path.resolve(ROOT, args["--output-file"])
    : path.join(outputDir, "release-metadata.json");
  const tag = args["--tag"] ?? process.env.GITHUB_REF_NAME;
  const version = normalizeVersion(args["--version"] ?? tag ?? "");

  if (!version) {
    throw new Error("Missing --version or --tag.");
  }

  const archives = readdirSync(outputDir)
    .filter((name) => /^twenty_.*\.tar\.gz$/.test(name))
    .sort();

  if (archives.length === 0) {
    throw new Error(`No release archives found in ${outputDir}`);
  }

  const checksums = [];
  const assets = [];

  for (const archive of archives) {
    const archivePath = path.join(outputDir, archive);
    const digest = await sha256(archivePath);
    checksums.push(`${digest}  ${archive}`);
    assets.push({ name: archive, sha256: digest });
  }

  writeFileSync(path.join(outputDir, "checksums.txt"), `${checksums.join("\n")}\n`, "utf8");

  writeFileSync(
    outputFile,
    `${JSON.stringify(
      {
        tag: `v${version}`,
        version,
        binary_name: "twenty",
        formula_name: "twenty-cli",
        archive_prefix: "twenty",
        description: "CLI for Twenty CRM",
        assets,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

await main();
