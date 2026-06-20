#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

import {
  findBlockingRuntimeAdvisories,
  formatBlockingRuntimeAdvisories,
} from "./lib/runtime-audit.mjs";

function readStdin() {
  return readFileSync(0, "utf8");
}

function readAuditJson() {
  if (process.argv.includes("--stdin")) {
    return readStdin();
  }

  const result = spawnSync("pnpm", ["audit", "--json", "--audit-level", "moderate"], {
    encoding: "utf8",
  });

  if (result.error) {
    throw result.error;
  }

  if (!result.stdout.trim()) {
    throw new Error(result.stderr.trim() || "pnpm audit did not produce JSON output.");
  }

  return result.stdout;
}

try {
  const report = JSON.parse(readAuditJson());
  const findings = findBlockingRuntimeAdvisories(report);

  console.log(formatBlockingRuntimeAdvisories(findings));
  process.exitCode = findings.length > 0 ? 1 : 0;
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
