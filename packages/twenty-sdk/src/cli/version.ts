import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import packageJson from "../../package.json";

// The fork's own version — the manifest is authoritative for the fork (see FORK.md).
export const CLI_VERSION = packageJson.version;

// Where this fork was cut from. Stated, never inherited silently: the upstream's manifest
// and its release tag disagreed by four patch versions, and the source its tarballs were
// built from is not recorded anywhere upstream.
export const FORK_REPOSITORY = "WILSCH-AI-SERVICES/twenty-cli";
export const UPSTREAM_REPOSITORY = "salmonumbrella/twenty-cli";
export const UPSTREAM_COMMIT = "52d8965";
export const UPSTREAM_RELEASE_TAG = "v0.1.14";
export const UPSTREAM_MANIFEST_VERSION = "0.1.10";

type BuildInfo = { commit: string; dirty: boolean };

// Written beside cli.js by scripts/write-build-info.mjs at build time. A dist that has
// no build-info reports "unknown" rather than a commit it cannot vouch for.
export function readBuildInfo(): BuildInfo {
  const file = path.join(__dirname, "build-info.json");
  if (!existsSync(file)) {
    return { commit: "unknown", dirty: false };
  }
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as Partial<BuildInfo>;

    return {
      commit: typeof parsed.commit === "string" && parsed.commit !== "" ? parsed.commit : "unknown",
      dirty: parsed.dirty === true,
    };
  } catch {
    return { commit: "unknown", dirty: false };
  }
}

// What `twenty --version` prints: the fork's version, the commit this build came from,
// and the upstream state it was cut from — one line, so a harness that captures
// `$TW --version` records provenance, not a bare number a tarball could also print.
export function formatVersionLine(build: BuildInfo = readBuildInfo()): string {
  const commit = `${build.commit}${build.dirty ? "-dirty" : ""}`;

  return (
    `${CLI_VERSION} (${FORK_REPOSITORY}@${commit}; forked from ${UPSTREAM_REPOSITORY}@${UPSTREAM_COMMIT}, ` +
    `released as ${UPSTREAM_RELEASE_TAG}, manifest ${UPSTREAM_MANIFEST_VERSION})`
  );
}
