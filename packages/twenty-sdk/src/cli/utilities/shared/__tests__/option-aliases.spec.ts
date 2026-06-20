import { describe, expect, it } from "vitest";

import { buildProgram } from "../../../program";
import {
  collectOptionAliasEntries,
  findOptionAliasCollisions,
  normalizeOptionAliasArgv,
} from "../option-aliases";

describe("option aliases", () => {
  it("gives every public option a 2-3 character long alias or short canonical name", () => {
    const entries = collectOptionAliasEntries(buildProgram());
    const missing = entries
      .filter((entry) => entry.aliases.length === 0)
      .map((entry) => entry.canonical);
    const invalid = entries.flatMap((entry) =>
      entry.aliases
        .filter((alias) => !/^[a-z][a-z0-9]{1,2}$/.test(alias))
        .map((alias) => `${entry.canonical}:${alias}`),
    );

    expect(missing).toEqual([]);
    expect(invalid).toEqual([]);
    expect(findOptionAliasCollisions(entries)).toEqual([]);
  });

  it("normalizes option aliases before commander parses argv", () => {
    const normalized = normalizeOptionAliasArgv(
      [
        "node",
        "twenty",
        "--ws",
        "demo",
        "--ai",
        "search",
        "acme",
        "--lim=5",
        "--out",
        "json",
        "--li",
        "--rs=db",
      ],
      buildProgram(),
    );

    expect(normalized).toEqual([
      "node",
      "twenty",
      "--workspace",
      "demo",
      "--agent-mode",
      "search",
      "acme",
      "--limit=5",
      "--output",
      "json",
      "--light",
      "--read-source=db",
    ]);
  });
});
