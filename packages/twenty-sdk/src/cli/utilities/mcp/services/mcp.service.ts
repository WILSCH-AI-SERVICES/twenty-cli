import { CLI_VERSION } from "../../../version";
import { ApiService } from "../../api/services/api.service";
import { ConfigService } from "../../config/services/config.service";
import { CliError, errorWithCause } from "../../errors/cli-error";
import { stringifyDebugPreview } from "../../shared/debug-redaction";
import { JsonRpcFailure, JsonRpcRequest, JsonRpcSuccess, McpStatusResult } from "../types";

interface McpServiceOptions {
  workspace?: string;
  debug?: boolean;
}

type JsonRpcResponse<TResult = unknown> = JsonRpcSuccess<TResult> | JsonRpcFailure;

class McpResponseError extends Error {
  constructor(
    public readonly envelope: JsonRpcFailure,
    public readonly endpoint: string,
  ) {
    super(envelope.error.message);
    this.name = "McpResponseError";
  }
}

export class McpService {
  private initialized = false;
  private endpointPromise?: Promise<string>;
  private requestCounter = 0;

  constructor(
    private readonly api: ApiService,
    private readonly configService: ConfigService,
    private readonly options: McpServiceOptions = {},
    private readonly endpointPath = "/mcp",
  ) {}

  async initialize(): Promise<
    JsonRpcSuccess<{ protocolVersion: string; serverInfo?: { name?: string; version?: string } }>
  > {
    const response = await this.postJsonRpc<{
      protocolVersion: string;
      serverInfo?: { name?: string; version?: string };
    }>("initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "twenty-cli", version: CLI_VERSION },
    });

