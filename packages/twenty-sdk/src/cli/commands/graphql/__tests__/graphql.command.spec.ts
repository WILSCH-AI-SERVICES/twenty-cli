import { Command } from "commander";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { buildProgram } from "../../../program";
import { CliError } from "../../../utilities/errors/cli-error";

vi.mock("../../../utilities/shared/services", () => ({
  createServices: vi.fn(),
}));

vi.mock("../../../utilities/shared/io", () => ({
  readJsonInput: vi.fn(),
}));

import { readJsonInput } from "../../../utilities/shared/io";
import { createServices } from "../../../utilities/shared/services";

function createMockServices() {
  return {
    api: {
      post: vi.fn().mockResolvedValue({ data: { data: { currentUser: { id: "user-1" } } } }),
    },
    output: {
      render: vi.fn(),
    },
  };
}

describe("graphql command", () => {
  let program: Command;
  let mockServices: ReturnType<typeof createMockServices>;

  beforeEach(() => {
    program = buildProgram();
    mockServices = createMockServices();
    vi.mocked(createServices).mockReturnValue(mockServices as any);
    vi.mocked(readJsonInput).mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("registers top-level dynamic GraphQL operation execution", () => {
    const graphql = program.commands.find((command) => command.name() === "graphql");

    expect(graphql).toBeDefined();
    expect(graphql?.description()).toBe("Execute a GraphQL operation by field name");
    expect(graphql?.registeredArguments.map((argument) => argument.name())).toEqual(["operation"]);
    expect(graphql?.options.map((option) => option.long)).toEqual(
      expect.arrayContaining([
        "--kind",
        "--args",
        "--variable-defs",
        "--variables",
        "--variables-file",
        "--selection",
        "--endpoint",
        "--output",
        "--query",
      ]),
    );
  });

  it("executes a query operation and renders the selected field result", async () => {
    const currentUser = { id: "user-1", email: "user@example.test" };
    mockServices.api.post.mockResolvedValue({ data: { data: { currentUser } } });

    await program.parseAsync([
      "node",
      "test",
      "graphql",
      "currentUser",
      "--selection",
      "id email",
      "-o",
      "json",
      "--full",
    ]);

    expect(mockServices.api.post).toHaveBeenCalledWith("/graphql", {
      query: "query CliCurrentUser { currentUser { id email } }",
    });
    expect(mockServices.output.render).toHaveBeenCalledWith(currentUser, {
      format: "json",
      query: undefined,
    });
  });

  it("executes a mutation operation with variable definitions, field args, and variables", async () => {
    const updateWorkspace = { id: "workspace-1", displayName: "Acme" };
    vi.mocked(readJsonInput).mockResolvedValue({ input: { displayName: "Acme" } });
    mockServices.api.post.mockResolvedValue({ data: { data: { updateWorkspace } } });

    await program.parseAsync([
      "node",
      "test",
      "graphql",
      "updateWorkspace",
      "--kind",
      "mutation",
      "--variable-defs",
      "$input: UpdateWorkspaceInput!",
      "--args",
      "input: $input",
      "--variables",
      '{"input":{"displayName":"Acme"}}',
      "--selection",
      "id displayName",
    ]);

    expect(readJsonInput).toHaveBeenCalledWith('{"input":{"displayName":"Acme"}}', undefined);
    expect(mockServices.api.post).toHaveBeenCalledWith("/graphql", {
      query:
        "mutation CliUpdateWorkspace($input: UpdateWorkspaceInput!) { updateWorkspace(input: $input) { id displayName } }",
      variables: { input: { displayName: "Acme" } },
    });
    expect(mockServices.output.render).toHaveBeenCalledWith(updateWorkspace, {
      format: "json",
      query: undefined,
    });
  });

  it("executes scalar operations without a selection set", async () => {
    mockServices.api.post.mockResolvedValue({ data: { data: { checkUserExists: true } } });

    await program.parseAsync([
      "node",
      "test",
      "graphql",
      "checkUserExists",
      "--args",
      'email: "user@example.test"',
    ]);

    expect(mockServices.api.post).toHaveBeenCalledWith("/graphql", {
      query: 'query CliCheckUserExists { checkUserExists(email: "user@example.test") }',
    });
    expect(mockServices.output.render).toHaveBeenCalledWith(true, {
      format: "json",
      query: undefined,
    });
  });

  it("normalizes custom GraphQL endpoint paths", async () => {
    await program.parseAsync([
      "node",
      "test",
      "graphql",
      "currentUser",
      "--endpoint",
      "metadata",
      "--selection",
      "id",
    ]);

    expect(mockServices.api.post).toHaveBeenCalledWith("/metadata", expect.any(Object));
  });

  it("rejects invalid GraphQL operation names", async () => {
    await expect(program.parseAsync(["node", "test", "graphql", "not-valid!"])).rejects.toThrow(
      CliError,
    );
  });

  it("rejects invalid GraphQL operation kinds", async () => {
    await expect(
      program.parseAsync(["node", "test", "graphql", "currentUser", "--kind", "subscription"]),
    ).rejects.toThrow(CliError);
  });

  it("rejects non-object variables", async () => {
    vi.mocked(readJsonInput).mockResolvedValue(["invalid"]);

    await expect(
      program.parseAsync(["node", "test", "graphql", "currentUser", "--variables", "[]"]),
    ).rejects.toThrow(CliError);
  });
});
