import axios, {
  AxiosInstance,
  AxiosRequestConfig,
  AxiosResponse,
  InternalAxiosRequestConfig,
} from "axios";
import axiosRetry from "axios-retry";

import { ConfigService } from "../../config/services/config.service";
import { redactSensitiveText, stringifyDebugPreview } from "../../shared/debug-redaction";

export interface ApiServiceOptions {
  workspace?: string;
  debug?: boolean;
  noRetry?: boolean;
}

export interface SharedHttpServiceOptions {
  workspace?: string;
  debug?: boolean;
  noRetry?: boolean;
}

export interface RequestResolution {
  apiUrl: string;
  apiKey?: string;
}

type RequestConfigResolver = (config: InternalAxiosRequestConfig) => Promise<RequestResolution>;

export function createHttpClient(
  resolveRequestConfig: RequestConfigResolver,
  options: SharedHttpServiceOptions = {},
): AxiosInstance {
  const client = axios.create();

  if (!options.noRetry) {
    axiosRetry(client, {
      retries: 3,
      retryDelay: (retryCount, error) => {
        const retryAfter = error.response?.headers?.["retry-after"];
        if (retryAfter) {
          const seconds = Number.parseInt(String(retryAfter), 10);
          if (!Number.isNaN(seconds)) {
            return seconds * 1000;
          }
        }
        const baseDelay = Math.pow(2, retryCount) * 1000;
        const jitter = Math.random() * 1000;
        return baseDelay + jitter;
      },
      retryCondition: (error) => {
        const status = error.response?.status;
        return status === 429 || status === 502 || status === 503 || status === 504;
      },
      onRetry: (retryCount, error) => {
        if (options.debug) {
          // eslint-disable-next-line no-console
          console.error(`Retry ${retryCount}: ${error.message}`);
        }
      },
    });
  }

  client.interceptors.request.use(async (config) => {
    const resolved = await resolveRequestConfig(config);

    config.baseURL = resolved.apiUrl;
    config.headers = config.headers ?? {};

    if (resolved.apiKey) {
      config.headers.Authorization = `Bearer ${resolved.apiKey}`;
    } else if ("Authorization" in config.headers) {
      delete config.headers.Authorization;
    }

    if (options.debug) {
      const url = redactSensitiveText(`${config.baseURL ?? ""}${config.url ?? ""}`);
      // eslint-disable-next-line no-console
      console.error(`→ ${config.method?.toUpperCase()} ${url}`);
      if (config.data) {
        // eslint-disable-next-line no-console
        console.error(`  Body: ${stringifyDebugPreview(config.data)}`);
      }
    }

    return config;
  });

  client.interceptors.response.use(
    (response) => {
      if (options.debug) {
        // eslint-disable-next-line no-console
        console.error(`← ${response.status} ${response.statusText}`);
      }
      return response;
    },
    (error) => {
      if (options.debug) {
        // eslint-disable-next-line no-console
        console.error(`← ${error.response?.status ?? ""} ${error.message}`);
      }
      throw error;
    },
  );

  return client;
}

export class ApiService {
  private client: AxiosInstance;
  private configService: ConfigService;
  private options: ApiServiceOptions;

  constructor(configService: ConfigService, options: ApiServiceOptions = {}) {
    this.configService = configService;
    this.options = options;
    this.client = createHttpClient(async () => {
      const resolved = await this.configService.getConfig({
        workspace: this.options.workspace,
      });

      return {
        apiUrl: resolved.apiUrl,
        apiKey: resolved.apiKey,
      };
    }, options);
  }

  async get<T = unknown>(url: string, config?: AxiosRequestConfig): Promise<AxiosResponse<T>> {
    return this.client.get<T>(url, config);
  }

  async post<T = unknown>(
    url: string,
    data?: unknown,
    config?: AxiosRequestConfig,
  ): Promise<AxiosResponse<T>> {
    return this.client.post<T>(url, data, config);
  }

  async patch<T = unknown>(
    url: string,
    data?: unknown,
    config?: AxiosRequestConfig,
  ): Promise<AxiosResponse<T>> {
    return this.client.patch<T>(url, data, config);
  }

  async delete<T = unknown>(url: string, config?: AxiosRequestConfig): Promise<AxiosResponse<T>> {
    return this.client.delete<T>(url, config);
  }

  async request<T = unknown>(config: AxiosRequestConfig): Promise<AxiosResponse<T>> {
    return this.client.request<T>(config);
  }
}