    this.initialized = true;
    return response;
  }

  async status(): Promise<McpStatusResult> {
    const endpoint = await this.resolveEndpoint();

    try {
      const response = await this.initialize();
      return {
        endpoint,
        authMode: "api-key",
        reachable: true,
        available: true,
        state: "ok",
        protocolVersion: response.result.protocolVersion ?? response.protocolVersion,
        serverInfo: response.result.serverInfo ?? response.serverInfo,
      };
    } catch (error) {
      const statusResult = this.toStatusResult(error, endpoint);
      if (statusResult) {
        return statusResult;
      }

      if (error instanceof McpResponseError) {
        throw this.toCliErrorFromMcpResponse(error, "initialize");
      }

      throw error;
    }
  }

  async listTools(): Promise<unknown> {
    await this.ensureInitialized();
    const response = await this.postJsonRpc("tools/list", {});
    return response.result;
  }

  async callTool(name: string, args: Record<string, unknown> = {}): Promise<unknown> {
    await this.ensureInitialized();
    this.debugLog(`MCP tool name: ${name}`);
    const response = await this.postJsonRpc("tools/call", {
      name,
      arguments: args,
    });
    return this.normalizeToolCallResult(response.result);
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      await this.initialize();
    } catch (error) {
      if (error instanceof McpResponseError) {
        throw this.toCliErrorFromMcpResponse(error, "initialize");
      }

      throw error;
    }
  }

  private async postJsonRpc<TResult>(
    method: string,
    params?: unknown,
  ): Promise<JsonRpcSuccess<TResult>> {
    const endpoint = await this.resolveEndpoint();
    const request = this.createRequest(method, params);
    this.debugLog(`MCP request envelope: ${stringifyDebugPreview(request)}`);

    try {
      const response = await this.api.post<JsonRpcResponse<TResult>>(endpoint, request);
      const data = response.data;
      this.debugLog(`MCP response envelope: ${stringifyDebugPreview(data)}`);

      if (this.isJsonRpcFailure(data)) {
        throw new McpResponseError(data, endpoint);
      }

      if (!this.isJsonRpcSuccess<TResult>(data)) {
        throw errorWithCause("Unexpected MCP response.", "NETWORK");
      }

      if (method === "initialize") {
        this.initialized = true;
      }

      return data;
    } catch (error) {
      if (error instanceof McpResponseError) {
        throw error;
      }

      if (error instanceof CliError) {
        throw error;
      }

      throw this.toCliErrorFromTransport(error, method);
    }
  }

  private async resolveEndpoint(): Promise<string> {
    if (!this.endpointPromise) {
      this.endpointPromise = this.configService
        .getConfig({ workspace: this.options.workspace })
        .then((config) => {
          const endpoint = new URL(this.endpointPath, config.apiUrl).toString();
          this.debugLog(`MCP endpoint resolved: ${endpoint}`);
          return endpoint;
        });
    }

    return this.endpointPromise;
  }

  private createRequest(method: string, params?: unknown): JsonRpcRequest {
    const request: JsonRpcRequest = {
      jsonrpc: "2.0",
      id: this.nextRequestId(),
      method,
    };

    if (params !== undefined) {
      request.params = params;
    }

    return request;
  }

  private nextRequestId(): string {
    const id = `mcp-${Date.now()}-${this.requestCounter}`;
    this.requestCounter += 1;
    return id;
  }

  private toCliErrorFromMcpResponse(error: McpResponseError, operation: string): CliError {
    const mapped = this.toCliErrorFromEnvelope(error.envelope, operation, error);
    if (mapped) {
      return mapped;
    }

    return errorWithCause(`Unexpected MCP ${operation} failure.`, "NETWORK", undefined, error);
  }

  private toCliErrorFromTransport(error: unknown, operation: string): CliError {
    const envelope = this.extractMcpFailureEnvelope(error);
    if (envelope) {
      const mapped = this.toCliErrorFromEnvelope(envelope, operation, error);
      if (mapped) {
        return mapped;
      }
    }

    const status = this.getHttpStatus(error);

    if (status === 429) {
      return errorWithCause(`MCP ${operation} rate limited.`, "RATE_LIMIT", undefined, error);
    }

    if (status === 401 || status === 403) {
      return errorWithCause(`MCP ${operation} requires authorization.`, "AUTH", undefined, error);
    }

    if (!status) {
      return errorWithCause(
        `Network error while calling MCP ${operation}.`,
        "NETWORK",
        undefined,
        error,
      );
    }

    return errorWithCause(
      `MCP ${operation} failed with status ${status}.`,
      "NETWORK",
      undefined,
      error,
    );
  }

  private toCliErrorFromEnvelope(
    envelope: JsonRpcFailure,
    operation: string,
    cause: unknown,
  ): CliError | null {
    const code = envelope.error.code;

    if (code === 429) {
      return errorWithCause(`MCP ${operation} rate limited.`, "RATE_LIMIT", undefined, cause);
    }

    if (this.isFeatureDisabled(envelope)) {
      return errorWithCause(
        `MCP ${operation} is unavailable because ${envelope.error.message}.`,
        "AUTH",
        undefined,
        cause,
      );
    }

    if (code === 401 || this.isUnauthorizedMessage(envelope.error.message)) {
      return errorWithCause(`MCP ${operation} requires authorization.`, "AUTH", undefined, cause);
    }

    if (code === 403 || this.isForbiddenMessage(envelope.error.message)) {
      return errorWithCause(`MCP ${operation} requires authorization.`, "AUTH", undefined, cause);
    }

    return null;
  }

  private toStatusResult(error: unknown, endpoint: string): McpStatusResult | null {
    const envelope = this.extractMcpFailureEnvelope(error);
    if (envelope) {
      const base = {
        endpoint,
        authMode: "api-key" as const,
        reachable: true,
        available: false,
        protocolVersion: envelope.protocolVersion,
        serverInfo: envelope.serverInfo,
        message: envelope.error.message,
      };

      if (this.isFeatureDisabled(envelope)) {
        return { ...base, state: "ai_feature_disabled" };
      }

      if (envelope.error.code === 401 || this.isUnauthorizedMessage(envelope.error.message)) {
        return { ...base, state: "unauthorized" };
      }

      if (envelope.error.code === 403 || this.isForbiddenMessage(envelope.error.message)) {
        return { ...base, state: "forbidden" };
      }
    }

    const status = this.getHttpStatus(error);
    if (status === 401) {
      return {
        endpoint,
        authMode: "api-key",
        reachable: true,
        available: false,
        state: "unauthorized",
      };
    }

    if (status === 403) {
      return {
        endpoint,
        authMode: "api-key",
        reachable: true,
        available: false,
        state: "forbidden",
      };
    }

    return null;
  }

  private extractMcpFailureEnvelope(error: unknown): JsonRpcFailure | null {
    if (error instanceof McpResponseError) {
      return error.envelope;
    }

    if (typeof error === "object" && error !== null) {
      const response = (error as { response?: { data?: unknown } }).response;
      if (this.isJsonRpcFailure(response?.data)) {
        return response.data;
      }

      const data = (error as { data?: unknown }).data;
      if (this.isJsonRpcFailure(data)) {
        return data;
      }
    }

    const cause = error instanceof CliError ? (error as { cause?: unknown }).cause : undefined;
    if (cause && typeof cause === "object" && cause !== null) {
      const response = (cause as { response?: { data?: unknown } }).response;
      if (this.isJsonRpcFailure(response?.data)) {
        return response.data;
      }

      const data = (cause as { data?: unknown }).data;
      if (this.isJsonRpcFailure(data)) {
        return data;
      }
    }

    return null;
  }

  private normalizeToolCallResult(result: unknown): unknown {
    if (!this.isToolCallResult(result)) {
      return result;
    }

    const normalizedContent = result.content.map((item) => {
      if (item?.type !== "text" || typeof item.text !== "string") {
        return item;
      }

      return this.parseMaybeJson(item.text);
    });

    if (normalizedContent.length === 1) {
      return normalizedContent[0];
    }

    return normalizedContent;
  }

  private parseMaybeJson(text: string): unknown {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  private isJsonRpcSuccess<TResult>(value: unknown): value is JsonRpcSuccess<TResult> {
    return (
      typeof value === "object" &&
      value !== null &&
      (value as JsonRpcSuccess<TResult>).jsonrpc === "2.0" &&
      "result" in value
    );
  }

  private isJsonRpcFailure(value: unknown): value is JsonRpcFailure {
    return (
      typeof value === "object" &&
      value !== null &&
      (value as JsonRpcFailure).jsonrpc === "2.0" &&
      "error" in value
    );
  }

  private isToolCallResult(
    value: unknown,
  ): value is { content: Array<{ type?: string; text?: string; [key: string]: unknown }> } {
    return (
      typeof value === "object" &&
      value !== null &&
      "content" in value &&
      Array.isArray((value as { content?: unknown }).content)
    );
  }

  private isFeatureDisabled(envelope: JsonRpcFailure): boolean {
    return /ai feature is not enabled/i.test(envelope.error.message);
  }

  private isUnauthorizedMessage(message: string): boolean {
    return /unauthoriz/i.test(message);
  }

  private isForbiddenMessage(message: string): boolean {
    return /forbidden/i.test(message);
  }

  private getHttpStatus(error: unknown): number | undefined {
    if (typeof error !== "object" || error === null) {
      return undefined;
    }

    const directResponse = (error as { response?: { status?: number } }).response;
    if (directResponse?.status) {
      return directResponse.status;
    }

    const cause = error instanceof CliError ? (error as { cause?: unknown }).cause : undefined;
    if (cause && typeof cause === "object" && cause !== null) {
      const causeResponse = (cause as { response?: { status?: number } }).response;
      if (causeResponse?.status) {
        return causeResponse.status;
      }
    }

    const response = directResponse;
    return response?.status;
  }

  private debugLog(message: string): void {
    if (!this.options.debug) {
      return;
    }

    // eslint-disable-next-line no-console
    console.error(message);
  }
}
