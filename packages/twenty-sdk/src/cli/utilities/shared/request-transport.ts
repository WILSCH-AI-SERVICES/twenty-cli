import { AxiosRequestConfig, AxiosResponse } from "axios";

import { PublicHttpRequestOptions } from "../api/services/public-http.service";
import { CliServices } from "./services";

type PrivateTransportServices = Pick<CliServices, "api">;
type PublicTransportServices = Pick<CliServices, "publicHttp">;

export function requestPrivate<T = unknown>(
  services: PrivateTransportServices,
  config: AxiosRequestConfig,
): Promise<AxiosResponse<T>> {
  return services.api.request<T>(config);
}

export function requestPublic<T = unknown>(
  services: PublicTransportServices,
  options: PublicHttpRequestOptions,
): Promise<AxiosResponse<T>> {
  return services.publicHttp.request<T>(options);
}
