import http from "node:http";
import { AddressInfo } from "node:net";

export interface MockGraphqlRequest {
  pathname: string;
  body: string;
}

export interface MockBinaryRequest {
  method: string;
  path: string;
}

export interface MockServerHandle<TRequest> {
  baseUrl: string;
  requests: TRequest[];
  getOnlyRequest(): TRequest;
  expectRequestCount(count: number): void;
  close(): Promise<void>;
}

const CLOSE_TIMEOUT_MS = 100;

export async function startGraphqlMockServer(
  respond: (body: string) => Record<string, unknown>,
): Promise<MockServerHandle<MockGraphqlRequest>> {
  const requests: MockGraphqlRequest[] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];

    req.on("data", (chunk) => {
      chunks.push(Buffer.from(chunk));
    });

    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf-8");
      requests.push({
        pathname: req.url ?? "",
        body,
      });

      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.setHeader("connection", "close");
      res.end(JSON.stringify(respond(body)));
    });
  });

  await listenOnRandomPort(server);
  const { port } = getBoundPort(server, "mock GraphQL server");

  return createMockServerHandle(createLoopbackBaseUrl(port), requests, server);
}

export async function startBinaryMockServer(
  body: Buffer,
): Promise<MockServerHandle<MockBinaryRequest>> {
  const requests: MockBinaryRequest[] = [];
  const server = http.createServer((req, res) => {
    requests.push({
      method: req.method ?? "GET",
      path: req.url ?? "",
    });

    res.statusCode = 200;
    res.setHeader("content-type", "application/octet-stream");
    res.setHeader("connection", "close");
    res.end(body);
  });

  await listenOnRandomPort(server);
  const { port } = getBoundPort(server, "mock download server");

  return createMockServerHandle(createLoopbackBaseUrl(port), requests, server);
}

export function createLocalRequestEnv(baseUrl?: string): NodeJS.ProcessEnv {
  return {
    ...(baseUrl ? { TWENTY_BASE_URL: baseUrl } : {}),
    TWENTY_NO_RETRY: "true",
    NODE_OPTIONS: "",
    HTTP_PROXY: "",
    HTTPS_PROXY: "",
    ALL_PROXY: "",
    NO_PROXY: "127.0.0.1,localhost",
    VITEST: "",
    VITEST_WORKER_ID: "",
    VITEST_POOL_ID: "",
  };
}

function createMockServerHandle<TRequest>(
  baseUrl: string,
  requests: TRequest[],
  server: http.Server,
): MockServerHandle<TRequest> {
  const sockets = new Set<import("node:net").Socket>();
  let closePromise: Promise<void> | undefined;
  let closed = false;

  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => {
      sockets.delete(socket);
    });
  });

  return {
    baseUrl,
    requests,
    getOnlyRequest: () => getOnlyRequest(requests),
    expectRequestCount: (count: number) => expectRequestCount(requests, count),
    close: () => {
      if (closed) {
        return Promise.resolve();
      }

      if (!closePromise) {
        closePromise = closeServer(server, sockets).then(() => {
          closed = true;
        });
      }

      return closePromise;
    },
  };
}

function getOnlyRequest<TRequest>(requests: TRequest[]): TRequest {
  expectOnlyRequest(requests);

  return requests[0] as TRequest;
}

function expectRequestCount<TRequest>(requests: TRequest[], count: number): void {
  const actual = requests.length;

  if (actual !== count) {
    if (count === 1) {
      throw new Error(`Expected exactly 1 request, got ${actual}`);
    }

    throw new Error(`Expected ${count} requests, got ${actual}`);
  }
}

function expectOnlyRequest<TRequest>(requests: TRequest[]): void {
  const actual = requests.length;

  if (actual !== 1) {
    throw new Error(`Expected exactly 1 request, got ${actual}`);
  }
}

async function listenOnRandomPort(server: http.Server): Promise<void> {
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  server.unref();
}

function getBoundPort(server: http.Server, name: string): AddressInfo {
  const address = server.address();

  if (!address || typeof address === "string") {
    throw new Error(`Failed to bind ${name}`);
  }

  return address as AddressInfo;
}

function createLoopbackBaseUrl(port: number): string {
  const baseUrl = new URL("http://127.0.0.1");
  baseUrl.port = String(port);

  return baseUrl.origin;
}

function closeServer(server: http.Server, sockets: Set<import("node:net").Socket>): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const forceCloseTimer = setTimeout(() => {
      for (const socket of sockets) {
        socket.destroy();
      }
    }, CLOSE_TIMEOUT_MS);
    forceCloseTimer.unref();

    server.close((error) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(forceCloseTimer);

      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}
