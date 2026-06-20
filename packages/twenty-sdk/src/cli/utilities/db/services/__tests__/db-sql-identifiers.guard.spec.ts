import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function countQuoteIdentifierDefinitions(directory: string): number {
  let count = 0;

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) {
      if (entry.name !== "__tests__") {
        count += countQuoteIdentifierDefinitions(path);
      }
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(".ts")) {
      count += readFileSync(path, "utf8").match(/\bfunction quoteIdentifier\b/g)?.length ?? 0;
    }
  }

  return count;
}

describe("quoteIdentifier", () => {
  it("is defined exactly once in the tree", () => {
    expect(countQuoteIdentifierDefinitions("src")).toBe(1);
  });
});
