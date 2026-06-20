import { describe, expect, it } from "vitest";

import { buildHelpJson } from "../../../help";
import { buildProgram } from "../../../program";

describe("raw command namespace", () => {
  it("registers raw as the escape hatch namespace with rest and graphql subcommands", () => {
    const program = buildProgram();

    expect(program.commands.some((command) => command.name() === "raw")).toBe(true);
    expect(program.commands.some((command) => command.name() === "rest")).toBe(false);
    expect(program.commands.some((command) => command.name() === "graphql")).toBe(true);

    const help = buildHelpJson(program, ["raw", "--help-json"]);

    expect(help.kind).toBe("command");
    expect(help.path).toEqual(["twenty", "raw"]);
    expect(help.summary).toBe("Escape-hatch raw API commands");
    expect(help.subcommands.map((command) => command.name)).toEqual(
      expect.arrayContaining(["rest", "graphql"]),
    );
  });

  it("documents the graphql document option with the short alias and query placeholder", () => {
    const program = buildProgram();

    const help = buildHelpJson(program, ["raw", "graphql", "--help-json"]);

    expect(help.options.find((option) => option.name === "document")?.flags).toBe(
      "-d, --document <query>",
    );
  });

  it("documents the graphql file option using the planned description", () => {
    const program = buildProgram();

    const help = buildHelpJson(program, ["raw", "graphql", "--help-json"]);

    expect(help.options.find((option) => option.name === "file")?.description).toBe(
      "GraphQL document file",
    );
  });

  it("marks raw rest as mutating in help JSON", () => {
    const help = buildHelpJson(buildProgram(), ["raw", "rest", "--help-json"]);

    expect(help.capabilities.mutates).toBe(true);
  });
});
