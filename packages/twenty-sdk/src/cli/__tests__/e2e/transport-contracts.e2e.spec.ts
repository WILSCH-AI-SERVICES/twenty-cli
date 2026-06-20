import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { resolveBuiltCliPath } from "./helpers/cli-runner";
import {
  createLocalRequestEnv,
  startBinaryMockServer,
  startGraphqlMockServer,
} from "./helpers/mock-server";
import { runBuiltCliWithTempHomeAsync } from "./helpers/temp-home";

const cliPath = resolveBuiltCliPath();

if (!fs.existsSync(cliPath)) {
  throw new Error(
    `Missing built CLI artifact at ${cliPath}. Run "pnpm --filter ./packages/twenty-sdk build" first.`,
  );
}

describe("twenty clean-home transport contracts", () => {
  it("loads the full root help asset from the built CLI", async () => {
    const result = await runBuiltCliWithTempHomeAsync(["--help"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Auth & Workspace:");
    expect(result.stdout).toContain("Environment:");
  });

  it("openapi core still requires auth in the clean-home red state", async () => {
    const result = await runBuiltCliWithTempHomeAsync(["openapi", "core"]);

    expect(result.exitCode).toBe(3);
    expect(result.stderr).toContain("Missing API token.");
    expect(result.stderr).toContain(
      "Set TWENTY_API_TOKEN in .env, .env.local, --env-file, or your shell",
    );
  });

  it("auth discover loads public workspace data without requiring auth", async () => {
    const workspaceData = {
      id: "ws-123",
      logo: "https://example.com/logo.svg",
      displayName: "Acme Workspace",
      workspaceUrls: {
        subdomainUrl: "https://acme.twenty.com",
        customUrl: null,
      },
      authProviders: {
        google: true,
        magicLink: false,
        password: true,
        microsoft: false,
        sso: [
          {
            id: "idp-1",
            name: "Acme SSO",
            type: "OIDC",
            status: "ACTIVE",
            issuer: "https://idp.example.com",
          },
        ],
      },
      authBypassProviders: {
        google: false,
        password: false,
        microsoft: false,
      },
    };
    const server = await startGraphqlMockServer((body) => {
      const payload = JSON.parse(body) as {
        query: string;
        variables?: { origin?: string };
      };

      expect(payload.query).toContain("getPublicWorkspaceDataByDomain");
      expect(payload.variables).toEqual({
        origin: "https://acme.twenty.com",
      });

      return {
        data: {
          getPublicWorkspaceDataByDomain: workspaceData,
        },
      };
    });

    try {
      const result = await runBuiltCliWithTempHomeAsync(
        ["auth", "discover", "https://acme.twenty.com", "-o", "json", "--full"],
        {
          env: createLocalRequestEnv(server.baseUrl),
        },
      );

      expect(result.stderr).not.toContain("Missing API token.");
      expect(result.exitCode).toBe(0);
      expect(server.getOnlyRequest().pathname).toBe("/metadata");
      expect(JSON.parse(result.stdout)).toEqual(workspaceData);
    } finally {
      await server.close();
    }
  });

  it("files download writes the requested bytes without requiring auth", async () => {
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "twenty-cli-download-"));
    const outputPath = path.join(outputDir, "payload.bin");
    const expectedBytes = Buffer.from([0x74, 0x77, 0x65, 0x6e, 0x74, 0x79, 0x00, 0xff]);
    const server = await startBinaryMockServer(expectedBytes);

    try {
      const result = await runBuiltCliWithTempHomeAsync(
        [
          "files",
          "download",
          `${server.baseUrl}/file/files-field/file-123?token=signed-token`,
          "--output-file",
          outputPath,
        ],
        {
          env: createLocalRequestEnv(server.baseUrl),
        },
      );

      expect(result.stderr).not.toContain("Missing API token.");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain(`Downloaded to ${outputPath}`);
      expect(server.getOnlyRequest().path).toBe("/file/files-field/file-123?token=signed-token");
      expect(fs.readFileSync(outputPath)).toEqual(expectedBytes);
    } finally {
      await server.close();
      fs.rmSync(outputDir, { recursive: true, force: true });
    }
  });

  it("files public-asset writes the requested bytes without requiring auth", async () => {
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "twenty-cli-public-asset-"));
    const outputPath = path.join(outputDir, "logo.svg");
    const expectedBytes = Buffer.from("<svg>twenty</svg>");
    const server = await startBinaryMockServer(expectedBytes);

    try {
      const result = await runBuiltCliWithTempHomeAsync(
        [
          "files",
          "public-asset",
          "images/logo.svg",
          "--workspace-id",
          "ws-123",
          "--application-id",
          "app-123",
          "--output-file",
          outputPath,
        ],
        {
          env: createLocalRequestEnv(server.baseUrl),
        },
      );

      expect(result.stderr).not.toContain("Missing API token.");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain(`Downloaded to ${outputPath}`);
      expect(server.getOnlyRequest().path).toBe("/public-assets/ws-123/app-123/images/logo.svg");
      expect(fs.readFileSync(outputPath)).toEqual(expectedBytes);
    } finally {
      await server.close();
      fs.rmSync(outputDir, { recursive: true, force: true });
    }
  });

  it("auth renew-token keeps the non-hosted graphql path without requiring auth", async () => {
    const server = await startGraphqlMockServer((body) => {
      expect(body).toContain("renewToken");
      return {
        data: {
          renewToken: {
            tokens: {
              accessToken: "access-token",
              refreshToken: "refresh-token",
            },
          },
        },
      };
    });

    try {
      const result = await runBuiltCliWithTempHomeAsync(
        ["auth", "renew-token", "--app-token", "refresh-token", "-o", "json", "--full"],
        {
          env: createLocalRequestEnv(server.baseUrl),
        },
      );

      expect(result.stderr).not.toContain("Missing API token.");
      expect(result.exitCode).toBe(0);
      expect(server.getOnlyRequest().pathname).toBe("/graphql");
      expect(JSON.parse(result.stdout)).toEqual({
        tokens: {
          accessToken: "access-token",
          refreshToken: "refresh-token",
        },
      });
    } finally {
      await server.close();
    }
  });

  it("auth sso-url keeps the non-hosted graphql path without requiring auth", async () => {
    const server = await startGraphqlMockServer((body) => {
      expect(body).toContain("getAuthorizationUrlForSSO");
      return {
        data: {
          getAuthorizationUrlForSSO: {
            authorizationURL: "https://idp.example.com/login",
            type: "OIDC",
            id: "idp-1",
          },
        },
      };
    });

    try {
      const result = await runBuiltCliWithTempHomeAsync(
        [
          "auth",
          "sso-url",
          "idp-1",
          "--workspace-invite-hash",
          "invite-123",
          "-o",
          "json",
          "--full",
        ],
        {
          env: createLocalRequestEnv(server.baseUrl),
        },
      );

      expect(result.stderr).not.toContain("Missing API token.");
      expect(result.exitCode).toBe(0);
      expect(server.getOnlyRequest().pathname).toBe("/graphql");
      expect(JSON.parse(result.stdout)).toEqual({
        authorizationURL: "https://idp.example.com/login",
        type: "OIDC",
        id: "idp-1",
      });
    } finally {
      await server.close();
    }
  });
});
