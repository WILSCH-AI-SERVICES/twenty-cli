import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { isLiveSmokeEnabled, resolveLiveSmokeConfig } from "./live-config";

describe("live config helper", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("throws Missing live smoke configuration when required env vars are absent", () => {
    const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "twenty-live-config-"));
    vi.spyOn(os, "homedir").mockReturnValue(tempHome);
    vi.stubEnv("TWENTY_API_TOKEN", "");
    vi.stubEnv("TWENTY_TOKEN", "");
    vi.stubEnv("TWENTY_BASE_URL", "");
    vi.stubEnv("TWENTY_PROFILE", "");

    expect(() => resolveLiveSmokeConfig({ required: true })).toThrow(
      "Missing live smoke configuration",
    );
  });

  it("falls back to ~/.twenty/config.json in optional mode", () => {
    const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "twenty-live-config-"));
    const configDir = path.join(tempHome, ".twenty");
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(
      path.join(configDir, "config.json"),
      JSON.stringify(
        {
          defaultWorkspace: "smoke",
          workspaces: {
            smoke: {
              apiKey: "file-token",
              apiUrl: "https://api.example.com",
            },
          },
        },
        null,
        2,
      ),
      "utf-8",
    );
    vi.spyOn(os, "homedir").mockReturnValue(tempHome);
    vi.stubEnv("TWENTY_API_TOKEN", "");
    vi.stubEnv("TWENTY_TOKEN", "");
    vi.stubEnv("TWENTY_BASE_URL", "");
    vi.stubEnv("TWENTY_PROFILE", "");

    expect(resolveLiveSmokeConfig({ required: false })).toEqual({
      token: "file-token",
      baseUrl: "https://api.example.com",
      profile: "smoke",
    });
  });

  it("merges env token with file baseUrl and profile", () => {
    const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "twenty-live-config-"));
    const configDir = path.join(tempHome, ".twenty");
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(
      path.join(configDir, "config.json"),
      JSON.stringify(
        {
          defaultWorkspace: "smoke",
          workspaces: {
            smoke: {
              apiKey: "file-token",
              apiUrl: "https://api.example.com",
            },
          },
        },
        null,
        2,
      ),
      "utf-8",
    );
    vi.spyOn(os, "homedir").mockReturnValue(tempHome);
    vi.stubEnv("TWENTY_API_TOKEN", "env-token");
    vi.stubEnv("TWENTY_TOKEN", "legacy-env-token");
    vi.stubEnv("TWENTY_BASE_URL", "");
    vi.stubEnv("TWENTY_PROFILE", "");

    expect(resolveLiveSmokeConfig({ required: false })).toEqual({
      token: "env-token",
      baseUrl: "https://api.example.com",
      profile: "smoke",
    });
  });

  it("falls back to legacy TWENTY_TOKEN", () => {
    const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "twenty-live-config-"));
    vi.spyOn(os, "homedir").mockReturnValue(tempHome);
    vi.stubEnv("TWENTY_API_TOKEN", "");
    vi.stubEnv("TWENTY_TOKEN", "legacy-env-token");
    vi.stubEnv("TWENTY_BASE_URL", "https://api.example.com");
    vi.stubEnv("TWENTY_PROFILE", "");

    expect(resolveLiveSmokeConfig({ required: false })).toEqual({
      token: "legacy-env-token",
      baseUrl: "https://api.example.com",
      profile: "default",
    });
  });

  it("enables live smoke only when TWENTY_LIVE_SMOKE is true", () => {
    vi.stubEnv("TWENTY_LIVE_SMOKE", "");

    expect(isLiveSmokeEnabled()).toBe(false);

    vi.stubEnv("TWENTY_LIVE_SMOKE", "true");

    expect(isLiveSmokeEnabled()).toBe(true);
  });
});
