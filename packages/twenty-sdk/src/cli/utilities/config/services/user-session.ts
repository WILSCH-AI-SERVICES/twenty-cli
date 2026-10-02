/**
 * A person's own session on a Twenty instance — the house's way to make every write name
 * the person behind it (DaveX2001/deliverable-tracking#3236 AC2).
 *
 * An API key is a workspace-level actor: a record created with one names the key, not a
 * person. A session is minted from the person's own sign-in (password, then the second
 * factor when the workspace enforces it), and a record created with its access token names
 * that person's workspace member. `twenty auth login --email` mints it once; the refresh
 * token is kept in ~/.twenty/config.json (mode 0600) and every later command renews the
 * short-lived access token from it, so no .env, exported variable or tunnel is needed.
 */

import { CliError } from "../../errors/cli-error";

export interface UserSession {
  email: string;
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshToken: string;
  refreshTokenExpiresAt?: string;
}

/** Renew this long before the access token expires, so a command never starts on a token about to lapse. */
const RENEW_MARGIN_MS = 5 * 60 * 1000;

const TOKENS_SELECTION = `tokens {
  accessOrWorkspaceAgnosticToken { token expiresAt }
  refreshToken { token expiresAt }
}`;

interface AuthTokens {
  accessOrWorkspaceAgnosticToken: { token: string; expiresAt: string };
  refreshToken: { token: string; expiresAt: string };
}

interface GraphQLError {
  message: string;
  extensions?: { code?: string; subCode?: string };
}

async function metadataCall<T>(
  apiUrl: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<{ data?: T; errors?: GraphQLError[] }> {
  const origin = new URL(apiUrl).origin;
  let response: Response;
  try {
    response = await fetch(`${origin}/metadata`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify({ query, variables }),
    });
  } catch (error) {
    throw new CliError(
      `Could not reach ${origin}: ${(error as Error).message}`,
      "NETWORK",
      "Check the instance address and your network.",
    );
  }
  const body = (await response.json().catch(() => ({}))) as {
    data?: T;
    errors?: GraphQLError[];
  };
  return body;
}

function subCodeOf(errors?: GraphQLError[]): string | undefined {
  return errors?.[0]?.extensions?.subCode ?? errors?.[0]?.extensions?.code;
}

function toSession(email: string, tokens: AuthTokens): UserSession {
  return {
    email,
    accessToken: tokens.accessOrWorkspaceAgnosticToken.token,
    accessTokenExpiresAt: tokens.accessOrWorkspaceAgnosticToken.expiresAt,
    refreshToken: tokens.refreshToken.token,
    refreshTokenExpiresAt: tokens.refreshToken.expiresAt,
  };
}

/**
 * Sign in as a person. `getOtp` is asked for the second factor only when the instance
 * answers that the workspace requires one; it is never sent otherwise.
 */
export async function signInUserSession(
  apiUrl: string,
  email: string,
  password: string,
  getOtp: () => Promise<string>,
): Promise<UserSession> {
  const origin = new URL(apiUrl).origin;
  const login = await metadataCall<{
    getLoginTokenFromCredentials: { loginToken: { token: string } };
  }>(
    apiUrl,
    `mutation Login($email: String!, $password: String!, $origin: String!) {
      getLoginTokenFromCredentials(email: $email, password: $password, origin: $origin) {
        loginToken { token }
      }
    }`,
    { email, password, origin },
  );
  const loginToken = login.data?.getLoginTokenFromCredentials?.loginToken?.token;
  if (!loginToken) {
    throw new CliError(
      `Sign-in refused: ${login.errors?.[0]?.message ?? "no login token returned"}`,
      "AUTH",
      "Check the email and password for this instance.",
    );
  }

  const exchanged = await metadataCall<{ getAuthTokensFromLoginToken: { tokens: AuthTokens } }>(
    apiUrl,
    `mutation Exchange($loginToken: String!, $origin: String!) {
      getAuthTokensFromLoginToken(loginToken: $loginToken, origin: $origin) { ${TOKENS_SELECTION} }
    }`,
    { loginToken, origin },
  );
  const direct = exchanged.data?.getAuthTokensFromLoginToken?.tokens;
  if (direct) return toSession(email, direct);

  const subCode = subCodeOf(exchanged.errors);
  if (subCode === "TWO_FACTOR_AUTHENTICATION_PROVISION_REQUIRED") {
    throw new CliError(
      "This workspace requires a second factor and this account has none yet.",
      "AUTH",
      "Sign in once in the browser to set up the authenticator, then run this login again.",
    );
  }
  if (subCode !== "TWO_FACTOR_AUTHENTICATION_VERIFICATION_REQUIRED") {
    throw new CliError(
      `Sign-in refused: ${exchanged.errors?.[0]?.message ?? "no tokens returned"}`,
      "AUTH",
    );
  }

  const otp = (await getOtp()).trim();
  const verified = await metadataCall<{ getAuthTokensFromOTP: { tokens: AuthTokens } }>(
    apiUrl,
    `mutation Otp($otp: String!, $loginToken: String!, $origin: String!) {
      getAuthTokensFromOTP(otp: $otp, loginToken: $loginToken, origin: $origin) { ${TOKENS_SELECTION} }
    }`,
    { otp, loginToken, origin },
  );
  const tokens = verified.data?.getAuthTokensFromOTP?.tokens;
  if (!tokens) {
    throw new CliError(
      `Second factor refused: ${verified.errors?.[0]?.message ?? "no tokens returned"}`,
      "AUTH",
      "Enter the current code from your authenticator.",
    );
  }
  return toSession(email, tokens);
}

export function sessionNeedsRenewal(session: UserSession, now = Date.now()): boolean {
  const expiresAt = Date.parse(session.accessTokenExpiresAt);
  return Number.isNaN(expiresAt) || expiresAt - now < RENEW_MARGIN_MS;
}

export async function renewUserSession(apiUrl: string, session: UserSession): Promise<UserSession> {
  const renewed = await metadataCall<{ renewToken: { tokens: AuthTokens } }>(
    apiUrl,
    `mutation Renew($appToken: String!) { renewToken(appToken: $appToken) { ${TOKENS_SELECTION} } }`,
    { appToken: session.refreshToken },
  );
  const tokens = renewed.data?.renewToken?.tokens;
  if (!tokens) {
    throw new CliError(
      `Session for ${session.email} could not be renewed: ${renewed.errors?.[0]?.message ?? "no tokens returned"}`,
      "AUTH",
      `Run "twenty auth login --email ${session.email}" again.`,
    );
  }
  return toSession(session.email, tokens);
}
