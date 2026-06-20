export interface JsonRpcRequest<TParams = unknown> {
  jsonrpc: "2.0";
  id: string;
  method: string;
  params?: TParams;
}

export interface JsonRpcSuccess<TResult = unknown> {
  jsonrpc: "2.0";
  id: string | number;
  result: TResult;
  protocolVersion?: string;
  serverInfo?: { name?: string; version?: string };
}

export interface JsonRpcFailure {
  jsonrpc: "2.0";
  id: string | number;
  error: { code: number; message: string; metadata?: Record<string, unknown> };
  protocolVersion?: string;
  serverInfo?: { name?: string; version?: string };
}

export interface McpStatusResult {
  endpoint: string;
  authMode: "api-key";
  reachable: boolean;
  available: boolean;
  state: "ok" | "ai_feature_disabled" | "unauthorized" | "forbidden";
  protocolVersion?: string;
  serverInfo?: { name?: string; version?: string };
  message?: string;
}
