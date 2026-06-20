import path from "node:path";
import { fileURLToPath } from "node:url";

import { checkRepoHygiene, formatFindingsForOutput } from "./lib/repo-hygiene.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const result = checkRepoHygiene({ rootDir: ROOT });

if (!result.hasFindings) {
  console.log("Repo hygiene scan passed.");
  process.exit(0);
}

console.error("Repo hygiene scan failed:");

for (const line of formatFindingsForOutput(result.findings)) {
  console.error(line);
}

process.exit(1);
