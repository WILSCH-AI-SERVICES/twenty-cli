import { describe, expect, it, vi } from "vitest";

import {
  buildRenewTokenRequestData,
  buildSsoUrlRequestData,
  isHostedTwentyApiUrl,
  resolveAuthRequestSurface,
} from "../auth-compat";

describe("auth compatibility helpers", () => {
  it("detects hosted twenty API URLs", () => {
    expect(isHostedTwentyApiUrl("https://api.twenty.com")).toBe(true);
    expect(isHostedTwentyApiUrl("https://smoke.example.com")).toBe(false);
    expect(isHostedTwentyApiUrl("not-a-url")).toBe(false);
  });

  it("routes hosted auth helpers through /metadata", async () => {
    const resolveApiConfig = vi.fn().mockResolvedValue({
      apiUrl: "https://api.twenty.com",
      apiKey: "",
      workspace: "production",
    });

    await expect(resolveAuthRequestSurface({ resolveApiConfig }, "production")).resolves.toEqual({
      hosted: true,
      path: "/metadata",
    });

    expect(resolveApiConfig).toHaveBeenCalledWith({
      workspace: "production",
      requireAuth: false,
    });
  });

  it("keeps non-hosted auth helpers on /graphql", async () => {
    const resolveApiConfig = vi.fn().mockResolvedValue({
      apiUrl: "https://smoke.example.com",
      apiKey: "",
      workspace: "smoke",
    });

    await expect(resolveAuthRequestSurface({ resolveApiConfig }, "smoke")).resolves.toEqual({
      hosted: false,
      path: "/graphql",
    });
  });

  it("builds the hosted renew-token metadata payload", () => {
    expect(buildRenewTokenRequestData("refresh-token", true)).toEqual({
      query: expect.stringContaining("accessOrWorkspaceAgnosticToken"),
      variables: {
        appToken: "refresh-token",
      },
    });
  });

  it("builds the non-hosted renew-token graphql payload", () => {
    expect(buildRenewTokenRequestData("refresh-token", false)).toEqual({
      query: expect.stringContaining("accessToken"),
      variables: {
        appToken: "refresh-token",
      },
    });
  });

  it("builds the sso-url payload and omits invite hash when absent", () => {
    expect(buildSsoUrlRequestData("idp-1")).toEqual({
      query: expect.stringContaining("getAuthorizationUrlForSSO"),
      variables: {
        input: {
          identityProviderId: "idp-1",
        },
      },
    });
  });

  it("builds the sso-url payload with an invite hash when provided", () => {
    expect(buildSsoUrlRequestData("idp-1", "invite-123")).toEqual({
      query: expect.stringContaining("getAuthorizationUrlForSSO"),
      variables: {
        input: {
          identityProviderId: "idp-1",
          workspaceInviteHash: "invite-123",
        },
      },
    });
  });
});
