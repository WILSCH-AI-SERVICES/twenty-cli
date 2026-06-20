import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CliError } from "../../../utilities/errors/cli-error";
import { registerRoutesCommand } from "../routes.command";

const mockCreateCommandContext = vi.hoisted(() => vi.fn());
const mockPublicHttpRequest = vi.hoisted(() => vi.fn());
const mockOutputRender = vi.hoisted(() => vi.fn());

vi.mock("../../../utilities/shared/context", async () => {
  const actual = await vi.importActual<typeof import("../../../utilities/shared/context")>(
    "../../../utilities/shared/context",
  );

  return {
    ...actual,
    createCommandContext: mockCreateCommandContext,
  };
});

function mockSharedCommandContext() {
  mockCreateCommandContext.mockReturnValue({
    globalOptions: {
      output: "json",
      query: undefined,
      debug: false,
      noRetry: false,
      workspace: "default",
    },
    services: {
      publicHttp: {
        request: mockPublicHttpRequest,
      },
      output: {
        render: mockOutputRender,
      },
    },
  } as never);
}

describe("routes command", () => {
  let program: Command;

  beforeEach(() => {
    program = new Command();
    program.exitOverride();
    registerRoutesCommand(program);
    mockCreateCommandContext.mockReset();
    mockPublicHttpRequest.mockReset();
    mockOutputRender.mockReset();
    mockSharedCommandContext();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("command registration", () => {
    it("registers routes root command", () => {
      const routesCmd = program.commands.find((candidate) => candidate.name() === "routes");

      expect(routesCmd).toBeDefined();
      expect(routesCmd?.description()).toBe("Invoke public route trigger endpoints");
    });

    it("registers invoke subcommand with required path", () => {
      const routesCmd = program.commands.find((candidate) => candidate.name() === "routes");
      const invokeCmd = routesCmd?.commands.find((candidate) => candidate.name() === "invoke");
      const args = invokeCmd?.registeredArguments ?? [];

      expect(invokeCmd).toBeDefined();
      expect(invokeCmd?.description()).toBe("Invoke a public /s/* route endpoint");
      expect(args.length).toBe(1);
      expect(args[0].name()).toBe("routePath");
      expect(args[0].required).toBe(true);
    });

    it("registers route invocation options and global options", () => {
      const routesCmd = program.commands.find((candidate) => candidate.name() === "routes");
      const invokeCmd = routesCmd?.commands.find((candidate) => candidate.name() === "invoke");
      const options = invokeCmd?.options ?? [];

      expect(options.find((option) => option.long === "--method")).toBeDefined();
      expect(options.find((option) => option.long === "--data")).toBeDefined();
      expect(options.find((option) => option.long === "--file")).toBeDefined();
      expect(options.find((option) => option.long === "--param")).toBeDefined();
      expect(options.find((option) => option.long === "--header")).toBeDefined();
      expect(options.find((option) => option.long === "--output")).toBeDefined();
      expect(options.find((option) => option.long === "--query")).toBeDefined();
      expect(options.find((option) => option.long === "--workspace")).toBeDefined();
    });
  });

  describe("invoke", () => {
    it("invokes a route through shared public transport with GET by default", async () => {
      mockPublicHttpRequest.mockResolvedValue({
        data: {
          ok: true,
          source: "route",
        },
      } as never);

      await program.parseAsync([
        "node",
        "test",
        "routes",
        "invoke",
        "contacts/sync",
        "--param",
        "source=cli",
        "--param",
        "dryRun=true",
        "-o",
        "json",
        "--full",
      ]);

      expect(mockCreateCommandContext).toHaveBeenCalled();
      expect(mockPublicHttpRequest).toHaveBeenCalledWith({
        authMode: "optional",
        method: "get",
        path: "/s/contacts/sync",
        params: {
          source: "cli",
          dryRun: "true",
        },
        data: undefined,
      });

      expect(mockOutputRender).toHaveBeenCalledWith(
        {
          ok: true,
          source: "route",
        },
        {
          format: "json",
          query: undefined,
        },
      );
    });

    it("passes debug and no-retry through shared transport context", async () => {
      mockPublicHttpRequest.mockResolvedValue({
        data: {
          ok: true,
        },
      } as never);

      await program.parseAsync([
        "node",
        "test",
        "routes",
        "invoke",
        "public/ping",
        "--debug",
        "--no-retry",
        "-o",
        "json",
        "--full",
      ]);

      expect(mockCreateCommandContext).toHaveBeenCalledTimes(1);
      expect(mockCreateCommandContext.mock.calls[0][0].opts()).toMatchObject({
        debug: true,
        retry: false,
      });
    });

    it("invokes a route with a request body and custom headers through shared transport", async () => {
      mockPublicHttpRequest.mockResolvedValue({
        data: {
          created: true,
        },
      } as never);

      await program.parseAsync([
        "node",
        "test",
        "routes",
        "invoke",
        "/s/hooks/import",
        "--method",
        "post",
        "-d",
        '{"batch":"one"}',
        "--header",
        "x-source=cli",
        "--header",
        "x-trace-id=trace-1",
        "-o",
        "json",
        "--full",
      ]);

      expect(mockPublicHttpRequest).toHaveBeenCalledWith({
        authMode: "optional",
        method: "post",
        path: "/s/hooks/import",
        data: {
          batch: "one",
        },
        params: undefined,
        headers: {
          "x-source": "cli",
          "x-trace-id": "trace-1",
        },
      });
    });

    it("omits the authorization header when no api key is configured", async () => {
      mockPublicHttpRequest.mockResolvedValue({
        data: {
          ok: true,
        },
      } as never);

      await program.parseAsync([
        "node",
        "test",
        "routes",
        "invoke",
        "public/ping",
        "-o",
        "json",
        "--full",
      ]);

      expect(mockPublicHttpRequest).toHaveBeenCalledWith({
        authMode: "optional",
        method: "get",
        path: "/s/public/ping",
        data: undefined,
        params: undefined,
        headers: undefined,
      });
    });

    it("throws when GET is used with a request body", async () => {
      await expect(
        program.parseAsync([
          "node",
          "test",
          "routes",
          "invoke",
          "public/ping",
          "--method",
          "get",
          "-d",
          '{"hello":"world"}',
        ]),
      ).rejects.toThrow(CliError);
    });

    it("throws when the request body is not a json object", async () => {
      await expect(
        program.parseAsync([
          "node",
          "test",
          "routes",
          "invoke",
          "hooks/import",
          "--method",
          "post",
          "-d",
          '["bad"]',
        ]),
      ).rejects.toThrow(CliError);
    });

    it("throws for unsupported methods", async () => {
      await expect(
        program.parseAsync([
          "node",
          "test",
          "routes",
          "invoke",
          "public/ping",
          "--method",
          "options",
        ]),
      ).rejects.toThrow(CliError);
    });
  });
});
