// Writes packages/twenty-sdk/dist/cli/build-info.json after tsc has run, so the built
// CLI can report the commit it was built from (`twenty --version`). The file lives in
// dist, never in src: a build artifact, not a source file, so a build leaves the
// checkout clean and a checkout with no build reports no commit rather than a stale one.
import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(new URL("..", import.meta.url).pathname);
const OUT_DIR = path.join(ROOT, "packages", "twenty-sdk", "dist", "cli");

function git(args) {
  try {
    return execSync(`git ${args}`, { cwd: ROOT, stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return "";
  }
}

const commit = git("rev-parse --short=7 HEAD") || "unknown";
const dirty = commit !== "unknown" && git("status --porcelain --untracked-files=no") !== "";

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(
  path.join(OUT_DIR, "build-info.json"),
  `${JSON.stringify({ commit, dirty }, null, 2)}\n`,
);
console.log(`build-info: commit=${commit}${dirty ? " (dirty)" : ""}`);
