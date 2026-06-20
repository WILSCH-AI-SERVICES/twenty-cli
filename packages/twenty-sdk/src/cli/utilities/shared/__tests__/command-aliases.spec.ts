import { Command } from "commander";
import { describe, expect, it } from "vitest";

import { resolveTargetCommand } from "../../../help/command-resolution";
import { buildProgram } from "../../../program";
import {
  applyCommandAliases,
  hasShortCommandCoverage,
  resolveOperationAlias,
} from "../command-aliases";

describe("command aliases", () => {
  it("adds short aliases across static, dynamic resource, and operation commands", () => {
    const program = new Command("twenty");
    const records = program.command("records");
    const resource = records.command("approved-access-domains");
    resource.command("list");

    applyCommandAliases(program);

    expect(records.aliases()).toContain("r");
    expect(resource.aliases()).toContain("aad");
    expect(resource.commands.find((command) => command.name() === "list")?.aliases()).toContain(
      "ls",
    );
    expect(resolveTargetCommand(program, ["r", "aad", "ls"]).path).toEqual([
      "twenty",
      "records",
      "approved-access-domains",
      "list",
    ]);
  });

  it("does not add an alias that collides with a sibling command", () => {
    const program = new Command("twenty");
    const parent = program.command("parent");
    parent.command("bet");
    parent.command("buildExportTask");

    applyCommandAliases(program);

    expect(
      parent.commands.find((command) => command.name() === "buildExportTask")?.aliases(),
    ).not.toContain("bet");
  });

  it("resolves operation-style argument aliases", () => {
    expect(resolveOperationAlias("ls", ["list", "get", "update"])).toBe("list");
    expect(resolveOperationAlias("up", ["list", "get", "update"])).toBe("update");
    expect(resolveOperationAlias("aa", ["assign-agent", "remove-agent"])).toBe("assign-agent");
    expect(resolveOperationAlias("unknown", ["list"])).toBe("unknown");
  });

  it("gives every public command a 2-3 character short form", () => {
    const program = buildProgram();
    const missing: string[] = [];

    walkCommands(program, (command, path) => {
      if (path.length === 1) return;
      if (command.name() === "help" || command.name().startsWith("completion")) return;
      if (!hasShortCommandCoverage(command)) missing.push(path.join(" "));
    });

    expect(missing).toEqual([]);
  });

  it("uses dsh as the dashboard short form and keeps db for database", () => {
    const program = buildProgram();

    expect(program.commands.find((command) => command.name() === "db")?.name()).toBe("db");
    expect(
      program.commands.find((command) => command.name() === "dashboards")?.aliases(),
    ).toContain("dsh");
  });
});

function walkCommands(
  command: Command,
  visit: (command: Command, path: string[]) => void,
  path: string[] = [command.name()],
): void {
  visit(command, path);
  for (const child of command.commands) {
    walkCommands(child, visit, [...path, child.name()]);
  }
}
