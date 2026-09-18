import axios, { AxiosError, InternalAxiosRequestConfig, AxiosHeaders } from "axios";
import axiosRetry from "axios-retry";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { ApiService } from "../api.service";

// Mock axios and axios-retry
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

describe("ApiService", () => {
  let mockAxiosInstance: {
    get: ReturnType<typeof vi.fn>;
    post: ReturnType<typeof vi.fn>;
    patch: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    request: ReturnType<typeof vi.fn>;
    interceptors: {
      request: { use: ReturnType<typeof vi.fn> };
      response: { use: ReturnType<typeof vi.fn> };
    };
  };
  let mockConfigService: {
    getConfig: ReturnType<typeof vi.fn>;
  };
  let requestInterceptor: (
    config: InternalAxiosRequestConfig,
  ) => Promise<InternalAxiosRequestConfig>;
  let responseInterceptor: (response: unknown) => unknown;
  let responseErrorInterceptor: (error: unknown) => never;

  beforeEach(() => {
    vi.clearAllMocks();

    mockAxiosInstance = {
      get: vi.fn(),
      post: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
      request: vi.fn(),
      interceptors: {
        request: { use: vi.fn() },
        response: { use: vi.fn() },
      },
    };

    vi.mocked(axios.create).mockReturnValue(mockAxiosInstance as any);

    mockConfigService = {
      getConfig: vi.fn().mockResolvedValue({
        apiUrl: "https://api.twenty.com",
        apiKey: "test-api-key",
        workspace: "default",
      }),
    };

    // Capture interceptors when ApiService is instantiated
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

  describe("constructor", () => {
    it("creates axios client with interceptors", () => {
      new ApiService(mockConfigService as any);

      expect(axios.create).toHaveBeenCalled();
      expect(mockAxiosInstance.interceptors.request.use).toHaveBeenCalled();
      expect(mockAxiosInstance.interceptors.response.use).toHaveBeenCalled();
    });

    it("configures axios-retry by default", () => {
      new ApiService(mockConfigService as any);

      expect(axiosRetry).toHaveBeenCalledWith(
        mockAxiosInstance,
        expect.objectContaining({
          retries: 3,
          retryDelay: expect.any(Function),
          retryCondition: expect.any(Function),
          onRetry: expect.any(Function),
        }),
      );
    });

    it("does not configure axios-retry when noRetry option is true", () => {
      new ApiService(mockConfigService as any, { noRetry: true });

      expect(axiosRetry).not.toHaveBeenCalled();
    });
  });

  describe("request interceptor", () => {
    it("adds auth header from config", async () => {
      new ApiService(mockConfigService as any);

      const config: InternalAxiosRequestConfig = {
        headers: new AxiosHeaders(),
      } as InternalAxiosRequestConfig;

      const result = await requestInterceptor(config);

      expect(mockConfigService.getConfig).toHaveBeenCalledWith({ workspace: undefined });
      expect(result.baseURL).toBe("https://api.twenty.com");
      expect(result.headers?.Authorization).toBe("Bearer test-api-key");
    });

    it("uses workspace option when provided", async () => {
      new ApiService(mockConfigService as any, { workspace: "staging" });

      const config: InternalAxiosRequestConfig = {
        headers: new AxiosHeaders(),
      } as InternalAxiosRequestConfig;

      await requestInterceptor(config);

      expect(mockConfigService.getConfig).toHaveBeenCalledWith({ workspace: "staging" });
    });
  });

  describe("retry configuration", () => {
    it("retries on 429 status", () => {
      new ApiService(mockConfigService as any);

      const retryConfig = vi.mocked(axiosRetry).mock.calls[0][1];
      const retryCondition = retryConfig?.retryCondition as (error: AxiosError) => boolean;

      const error = {
        response: { status: 429 },
      } as AxiosError;

      expect(retryCondition(error)).toBe(true);
    });

    it("retries on 502 status", () => {
      new ApiService(mockConfigService as any);

      const retryConfig = vi.mocked(axiosRetry).mock.calls[0][1];
      const retryCondition = retryConfig?.retryCondition as (error: AxiosError) => boolean;

      const error = {
        response: { status: 502 },
      } as AxiosError;

      expect(retryCondition(error)).toBe(true);
    });

    it("retries on 503 status", () => {
      new ApiService(mockConfigService as any);

      const retryConfig = vi.mocked(axiosRetry).mock.calls[0][1];
      const retryCondition = retryConfig?.retryCondition as (error: AxiosError) => boolean;

      const error = {
        response: { status: 503 },
      } as AxiosError;

      expect(retryCondition(error)).toBe(true);
    });

    it("retries on 504 status", () => {
      new ApiService(mockConfigService as any);

      const retryConfig = vi.mocked(axiosRetry).mock.calls[0][1];
      const retryCondition = retryConfig?.retryCondition as (error: AxiosError) => boolean;

      const error = {
        response: { status: 504 },
      } as AxiosError;

      expect(retryCondition(error)).toBe(true);
    });

    it("does not retry on 400 status", () => {
      new ApiService(mockConfigService as any);

      const retryConfig = vi.mocked(axiosRetry).mock.calls[0][1];
      const retryCondition = retryConfig?.retryCondition as (error: AxiosError) => boolean;

      const error = {
        response: { status: 400 },
      } as AxiosError;

      expect(retryCondition(error)).toBe(false);
    });

    it("does not retry on 401 status", () => {
      new ApiService(mockConfigService as any);

      const retryConfig = vi.mocked(axiosRetry).mock.calls[0][1];
      const retryCondition = retryConfig?.retryCondition as (error: AxiosError) => boolean;

      const error = {
        response: { status: 401 },
      } as AxiosError;

      expect(retryCondition(error)).toBe(false);
    });

    it("does not retry on 500 status", () => {
      new ApiService(mockConfigService as any);

      const retryConfig = vi.mocked(axiosRetry).mock.calls[0][1];
      const retryCondition = retryConfig?.retryCondition as (error: AxiosError) => boolean;

      const error = {
        response: { status: 500 },
      } as AxiosError;

      expect(retryCondition(error)).toBe(false);
    });

    it("respects Retry-After header", () => {
      new ApiService(mockConfigService as any);

      const retryConfig = vi.mocked(axiosRetry).mock.calls[0][1];
      const retryDelay = retryConfig?.retryDelay as (
        retryCount: number,
        error: AxiosError,
      ) => number;

      const error = {
        response: {
          headers: { "retry-after": "5" },
        },
      } as unknown as AxiosError;

      const delay = retryDelay(1, error);
      expect(delay).toBe(5000); // 5 seconds in milliseconds
    });

    it("uses exponential backoff with jitter when no Retry-After header", () => {
      new ApiService(mockConfigService as any);

      const retryConfig = vi.mocked(axiosRetry).mock.calls[0][1];
      const retryDelay = retryConfig?.retryDelay as (
        retryCount: number,
        error: AxiosError,
      ) => number;

      const error = {
        response: {
          headers: {},
        },
      } as unknown as AxiosError;

      // For retryCount = 1: baseDelay = 2^1 * 1000 = 2000, jitter = 0-1000
      // So delay should be between 2000 and 3000
      const delay = retryDelay(1, error);
      expect(delay).toBeGreaterThanOrEqual(2000);
      expect(delay).toBeLessThan(3000);
    });

    it("uses exponential backoff for retryCount 2", () => {
      new ApiService(mockConfigService as any);

      const retryConfig = vi.mocked(axiosRetry).mock.calls[0][1];
      const retryDelay = retryConfig?.retryDelay as (
        retryCount: number,
        error: AxiosError,
      ) => number;

      const error = {
        response: {
          headers: {},
        },
      } as unknown as AxiosError;

      // For retryCount = 2: baseDelay = 2^2 * 1000 = 4000, jitter = 0-1000
      const delay = retryDelay(2, error);
      expect(delay).toBeGreaterThanOrEqual(4000);
      expect(delay).toBeLessThan(5000);
    });

    it("handles invalid Retry-After header", () => {
      new ApiService(mockConfigService as any);

      const retryConfig = vi.mocked(axiosRetry).mock.calls[0][1];
      const retryDelay = retryConfig?.retryDelay as (
        retryCount: number,
        error: AxiosError,
      ) => number;

      const error = {
        response: {
          headers: { "retry-after": "invalid" },
        },
      } as unknown as AxiosError;

      // Should fall back to exponential backoff
      const delay = retryDelay(1, error);
      expect(delay).toBeGreaterThanOrEqual(2000);
      expect(delay).toBeLessThan(3000);
    });
  });

  describe("debug mode", () => {
    let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    });

    afterEach(() => {
      consoleErrorSpy.mockRestore();
    });

    it("logs requests when debug is enabled", async () => {
      new ApiService(mockConfigService as any, { debug: true });

      const config: InternalAxiosRequestConfig = {
        method: "get",
        url: "/rest/people",
        headers: new AxiosHeaders(),
      } as InternalAxiosRequestConfig;

      await requestInterceptor(config);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("GET https://api.twenty.com/rest/people"),
      );
    });

    it("logs request body when debug is enabled and data present", async () => {
      new ApiService(mockConfigService as any, { debug: true });

      const config: InternalAxiosRequestConfig = {
        method: "post",
        url: "/rest/people",
        headers: new AxiosHeaders(),
        data: { name: "Test Person" },
      } as InternalAxiosRequestConfig;

      await requestInterceptor(config);

      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("Body:"));
      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("Test Person"));
    });

    it("redacts sensitive values from debug request logs", async () => {
      new ApiService(mockConfigService as any, { debug: true });

      const config: InternalAxiosRequestConfig = {
        method: "post",
        url: "/rest/people?token=query-secret",
        headers: new AxiosHeaders(),
        data: {
          name: "Visible Person",
          apiKey: "body-secret",
          nested: { refreshToken: "refresh-secret" },
        },
      } as InternalAxiosRequestConfig;

      await requestInterceptor(config);

      const logs = consoleErrorSpy.mock.calls.flat().join("\n");
      expect(logs).toContain("Visible Person");
      expect(logs).toContain("[REDACTED]");
      expect(logs).not.toContain("query-secret");
      expect(logs).not.toContain("body-secret");
      expect(logs).not.toContain("refresh-secret");
    });

    it("logs successful responses when debug is enabled", () => {
      new ApiService(mockConfigService as any, { debug: true });

      const response = {
        status: 200,
        statusText: "OK",
        data: {},
      };

      responseInterceptor(response);

      expect(consoleErrorSpy).toHaveBeenCalledWith("← 200 OK");
    });

    it("logs error responses when debug is enabled", () => {
      new ApiService(mockConfigService as any, { debug: true });

      const error = {
        response: { status: 404 },
        message: "Not Found",
      };

      expect(() => responseErrorInterceptor(error)).toThrow();
      expect(consoleErrorSpy).toHaveBeenCalledWith("← 404 Not Found");
    });

    it("logs retry attempts when debug is enabled", () => {
      new ApiService(mockConfigService as any, { debug: true });

      const retryConfig = vi.mocked(axiosRetry).mock.calls[0][1];
      const onRetry = retryConfig?.onRetry as (retryCount: number, error: AxiosError) => void;

      const error = {
        message: "Service Unavailable",
      } as AxiosError;

      onRetry(1, error);

      expect(consoleErrorSpy).toHaveBeenCalledWith("Retry 1: Service Unavailable");
    });

    it("does not log requests when debug is disabled", async () => {
      new ApiService(mockConfigService as any, { debug: false });

      const config: InternalAxiosRequestConfig = {
        method: "get",
        url: "/rest/people",
        headers: new AxiosHeaders(),
      } as InternalAxiosRequestConfig;

      await requestInterceptor(config);

      // Should only be called zero times for debug logs
      const debugCalls = consoleErrorSpy.mock.calls.filter(
        (call) => typeof call[0] === "string" && call[0].startsWith("→"),
      );
      expect(debugCalls).toHaveLength(0);
    });

    it("does not log responses when debug is disabled", () => {
      new ApiService(mockConfigService as any, { debug: false });

      const response = {
        status: 200,
        statusText: "OK",
        data: {},
      };

      responseInterceptor(response);

      const debugCalls = consoleErrorSpy.mock.calls.filter(
        (call) => typeof call[0] === "string" && call[0].startsWith("←"),
      );
      expect(debugCalls).toHaveLength(0);
    });

    it("does not log retry attempts when debug is disabled", () => {
      new ApiService(mockConfigService as any, { debug: false });

      const retryConfig = vi.mocked(axiosRetry).mock.calls[0][1];
      const onRetry = retryConfig?.onRetry as (retryCount: number, error: AxiosError) => void;

      const error = {
        message: "Service Unavailable",
      } as AxiosError;

      onRetry(1, error);

      expect(consoleErrorSpy).not.toHaveBeenCalled();
    });
  });

  describe("HTTP methods", () => {
    it("delegates get to axios client", async () => {
      const service = new ApiService(mockConfigService as any);
      mockAxiosInstance.get.mockResolvedValue({ data: { id: "1" } });

      const result = await service.get("/rest/people");

      expect(mockAxiosInstance.get).toHaveBeenCalledWith("/rest/people", undefined);
      expect(result).toEqual({ data: { id: "1" } });
    });

    it("delegates get with config to axios client", async () => {
      const service = new ApiService(mockConfigService as any);
      mockAxiosInstance.get.mockResolvedValue({ data: { id: "1" } });

      const config = { params: { limit: "10" } };
      await service.get("/rest/people", config);

      expect(mockAxiosInstance.get).toHaveBeenCalledWith("/rest/people", config);
    });

    it("delegates post to axios client", async () => {
      const service = new ApiService(mockConfigService as any);
      mockAxiosInstance.post.mockResolvedValue({ data: { id: "1" } });

      const data = { name: "Test" };
      const result = await service.post("/rest/people", data);

      expect(mockAxiosInstance.post).toHaveBeenCalledWith("/rest/people", data, undefined);
      expect(result).toEqual({ data: { id: "1" } });
    });

    it("delegates patch to axios client", async () => {
      const service = new ApiService(mockConfigService as any);
      mockAxiosInstance.patch.mockResolvedValue({ data: { id: "1", name: "Updated" } });

      const data = { name: "Updated" };
      const result = await service.patch("/rest/people/1", data);

      expect(mockAxiosInstance.patch).toHaveBeenCalledWith("/rest/people/1", data, undefined);
      expect(result).toEqual({ data: { id: "1", name: "Updated" } });
    });

    it("delegates delete to axios client", async () => {
      const service = new ApiService(mockConfigService as any);
      mockAxiosInstance.delete.mockResolvedValue({ data: { id: "1" } });

      const result = await service.delete("/rest/people/1");

      expect(mockAxiosInstance.delete).toHaveBeenCalledWith("/rest/people/1", undefined);
      expect(result).toEqual({ data: { id: "1" } });
    });

    it("delegates request to axios client", async () => {
      const service = new ApiService(mockConfigService as any);
      mockAxiosInstance.request.mockResolvedValue({ data: { id: "1" } });

      const config = { method: "get" as const, url: "/rest/people" };
      const result = await service.request(config);

      expect(mockAxiosInstance.request).toHaveBeenCalledWith(config);
      expect(result).toEqual({ data: { id: "1" } });
    });
  });

  describe("response interceptor", () => {
    it("passes through successful responses", () => {
      new ApiService(mockConfigService as any);

      const response = {
        status: 200,
        statusText: "OK",
        data: { id: "1" },
      };

      const result = responseInterceptor(response);

      expect(result).toBe(response);
    });

    it("throws error on failed responses", () => {
      new ApiService(mockConfigService as any);

      const error = {
        response: { status: 500 },
        message: "Internal Server Error",
      };

      expect(() => responseErrorInterceptor(error)).toThrow();
    });

    it("prints the failed response's body under --debug so the server's own words reach the caller", () => {
      const stderr = vi.spyOn(console, "error").mockImplementation(() => {});
      new ApiService(mockConfigService as any, { debug: true });

      const error = {
        response: {
          status: 400,
          data: {
            statusCode: 400,
            error: "BadRequestException",
            messages: [
              "A deal cannot reach closed-lost without a loss reason. Missing field: lossReason",
            ],
          },
        },
        message: "Request failed with status code 400",
      };

      expect(() => responseErrorInterceptor(error)).toThrow();

      const lines = stderr.mock.calls.map((call) => String(call[0]));
      expect(lines).toContain("← 400 Request failed with status code 400");
      expect(
        lines.some(
          (line) => line.startsWith("  Response: ") && line.includes("Missing field: lossReason"),
        ),
      ).toBe(true);
    });

    it("prints no response line under --debug when the failure carried no body", () => {
      const stderr = vi.spyOn(console, "error").mockImplementation(() => {});
      new ApiService(mockConfigService as any, { debug: true });

      expect(() => responseErrorInterceptor({ message: "socket hang up" })).toThrow();

      const lines = stderr.mock.calls.map((call) => String(call[0]));
      expect(lines).toEqual(["←  socket hang up"]);
    });
  });
});
