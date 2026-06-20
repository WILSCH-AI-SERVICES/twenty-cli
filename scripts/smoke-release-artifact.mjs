import { main } from "./lib/release-artifact-smoke.mjs";

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
