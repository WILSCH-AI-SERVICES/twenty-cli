import type { ConfigService } from "../../utilities/config/services/config.service";

const RENEW_TOKEN_MUTATION = `mutation RenewToken($appToken: String!) {
  renewToken(appToken: $appToken) {
    tokens {
      accessToken
      refreshToken
    }
  }
}`;

const HOSTED_RENEW_TOKEN_MUTATION = `mutation RenewToken($appToken: String!) {
  renewToken(appToken: $appToken) {
    tokens {
      accessOrWorkspaceAgnosticToken {
        token
        expiresAt
      }
      refreshToken {
        token
        expiresAt
      }
    }
  }
}`;

const SSO_URL_MUTATION = `mutation GetAuthorizationUrlForSSO($input: GetAuthorizationUrlForSSOInput!) {
  getAuthorizationUrlForSSO(input: $input) {
    authorizationURL
    type
    id
  }
}`;

const HOSTED_API_HOSTNAME = "api.twenty.com";
const DEFAULT_AUTH_MUTATION_PATH = "/graphql";
const HOSTED_AUTH_MUTATION_PATH = "/metadata";

type AuthConfigService = Pick<ConfigService, "resolveApiConfig">;

export interface AuthRequestSurface {
  hosted: boolean;
  path: string;
}

export function isHostedTwentyApiUrl(apiUrl: string): boolean {
  try {
    return new URL(apiUrl).hostname === HOSTED_API_HOSTNAME;
  } catch {
    return false;
  }
}

export async function resolveAuthRequestSurface(
  configService: AuthConfigService,
  workspace: string | undefined,
): Promise<AuthRequestSurface> {
  const resolved = await configService.resolveApiConfig({
    workspace,
    requireAuth: false,
  });
  const hosted = isHostedTwentyApiUrl(resolved.apiUrl);

  return {
    hosted,
    path: hosted ? HOSTED_AUTH_MUTATION_PATH : DEFAULT_AUTH_MUTATION_PATH,
  };
}

export function buildRenewTokenRequestData(
  appToken: string,
  hosted: boolean,
): {
  query: string;
  variables: { appToken: string };
} {
  return {
    query: hosted ? HOSTED_RENEW_TOKEN_MUTATION : RENEW_TOKEN_MUTATION,
    variables: { appToken },
  };
}

export function buildSsoUrlRequestData(
  identityProviderId: string,
  workspaceInviteHash?: string,
): {
  query: string;
  variables: {
    input: {
      identityProviderId: string;
      workspaceInviteHash?: string;
    };
  };
} {
  return {
    query: SSO_URL_MUTATION,
    variables: {
      input: {
        identityProviderId,
        ...(workspaceInviteHash ? { workspaceInviteHash } : {}),
      },
    },
  };
}
