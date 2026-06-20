import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CLI_VERSION } from "../../../../version";
import { McpService } from "../mcp.service";

describe("McpService", () => {
  let api: {
    post: ReturnType<typeof vi.fn>;
  };
  let configService: {
    getConfig: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();

    api = {
      post: vi.fn(),
    };

    configService = {
      getConfig: vi.fn().mockResolvedValue({
        apiUrl: "https://api.twenty.com",
        apiKey: "test-api-key",
        workspace: "default",
      }),
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sends initialize as a JSON-RPC request to /mcp", async () => {
    api.post.mockResolvedValue({
      data: {
        jsonrpc: "2.0",
        id: "1",
        result: {
          protocolVersion: "2025-03-26",
          serverInfo: { name: "Twenty MCP Server", version: "0.1.0" },
        },
      },
    });

    const service = new McpService(api as any, configService as any);

    await service.initialize();

    expect(api.post).toHaveBeenCalledWith(
      "https://api.twenty.com/mcp",
      expect.objectContaining({
        jsonrpc: "2.0",
        id: expect.any(String),
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "twenty-cli", version: CLI_VERSION },
        },
      }),
    );
  });

  it("sends tools/list as a JSON-RPC request to /mcp", async () => {
    api.post.mockResolvedValue({
      data: {
        jsonrpc: "2.0",
        id: "1",
        result: { tools: [] },
      },
    });

    const service = new McpService(api as any, configService as any);

    await service.listTools();

    expect(api.post).toHaveBeenNthCalledWith(
      1,
      "https://api.twenty.com/mcp",
      expect.objectContaining({
        jsonrpc: "2.0",
        id: expect.any(String),
        method: "initialize",
      }),
    );
    expect(api.post).toHaveBeenNthCalledWith(
      2,
      "https://api.twenty.com/mcp",
      expect.objectContaining({
        jsonrpc: "2.0",
        id: expect.any(String),
        method: "tools/list",
        params: {},
      }),
    );
  });

  it("sends tools/call as a JSON-RPC request to /mcp", async () => {
    api.post.mockResolvedValue({
      data: {
        jsonrpc: "2.0",
        id: "1",
        result: {
          content: [{ type: "text", text: "plain text" }],
        },
      },
    });

    const service = new McpService(api as any, configService as any);

    await service.callTool("get_tool_catalog", {});

    expect(api.post).toHaveBeenNthCalledWith(
      2,
      "https://api.twenty.com/mcp",
      expect.objectContaining({
        jsonrpc: "2.0",
        id: expect.any(String),
        method: "tools/call",
        params: {
          name: "get_tool_catalog",
          arguments: {},
        },
      }),
    );
  });

  it("initializes before tools/list and tools/call", async () => {
    api.post.mockResolvedValue({
      data: {
        jsonrpc: "2.0",
        id: "1",
        result: {
          content: [{ type: "text", text: "plain text" }],
        },
      },
    });

    const service = new McpService(api as any, configService as any);

    await service.listTools();
    await service.callTool("get_tool_catalog", {});

    expect(api.post).toHaveBeenCalledTimes(3);
    expect(api.post.mock.calls[0][1]).toEqual(expect.objectContaining({ method: "initialize" }));
    expect(api.post.mock.calls[1][1]).toEqual(expect.objectContaining({ method: "tools/list" }));
    expect(api.post.mock.calls[2][1]).toEqual(expect.objectContaining({ method: "tools/call" }));
  });

  it("normalizes a reachable but disabled workspace into a diagnostic status object", async () => {
    api.post.mockResolvedValue({
      data: {
        jsonrpc: "2.0",
        id: "1",
        error: {
          code: 403,
          message: "AI feature is not enabled for this workspace",
        },
        protocolVersion: "2024-11-05",
        serverInfo: { name: "Twenty MCP Server", version: "0.1.0" },
      },
    });

    const service = new McpService(api as any, configService as any);

    const result = await service.status();

    expect(result.state).toBe("ai_feature_disabled");
    expect(result.available).toBe(false);
    expect(result.reachable).toBe(true);
  });

  it("normalizes ai_feature_disabled when HTTP 403 carries a JSON-RPC error body", async () => {
    api.post.mockRejectedValue({
      response: {
        status: 403,
        data: {
          jsonrpc: "2.0",
          id: "1",
          error: {
            code: 403,
            message: "AI feature is not enabled for this workspace",
          },
          protocolVersion: "2024-11-05",
          serverInfo: { name: "Twenty MCP Server", version: "0.1.0" },
        },
      },
      message: "Request failed with status code 403",
    });

    const service = new McpService(api as any, configService as any);

    const result = await service.status();

    expect(result.state).toBe("ai_feature_disabled");
    expect(result.available).toBe(false);
    expect(result.reachable).toBe(true);
    expect(result.protocolVersion).toBe("2024-11-05");
    expect(result.serverInfo).toEqual({ name: "Twenty MCP Server", version: "0.1.0" });
  });

  it("normalizes unauthorized and forbidden status states distinctly", async () => {
    api.post
      .mockResolvedValueOnce({
        data: {
          jsonrpc: "2.0",
          id: "1",
          error: {
            code: 401,
            message: "Unauthorized",
          },
        },
      })
      .mockResolvedValueOnce({
        data: {
          jsonrpc: "2.0",
          id: "2",
          error: {
            code: 403,
            message: "Forbidden",
          },
        },
      });

    const service = new McpService(api as any, configService as any);

    await expect(service.status()).resolves.toMatchObject({ state: "unauthorized" });
    await expect(service.status()).resolves.toMatchObject({ state: "forbidden" });
  });

  it("wraps non-status MCP errors as CliError with AUTH for 403-style failures", async () => {
    api.post.mockResolvedValue({
      data: {
        jsonrpc: "2.0",
        id: "1",
        error: {
          code: 403,
          message: "Forbidden",
        },
      },
    });

    const service = new McpService(api as any, configService as any);

    await expect(service.callTool("get_tool_catalog", {})).rejects.toMatchObject({
      code: "AUTH",
    });
  });

  it("preserves ai_feature_disabled diagnostics for non-status JSON-RPC failures", async () => {
    api.post.mockResolvedValue({
      data: {
        jsonrpc: "2.0",
        id: "1",
        error: {
          code: 403,
          message: "AI feature is not enabled for this workspace",
        },
      },
    });

    const service = new McpService(api as any, configService as any);

    await expect(service.callTool("get_tool_catalog", {})).rejects.toMatchObject({
      code: "AUTH",
      message:
        "MCP initialize is unavailable because AI feature is not enabled for this workspace.",
    });
  });

  it("preserves ai_feature_disabled diagnostics for non-status HTTP 403 failures with JSON-RPC bodies", async () => {
    api.post.mockRejectedValue({
      response: {
        status: 403,
        data: {
          jsonrpc: "2.0",
          id: "1",
          error: {
            code: 403,
            message: "AI feature is not enabled for this workspace",
          },
        },
      },
      message: "Request failed with status code 403",
    });

    const service = new McpService(api as any, configService as any);

    await expect(service.callTool("get_tool_catalog", {})).rejects.toMatchObject({
      code: "AUTH",
      message:
        "MCP initialize is unavailable because AI feature is not enabled for this workspace.",
    });
  });

  it("maps network failures to CliError(code === 'NETWORK')", async () => {
    api.post.mockRejectedValue({
      message: "Network Error",
    });

    const service = new McpService(api as any, configService as any);

    await expect(service.callTool("get_tool_catalog", {})).rejects.toMatchObject({
      code: "NETWORK",
    });
  });

  it("maps 429/rate-limit failures to CliError(code === 'RATE_LIMIT')", async () => {
    api.post.mockRejectedValue({
      response: {
        status: 429,
      },
      message: "Too Many Requests",
    });

    const service = new McpService(api as any, configService as any);

    await expect(service.callTool("get_tool_catalog", {})).rejects.toMatchObject({
      code: "RATE_LIMIT",
    });
  });

  it("parses JSON text returned by tools/call content into structured data", async () => {
    api.post.mockResolvedValue({
      data: {
        jsonrpc: "2.0",
        id: "1",
        result: {
          content: [{ type: "text", text: '{"items":[1,2]}' }],
        },
      },
    });

    const service = new McpService(api as any, configService as any);

    await expect(service.callTool("get_tool_catalog", {})).resolves.toEqual({
      items: [1, 2],
    });
  });

  it("falls back to plain text when tools/call text is not valid JSON", async () => {
    api.post.mockResolvedValue({
      data: {
        jsonrpc: "2.0",
        id: "1",
        result: {
          content: [{ type: "text", text: "plain text" }],
        },
      },
    });

    const service = new McpService(api as any, configService as any);

    await expect(service.callTool("get_tool_catalog", {})).resolves.toBe("plain text");
  });

  it("logs JSON-RPC request and response envelopes when debug is enabled", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    api.post.mockResolvedValue({
      data: {
        jsonrpc: "2.0",
        id: "1",
        result: {
          content: [{ type: "text", text: "plain text" }],
        },
      },
    });

    const service = new McpService(api as any, configService as any, {
      debug: true,
    });

    await service.callTool("get_tool_catalog", {});

    expect(consoleErrorSpy.mock.calls.flat().join(" ")).toContain("MCP endpoint resolved");
    expect(consoleErrorSpy.mock.calls.flat().join(" ")).toContain('"method":"initialize"');
    expect(consoleErrorSpy.mock.calls.flat().join(" ")).toContain('"method":"tools/call"');
    expect(consoleErrorSpy.mock.calls.flat().join(" ")).toContain('"content"');

    consoleErrorSpy.mockRestore();
  });

  it("redacts sensitive values from debug envelopes", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    api.post.mockResolvedValue({
      data: {
        jsonrpc: "2.0",
        id: "1",
        result: {
          content: [{ type: "text", text: JSON.stringify({ apiKey: "response-secret" }) }],
        },
      },
    });

    const service = new McpService(api as any, configService as any, {
      debug: true,
    });

    await service.callTool("get_tool_catalog", {
      name: "visible",
      authToken: "request-secret",
    });

    const logs = consoleErrorSpy.mock.calls.flat().join("\n");
    expect(logs).toContain("visible");
    expect(logs).toContain("[REDACTED]");
    expect(logs).not.toContain("request-secret");
    expect(logs).not.toContain("response-secret");

    consoleErrorSpy.mockRestore();
  });

  it("truncates debug envelope previews instead of logging full JSON bodies", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const longText = "x".repeat(2000);
    const responseEnvelope = {
      jsonrpc: "2.0",
      id: "1",
      result: {
        content: [{ type: "text", text: longText }],
      },
    };

    api.post.mockResolvedValue({
      data: responseEnvelope,
    });

    const service = new McpService(api as any, configService as any, {
      debug: true,
    });

    await service.callTool("get_tool_catalog", { payload: longText });

    const requestLog = consoleErrorSpy.mock.calls
      .map(([message]) => String(message))
      .reverse()
      .find((message) => message.startsWith("MCP request envelope:"));
    const responseLog = consoleErrorSpy.mock.calls
      .map(([message]) => String(message))
      .reverse()
      .find((message) => message.startsWith("MCP response envelope:"));

    expect(requestLog).toBeDefined();
    expect(responseLog).toBeDefined();
    expect(
      consoleErrorSpy.mock.calls
        .map(([message]) => String(message))
        .find((message) => message.includes('"method":"tools/call"')),
    ).toBeDefined();
    expect(requestLog?.slice("MCP request envelope: ".length).length).toBeLessThan(
      JSON.stringify(api.post.mock.calls.find(([, body]) => body.method === "tools/call")?.[1])
        .length,
    );
    expect(responseLog?.slice("MCP response envelope: ".length).length).toBeLessThan(
      JSON.stringify(responseEnvelope).length,
    );

    consoleErrorSpy.mockRestore();
  });
});
