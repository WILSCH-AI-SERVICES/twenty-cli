import type { DbProfileConfig } from "../../config/services/config.service";

export function redactDatabaseUrl(value: string | undefined): string | undefined {
  if (!value) return value;

  try {
    const url = new URL(value);
    if (url.password) {
      url.password = "***";
    }

    return url.toString();
  } catch {
    return value.replace(/:\/\/([^:\s/@]+):([^@\s]+)@/, "://$1:***@");
  }
}

export function redactDbSecrets(value: string | undefined): string | undefined {
  if (!value) return value;

  return value.replace(/postgres(?:ql)?:\/\/[^\s"'`<>]+/gi, (match) => {
    return redactDatabaseUrl(match) ?? match;
  });
}

export function redactDbProfile(profile: DbProfileConfig): DbProfileConfig {
  return {
    ...profile,
    databaseUrl: redactDatabaseUrl(profile.databaseUrl) ?? profile.databaseUrl,
    cachedPassword: profile.cachedPassword ? "[hidden]" : profile.cachedPassword,
  };
}

export function redactDbProfiles(profiles: DbProfileConfig[]): DbProfileConfig[] {
  return profiles.map(redactDbProfile);
}
