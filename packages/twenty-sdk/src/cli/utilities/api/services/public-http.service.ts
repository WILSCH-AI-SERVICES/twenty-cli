import { AxiosInstance, AxiosRequestConfig, AxiosResponse } from "axios";

import { ConfigService } from "../../config/services/config.service";
import { CliError } from "../../errors/cli-error";
import { createHttpClient, SharedHttpServiceOptions } from "./api.service";

export type PublicAuthMode = "none" | "optional" | "required";

export interface PublicHttpRequestOptions {
  authMode: PublicAuthMode;
  method: NonNullable<AxiosRequestConfig["method"]>;
  path: string;
  workspace?: string;
  params?: AxiosRequestConfig["params"];
  data?: unknown;
  headers?: AxiosRequestConfig["headers"];
  responseType?: AxiosRequestConfig["responseType"];
}

interface PublicHttpAxiosRequestConfig extends AxiosRequestConfig {
  twentyAuthMode?: PublicAuthMode;
  twentyWorkspace?: string;
}

export class PublicHttpService {
  private client: AxiosInstance;

  constructor(
    private configService: ConfigService,
    private options: SharedHttpServiceOptions = {},
  ) {
    this.client = createHttpClient(async (config) => {
      const publicConfig = config as PublicHttpAxiosRequestConfig;
      const authMode = publicConfig.twentyAuthMode ?? "none";
      const resolved = await this.configService.resolveApiConfig({
        workspace: publicConfig.twentyWorkspace ?? this.options.workspace,
        requireAuth: false,
      });

      if (authMode === "required" && !resolved.apiKey) {
        throw new CliError(
          "Missing API token.",
          "AUTH",
          "Set TWENTY_API_TOKEN or configure an API key for the selected workspace.",
        );
      }

      return {
        apiUrl: resolved.apiUrl,
        apiKey: authMode === "none" ? undefined : resolved.apiKey,
      };
    }, options);
  }

  async request<T = unknown>(options: PublicHttpRequestOptions): Promise<AxiosResponse<T>> {
    return this.client.request<T>({
      method: options.method,
      url: options.path,
      params: options.params,
      data: options.data,
      headers: options.headers,
      responseType: options.responseType,
      twentyAuthMode: options.authMode,
      twentyWorkspace: options.workspace,
    } as PublicHttpAxiosRequestConfig);
  }
}
