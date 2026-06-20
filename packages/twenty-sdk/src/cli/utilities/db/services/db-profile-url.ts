import { CliError } from "../../errors/cli-error";

export function resolveProfileDatabaseUrl(
  databaseUrl: string,
  envPassword: string | undefined,
): string {
  try {
    const url = new URL(databaseUrl);
    if (!envPassword) {
      url.password = "";
      return url.toString();
    }

    if (!url.username) {
      throw new CliError(
        "TWENTY_DATABASE_PASSWORD requires a username in the selected db profile URL.",
        "INVALID_ARGUMENTS",
        "Store the profile URL with a username, for example postgresql://reader@host:5432/db, or set TWENTY_DATABASE_URL.",
      );
    }

    url.password = envPassword;

    return url.toString();
  } catch (error) {
    if (error instanceof CliError) {
      throw error;
    }

    return envPassword
      ? databaseUrl.replace(/:\/\/([^:@\s/]+)@/, `://$1:${encodeURIComponent(envPassword)}@`)
      : databaseUrl.replace(/:\/\/([^:\s/@]+):([^@\s]+)@/, "://$1@");
  }
}
