import axios, { AxiosError, InternalAxiosRequestConfig, AxiosHeaders } from "axios";
import axiosRetry from "axios-retry";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { CliError } from "../../../errors/cli-error";
import { PublicHttpService } from "../public-http.service";

vi.mock("axios", async () => {
  const actual = await vi.importActual<typeof import("axios")>("axios");
  return {
    ...actual,
    default: {
      ...actual.default,
      create: vi.fn(),
    },
  };
});

vi.mock("axios-retry");

describe("PublicHttpService", () => {
  let mockAxiosInstance: {
    request: ReturnType<typeof vi.fn>;
    interceptors: {
      request: { use: ReturnType<typeof vi.fn> };
      response: { use: ReturnType<typeof vi.fn> };
    };
  };
  let mockConfigService: {
    resolveApiConfig: ReturnType<typeof vi.fn>;
  };
  let requestInterceptor: (
    config: InternalAxiosRequestConfig,
  ) => Promise<InternalAxiosRequestConfig>;
  let responseInterceptor: (response: unknown) => unknown;
  let responseErrorInterceptor: (error: unknown) => never;

  beforeEach(() => {
    vi.clearAllMocks();

    mockAxiosInstance = {
      request: vi.fn(),
      interceptors: {
        request: { use: vi.fn() },
        response: { use: vi.fn() },
      },
    };

    vi.mocked(axios.create).mockReturnValue(mockAxiosInstance as any);

    mockConfigService = {
      resolveApiConfig: vi.fn().mockResolvedValue({
        apiUrl: "https://api.twenty.com",
        apiKey: "",
        workspace: "default",
      }),
    };

    mockAxiosInstance.interceptors.request.use.mockImplementation((interceptor) => {
      requestInterceptor = interceptor;
    });
    mockAxiosInstance.interceptors.response.use.mockImplementation((onSuccess, onError) => {
      responseInterceptor = onSuccess;
      responseErrorInterceptor = onError;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not attach Authorization when authMode is "none"', async () => {
    const service = new PublicHttpService(mockConfigService as any);

    const request = {
      authMode: "none" as const,
      method: "get" as const,
      path: "/s/public/ping",
      workspace: "smoke",
    };

    await service.request(request);

    const config = await requestInterceptor({
      ...(mockAxiosInstance.request.mock.calls[0][0] as InternalAxiosRequestConfig),
      headers: new AxiosHeaders(),
    });

    expect(mockConfigService.resolveApiConfig).toHaveBeenCalledWith({
      workspace: "smoke",
      requireAuth: false,
    });
    expect(config.baseURL).toBe("https://api.twenty.com");
    expect(config.headers?.Authorization).toBeUndefined();
  });

  it('continues without a token when authMode is "optional"', async () => {
    const service = new PublicHttpService(mockConfigService as any);

    await service.request({
      authMode: "optional",
      method: "get",
      path: "/s/public/ping",
    });

    const config = await requestInterceptor({
      ...(mockAxiosInstance.request.mock.calls[0][0] as InternalAxiosRequestConfig),
      headers: new AxiosHeaders(),
    });

    expect(config.headers?.Authorization).toBeUndefined();
  });

  it('attaches Authorization when a token exists and authMode is "optional"', async () => {
    mockConfigService.resolveApiConfig.mockResolvedValue({
      apiUrl: "https://api.twenty.com",
      apiKey: "workspace-token",
      workspace: "default",
    });

    const service = new PublicHttpService(mockConfigService as any);

    await service.request({
      authMode: "optional",
      method: "get",
      path: "/s/public/ping",
    });

    const config = await requestInterceptor({
      ...(mockAxiosInstance.request.mock.calls[0][0] as InternalAxiosRequestConfig),
      headers: new AxiosHeaders(),
    });

    expect(config.headers?.Authorization).toBe("Bearer workspace-token");
  });

  it('throws a CliError when authMode is "required" and no token exists', async () => {
    const service = new PublicHttpService(mockConfigService as any);

    await service.request({
      authMode: "required",
      method: "get",
      path: "/s/public/ping",
    });

    await expect(
      requestInterceptor({
        ...(mockAxiosInstance.request.mock.calls[0][0] as InternalAxiosRequestConfig),
        headers: new AxiosHeaders(),
      }),
    ).rejects.toEqual(
      new CliError(
        "Missing API token.",
        "AUTH",
        "Set TWENTY_API_TOKEN or configure an API key for the selected workspace.",
      ),
    );
  });

  it("inherits the shared retry behavior", () => {
    new PublicHttpService(mockConfigService as any, { debug: true });

    expect(axiosRetry).toHaveBeenCalledWith(
      mockAxiosInstance,
      expect.objectContaining({
        retries: 3,
        retryDelay: expect.any(Function),
        retryCondition: expect.any(Function),
        onRetry: expect.any(Function),
      }),
    );

    const retryConfig = vi.mocked(axiosRetry).mock.calls[0][1];
    const retryCondition = retryConfig?.retryCondition as (error: AxiosError) => boolean;

    expect(retryCondition({ response: { status: 429 } } as AxiosError)).toBe(true);
    expect(retryCondition({ response: { status: 500 } } as AxiosError)).toBe(false);
  });

  it("inherits the shared debug behavior", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const service = new PublicHttpService(mockConfigService as any, { debug: true });

    await service.request({
      authMode: "none",
      method: "get",
      path: "/s/public/ping",
      params: { source: "cli" },
    });

    await requestInterceptor({
      ...(mockAxiosInstance.request.mock.calls[0][0] as InternalAxiosRequestConfig),
      headers: new AxiosHeaders(),
    });
    responseInterceptor({ status: 200, statusText: "OK", data: {} });

    const retryConfig = vi.mocked(axiosRetry).mock.calls[0][1];
    const onRetry = retryConfig?.onRetry as (retryCount: number, error: AxiosError) => void;
    onRetry(1, { message: "Service Unavailable" } as AxiosError);

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("GET https://api.twenty.com/s/public/ping"),
    );
    expect(consoleErrorSpy).toHaveBeenCalledWith("← 200 OK");
    expect(consoleErrorSpy).toHaveBeenCalledWith("Retry 1: Service Unavailable");

    consoleErrorSpy.mockRestore();
  });

  it("resolves the base URL from the explicit workspace without hard-failing on missing auth", async () => {
    mockConfigService.resolveApiConfig.mockResolvedValue({
      apiUrl: "https://smoke.example.com",
      apiKey: "",
      workspace: "smoke",
    });

    const service = new PublicHttpService(mockConfigService as any);

    await service.request({
      authMode: "optional",
      method: "get",
      path: "/s/public/ping",
      workspace: "smoke",
      params: { source: "cli" },
    });

    const config = await requestInterceptor({
      ...(mockAxiosInstance.request.mock.calls[0][0] as InternalAxiosRequestConfig),
      headers: new AxiosHeaders(),
    });

    expect(config.baseURL).toBe("https://smoke.example.com");
    expect(config.params).toEqual({ source: "cli" });
    expect(config.headers?.Authorization).toBeUndefined();
  });

  it("resolves the base URL from env-derived config without hard-failing on missing auth", async () => {
    mockConfigService.resolveApiConfig.mockResolvedValue({
      apiUrl: "https://env.twenty.com",
      apiKey: "",
      workspace: "default",
    });

    const service = new PublicHttpService(mockConfigService as any);

    await service.request({
      authMode: "optional",
      method: "get",
      path: "/s/public/ping",
    });

    const config = await requestInterceptor({
      ...(mockAxiosInstance.request.mock.calls[0][0] as InternalAxiosRequestConfig),
      headers: new AxiosHeaders(),
    });

    expect(mockConfigService.resolveApiConfig).toHaveBeenCalledWith({
      workspace: undefined,
      requireAuth: false,
    });
    expect(config.baseURL).toBe("https://env.twenty.com");
    expect(config.headers?.Authorization).toBeUndefined();
  });

  it("resolves the base URL from config-derived workspace settings without hard-failing on missing auth", async () => {
    mockConfigService.resolveApiConfig.mockResolvedValue({
      apiUrl: "https://config.twenty.com",
      apiKey: "",
      workspace: "default",
    });

    const service = new PublicHttpService(mockConfigService as any);

    await service.request({
      authMode: "optional",
      method: "get",
      path: "/s/public/ping",
      params: { source: "cli" },
    });

    const config = await requestInterceptor({
      ...(mockAxiosInstance.request.mock.calls[0][0] as InternalAxiosRequestConfig),
      headers: new AxiosHeaders(),
    });

    expect(config.baseURL).toBe("https://config.twenty.com");
    expect(config.params).toEqual({ source: "cli" });
    expect(config.headers?.Authorization).toBeUndefined();
  });

  it("passes through response successes and errors", () => {
    new PublicHttpService(mockConfigService as any);

    const response = { status: 204, statusText: "No Content" };
    expect(responseInterceptor(response)).toBe(response);

    const error = { response: { status: 404 }, message: "Not Found" };
    expect(() => responseErrorInterceptor(error)).toThrow(error);
  });
});
