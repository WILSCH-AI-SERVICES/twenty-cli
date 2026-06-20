import { once } from "node:events";
import http from "node:http";

import { describe, expect, it } from "vitest";

import { startBinaryMockServer, startGraphqlMockServer } from "./mock-server";

async function postJson(url: string, body: unknown): Promise<void> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

  await response.text();
}

async function expectPending(promise: Promise<unknown>, timeoutMs = 50): Promise<void> {
  const outcome = await Promise.race([
    promise.then(
      () => "resolved",
      () => "rejected",
    ),
    new Promise<"pending">((resolve) => {
      setTimeout(() => resolve("pending"), timeoutMs);
    }),
  ]);

  expect(outcome).toBe("pending");
}

async function expectSettlesWithin(promise: Promise<unknown>, timeoutMs = 150): Promise<void> {
  const outcome = await Promise.race([
    promise.then(
      () => "resolved",
      () => "rejected",
    ),
    new Promise<"timeout">((resolve) => {
      setTimeout(() => resolve("timeout"), timeoutMs);
    }),
  ]);

  expect(outcome).toBe("resolved");
}

describe("mock server resources", () => {
  it("close waits for the server to actually shut down", async () => {
    const server = await startGraphqlMockServer(() => ({
      data: {
        ping: "pong",
      },
    }));

    const request = http.request(`${server.baseUrl}/graphql`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
    });

    const socket = await once(request, "socket");
    await once(socket[0], "connect");

    request.flushHeaders();
    request.write('{"query":"');

    const closePromise = server.close();
    setTimeout(() => {
      request.end('ping"}');
    }, 20);

    await expectPending(closePromise, 10);
    await once(request, "response");
    await closePromise;
  });

  it("close resolves when a client stalls a request", async () => {
    const server = await startGraphqlMockServer(() => ({
      data: {
        ping: "pong",
      },
    }));

    const request = http.request(`${server.baseUrl}/graphql`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
    });

    request.on("error", () => {});

    const socket = await once(request, "socket");
    await once(socket[0], "connect");

    request.flushHeaders();
    request.write('{"query":"');

    await expectSettlesWithin(server.close(), 250);
  });

  it("close is idempotent", async () => {
    const server = await startGraphqlMockServer(() => ({
      data: {
        ping: "pong",
      },
    }));

    const firstClose = server.close();
    const secondClose = server.close();

    await expect(firstClose).resolves.toBeUndefined();
    await expect(secondClose).resolves.toBeUndefined();
  });

  it("getOnlyRequest throws when there are no requests", async () => {
    const server = await startGraphqlMockServer(() => ({
      data: {
        ping: "pong",
      },
    }));

    expect(() => server.getOnlyRequest()).toThrow(/Expected exactly 1 request, got 0/);

    await server.close();
  });

  it("getOnlyRequest returns the single request", async () => {
    const server = await startGraphqlMockServer(() => ({
      data: {
        ping: "pong",
      },
    }));

    await postJson(`${server.baseUrl}/graphql`, {
      query: "query Ping { ping }",
      variables: {
        id: "workspace-123",
      },
    });

    expect(server.getOnlyRequest()).toEqual({
      pathname: "/graphql",
      body: JSON.stringify({
        query: "query Ping { ping }",
        variables: {
          id: "workspace-123",
        },
      }),
    });
    expect(server.requests).toHaveLength(1);
    expect(server.expectRequestCount(1)).toBeUndefined();

    await server.close();
  });

  it("getOnlyRequest throws when there are multiple requests", async () => {
    const server = await startGraphqlMockServer(() => ({
      data: {
        ping: "pong",
      },
    }));

    await postJson(`${server.baseUrl}/graphql`, {
      query: "query First { ping }",
    });
    await postJson(`${server.baseUrl}/graphql`, {
      query: "query Second { ping }",
    });

    expect(() => server.getOnlyRequest()).toThrow(/Expected exactly 1 request, got 2/);

    await server.close();
  });

  it("expectRequestCount accepts zero requests", async () => {
    const server = await startBinaryMockServer(Buffer.from("ok"));

    expect(() => server.expectRequestCount(0)).not.toThrow();

    await server.close();
  });

  it("expectRequestCount accepts one request and rejects multiple requests", async () => {
    const oneRequestServer = await startBinaryMockServer(Buffer.from("ok"));
    await fetch(`${oneRequestServer.baseUrl}/file/one`, {
      method: "GET",
    });

    expect(() => oneRequestServer.expectRequestCount(1)).not.toThrow();
    expect(() => oneRequestServer.expectRequestCount(0)).toThrow(/Expected 0 requests, got 1/);
    await oneRequestServer.close();

    const multipleRequestsServer = await startBinaryMockServer(Buffer.from("ok"));
    await fetch(`${multipleRequestsServer.baseUrl}/file/one`, {
      method: "GET",
    });
    await fetch(`${multipleRequestsServer.baseUrl}/file/two`, {
      method: "GET",
    });

    expect(() => multipleRequestsServer.expectRequestCount(1)).toThrow(
      /Expected exactly 1 request, got 2/,
    );
    await multipleRequestsServer.close();
  });

  it("preserves graphql request metadata", async () => {
    const server = await startGraphqlMockServer(() => ({
      data: {
        ping: "pong",
      },
    }));

    await postJson(`${server.baseUrl}/metadata`, {
      query: "query Ping { ping }",
    });

    expect(server.requests).toEqual([
      {
        pathname: "/metadata",
        body: JSON.stringify({
          query: "query Ping { ping }",
        }),
      },
    ]);

    await server.close();
  });

  it("preserves binary request metadata", async () => {
    const server = await startBinaryMockServer(Buffer.from("binary-body"));

    await fetch(`${server.baseUrl}/file/files-field/file-123?token=signed-token`, {
      method: "PUT",
    });

    expect(server.requests).toEqual([
      {
        method: "PUT",
        path: "/file/files-field/file-123?token=signed-token",
      },
    ]);

    await server.close();
  });
});
