import { Command } from "commander";
import fs from "fs-extra";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { registerOpenApiCommand } from "../openapi.command";

vi.mock("fs-extra", () => ({
  default: {
    writeFile: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("../../../utilities/shared/services", () => ({
  createServices: vi.fn(),
}));

import { createServices } from "../../../utilities/shared/services";

function createMockServices() {
  return {
    api: {
      request: vi.fn().mockResolvedValue({
        data: { openapi: "3.1.0", info: { title: "Twenty" } },
      }),
      get: vi.fn().mockResolvedValue({ data: { openapi: "3.1.0", info: { title: "Twenty" } } }),
    },
    publicHttp: {
      request: vi.fn(),
    },
    output: {
      render: vi.fn(),
    },
  };
}

describe("openapi command", () => {
  let program: Command;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let mockServices: ReturnType<typeof createMockServices>;

  beforeEach(() => {
    program = new Command();
    program.exitOverride();
    registerOpenApiCommand(program);
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    mockServices = createMockServices();
    vi.mocked(createServices).mockReturnValue(mockServices as any);
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    vi.clearAllMocks();
  });

  it("registers the top-level openapi command", () => {
    const command = program.commands.find((candidate) => candidate.name() === "openapi");

    expect(command).toBeDefined();
    expect(command?.description()).toBe("Fetch OpenAPI discovery schemas");
  });

  it("fetches the core schema by default", async () => {
    await program.parseAsync(["node", "test", "openapi", "core"]);

    expect(mockServices.api.request).toHaveBeenCalledWith({
      method: "get",
      url: "/rest/open-api/core",
    });
    expect(mockServices.api.get).not.toHaveBeenCalled();
    expect(mockServices.publicHttp.request).not.toHaveBeenCalled();
    expect(mockServices.output.render).toHaveBeenCalledWith(
      { openapi: "3.1.0", info: { title: "Twenty" } },
      expect.any(Object),
    );
  });

  it("fetches the metadata schema", async () => {
    await program.parseAsync(["node", "test", "openapi", "metadata"]);

    expect(mockServices.api.request).toHaveBeenCalledWith({
      method: "get",
      url: "/rest/open-api/metadata",
    });
    expect(mockServices.api.get).not.toHaveBeenCalled();
    expect(mockServices.publicHttp.request).not.toHaveBeenCalled();
  });

  it("writes the schema to a file when requested", async () => {
    await program.parseAsync([
      "node",
      "test",
      "openapi",
      "core",
      "--output-file",
      "/tmp/core-openapi.json",
    ]);

    expect(fs.writeFile).toHaveBeenCalledWith(
      "/tmp/core-openapi.json",
      JSON.stringify({ openapi: "3.1.0", info: { title: "Twenty" } }, null, 2),
    );
    expect(consoleErrorSpy).toHaveBeenCalledWith("Wrote OpenAPI schema to /tmp/core-openapi.json");
  });

  it("rejects unsupported schema targets", async () => {
    await expect(program.parseAsync(["node", "test", "openapi", "unknown"])).rejects.toThrow(
      "Unknown OpenAPI schema target",
    );
  });
});
