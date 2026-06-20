import { Command } from "commander";
import fs from "fs-extra";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { buildProgram } from "../../../program";
import { CliError } from "../../../utilities/errors/cli-error";

// Mock fs-extra
vi.mock("fs-extra", () => ({
  default: {
    writeFile: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn().mockResolvedValue("query { people { id } }"),
  },
}));

// Mock the services module
vi.mock("../../../utilities/shared/services", () => ({
  createServices: vi.fn(),
}));

// Mock the io utility
vi.mock("../../../utilities/shared/io", () => ({
  readFileOrStdin: vi.fn(),
  readJsonInput: vi.fn(),
}));

import { readFileOrStdin, readJsonInput } from "../../../utilities/shared/io";
import { createServices } from "../../../utilities/shared/services";

function createMockServices() {
  return {
    api: {
      post: vi.fn().mockResolvedValue({ data: { data: { people: [] } } }),
    },
    output: {
      render: vi.fn(),
    },
  };
}

describe("graphql command", () => {
  let program: Command;
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let mockServices: ReturnType<typeof createMockServices>;

  beforeEach(() => {
    program = buildProgram();
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    mockServices = createMockServices();
    vi.mocked(createServices).mockReturnValue(mockServices as any);
    vi.mocked(readFileOrStdin).mockResolvedValue("query { people { id } }");
    vi.mocked(readJsonInput).mockResolvedValue(undefined);
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    vi.clearAllMocks();
  });

  describe("query operation", () => {
    it("executes query with --document option", async () => {
      await program.parseAsync([
        "node",
        "test",
        "raw",
        "graphql",
        "query",
        "--document",
        "query { people { id name } }",
      ]);

      expect(mockServices.api.post).toHaveBeenCalledWith("/graphql", {
        query: "query { people { id name } }",
      });
      expect(mockServices.output.render).toHaveBeenCalled();
    });

    it("executes query with -d alias for document input", async () => {
      await program.parseAsync([
        "node",
        "test",
        "raw",
        "graphql",
        "query",
        "-d",
        "query { people { id name } }",
      ]);

      expect(mockServices.api.post).toHaveBeenCalledWith("/graphql", {
        query: "query { people { id name } }",
      });
    });

    it("executes query from file", async () => {
      vi.mocked(readFileOrStdin).mockResolvedValue("query { companies { id } }");

      await program.parseAsync([
        "node",
        "test",
        "raw",
        "graphql",
        "query",
        "--file",
        "/path/to/query.graphql",
      ]);

      expect(readFileOrStdin).toHaveBeenCalledWith("/path/to/query.graphql");
      expect(mockServices.api.post).toHaveBeenCalledWith("/graphql", {
        query: "query { companies { id } }",
      });
    });

    it("throws error when query is missing", async () => {
      vi.mocked(readFileOrStdin).mockResolvedValue("");

      await expect(program.parseAsync(["node", "test", "raw", "graphql", "query"])).rejects.toThrow(
        CliError,
      );
    });
  });

  describe("mutation operation", () => {
    it("executes mutation with --document option", async () => {
      await program.parseAsync([
        "node",
        "test",
        "raw",
        "graphql",
        "mutate",
        "--document",
        'mutation { createPerson(name: "John") { id } }',
      ]);

      expect(mockServices.api.post).toHaveBeenCalledWith("/graphql", {
        query: 'mutation { createPerson(name: "John") { id } }',
      });
    });

    it("executes mutation case insensitively", async () => {
      await program.parseAsync([
        "node",
        "test",
        "raw",
        "graphql",
        "MUTATE",
        "--document",
        "mutation { updatePerson { id } }",
      ]);

      expect(mockServices.api.post).toHaveBeenCalled();
    });
  });

  describe("schema operation", () => {
    it("fetches schema with introspection query", async () => {
      await program.parseAsync(["node", "test", "raw", "graphql", "schema"]);

      expect(mockServices.api.post).toHaveBeenCalledWith(
        "/graphql",
        expect.objectContaining({
          query: expect.stringContaining("IntrospectionQuery"),
        }),
      );
    });

    it("writes schema to output file", async () => {
      const schemaData = { data: { __schema: { types: [] } } };
      mockServices.api.post.mockResolvedValue({ data: schemaData });

      await program.parseAsync([
        "node",
        "test",
        "raw",
        "graphql",
        "schema",
        "--output-file",
        "/path/to/schema.json",
      ]);

      expect(fs.writeFile).toHaveBeenCalledWith(
        "/path/to/schema.json",
        JSON.stringify(schemaData, null, 2),
      );
      expect(consoleErrorSpy).toHaveBeenCalledWith("Wrote schema output to /path/to/schema.json");
    });

    it("handles schema operation case insensitively", async () => {
      await program.parseAsync(["node", "test", "raw", "graphql", "SCHEMA"]);

      expect(mockServices.api.post).toHaveBeenCalled();
    });
  });

  describe("variables handling", () => {
    it("includes variables in request payload", async () => {
      vi.mocked(readJsonInput).mockResolvedValue({ id: "123" });

      await program.parseAsync([
        "node",
        "test",
        "raw",
        "graphql",
        "query",
        "--document",
        "query GetPerson($id: ID!) { person(id: $id) { name } }",
        "--variables",
        '{"id":"123"}',
      ]);

      expect(mockServices.api.post).toHaveBeenCalledWith("/graphql", {
        query: "query GetPerson($id: ID!) { person(id: $id) { name } }",
        variables: { id: "123" },
      });
    });

    it("loads variables from file", async () => {
      vi.mocked(readJsonInput).mockResolvedValue({ filter: { name: "John" } });

      await program.parseAsync([
        "node",
        "test",
        "raw",
        "graphql",
        "query",
        "--document",
        "query ($filter: Filter) { people(filter: $filter) { id } }",
        "--variables-file",
        "/path/to/vars.json",
      ]);

      expect(mockServices.api.post).toHaveBeenCalledWith(
        "/graphql",
        expect.objectContaining({
          variables: { filter: { name: "John" } },
        }),
      );
    });

    it("omits variables when empty object", async () => {
      vi.mocked(readJsonInput).mockResolvedValue({});

      await program.parseAsync([
        "node",
        "test",
        "raw",
        "graphql",
        "query",
        "--document",
        "query { people { id } }",
        "--variables",
        "{}",
      ]);

      expect(mockServices.api.post).toHaveBeenCalledWith("/graphql", {
        query: "query { people { id } }",
      });
    });

    it("throws error when variables are not an object", async () => {
      vi.mocked(readJsonInput).mockResolvedValue(["not", "an", "object"]);

      await expect(
        program.parseAsync([
          "node",
          "test",
          "raw",
          "graphql",
          "query",
          "--document",
          "query { people { id } }",
          "--variables",
          '["not","an","object"]',
        ]),
      ).rejects.toThrow(CliError);
    });

    it.each([
      { label: "false", value: false },
      { label: "0", value: 0 },
      { label: '""', value: "" },
      { label: "null", value: null },
    ])("rejects $label as invalid variables", async ({ value }) => {
      vi.mocked(readJsonInput).mockResolvedValue(value as never);

      await expect(
        program.parseAsync([
          "node",
          "test",
          "raw",
          "graphql",
          "query",
          "--document",
          "query { people { id } }",
          "--variables",
          JSON.stringify(value),
        ]),
      ).rejects.toThrow(CliError);
    });
  });

  describe("operation name", () => {
    it("includes operation name in request payload", async () => {
      await program.parseAsync([
        "node",
        "test",
        "raw",
        "graphql",
        "query",
        "--document",
        "query GetPeople { people { id } } query GetCompanies { companies { id } }",
        "--operation-name",
        "GetPeople",
      ]);

      expect(mockServices.api.post).toHaveBeenCalledWith(
        "/graphql",
        expect.objectContaining({
          operationName: "GetPeople",
        }),
      );
    });
  });

  describe("custom endpoint", () => {
    it("uses custom endpoint path", async () => {
      await program.parseAsync([
        "node",
        "test",
        "raw",
        "graphql",
        "query",
        "--document",
        "query { people { id } }",
        "--endpoint",
        "/api/graphql",
      ]);

      expect(mockServices.api.post).toHaveBeenCalledWith("/api/graphql", expect.any(Object));
    });

    it("normalizes endpoint without leading slash", async () => {
      await program.parseAsync([
        "node",
        "test",
        "raw",
        "graphql",
        "query",
        "--document",
        "query { people { id } }",
        "--endpoint",
        "custom-graphql",
      ]);

      expect(mockServices.api.post).toHaveBeenCalledWith("/custom-graphql", expect.any(Object));
    });
  });

  describe("output options", () => {
    it("passes output format to render", async () => {
      await program.parseAsync([
        "node",
        "test",
        "raw",
        "graphql",
        "query",
        "--document",
        "query { people { id } }",
        "-o",
        "json",
        "--full",
      ]);

      expect(mockServices.output.render).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ format: "json" }),
      );
    });

    it("passes output query filter to render", async () => {
      await program.parseAsync([
        "node",
        "test",
        "raw",
        "graphql",
        "query",
        "--document",
        "query { people { id } }",
        "--query",
        "data.people[0]",
      ]);

      expect(mockServices.output.render).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ query: "data.people[0]" }),
      );
    });
  });

  describe("error handling", () => {
    it("throws error for unknown operation", async () => {
      await expect(
        program.parseAsync([
          "node",
          "test",
          "raw",
          "graphql",
          "unknown",
          "--query",
          "query { people { id } }",
        ]),
      ).rejects.toThrow(CliError);
    });

    it("propagates API errors", async () => {
      mockServices.api.post.mockRejectedValue(new Error("GraphQL error"));

      await expect(
        program.parseAsync([
          "node",
          "test",
          "raw",
          "graphql",
          "query",
          "--document",
          "query { people { id } }",
        ]),
      ).rejects.toThrow("GraphQL error");
    });
  });

  describe("file input", () => {
    it("reads query from stdin when file is -", async () => {
      vi.mocked(readFileOrStdin).mockResolvedValue("query { notes { id } }");

      await program.parseAsync(["node", "test", "raw", "graphql", "query", "--file", "-"]);

      expect(readFileOrStdin).toHaveBeenCalledWith("-");
      expect(mockServices.api.post).toHaveBeenCalledWith("/graphql", {
        query: "query { notes { id } }",
      });
    });

    it("rejects whitespace-only file content", async () => {
      vi.mocked(readFileOrStdin).mockResolvedValue("   \n\t  ");

      await expect(
        program.parseAsync(["node", "test", "raw", "graphql", "query", "--file", "/tmp/doc.gql"]),
      ).rejects.toThrow(CliError);
    });

    it("rejects whitespace-only document input", async () => {
      await expect(
        program.parseAsync(["node", "test", "raw", "graphql", "query", "--document", "   \n\t  "]),
      ).rejects.toThrow(CliError);
    });

    it("trims whitespace from file content", async () => {
      vi.mocked(readFileOrStdin).mockResolvedValue("\n  query { people { id } }  \n");

      await program.parseAsync([
        "node",
        "test",
        "raw",
        "graphql",
        "query",
        "--file",
        "/path/to/query.graphql",
      ]);

      expect(mockServices.api.post).toHaveBeenCalledWith("/graphql", {
        query: "query { people { id } }",
      });
    });
  });
});
