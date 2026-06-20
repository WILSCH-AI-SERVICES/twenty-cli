import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const STRICT_URL_PATH_PATTERNS = [
  /^packages\/twenty-sdk\/src\/cli(?:\/.+)?\/__tests__\//,
  /^\.github\/workflows\//,
  /(^|\/)examples?(\/|$)/,
  /(^|\/)[^/]+\.example(?:\.[^/]+)?$/,
];

const PLANNING_DOC_PATH_PATTERNS = [
  /^plans\//,
  /^docs\/plans\//,
  /^docs\/superpowers\/(plans|specs)\//,
];

const HOME_PATH_SAFE_FIXTURE_PATHS = new Set([
  "packages/twenty-sdk/src/cli/utilities/config/services/__tests__/config.service.spec.ts",
]);

const UNIX_HOME_PATH_PATTERN = /(?:^|[^\w/\\-])(\/(?:Users|home)\/[^\s"'`<>()\]]+)/g;
const RAW_WINDOWS_HOME_PATH_PATTERN = /(?:^|[^\w/\\-])([A-Za-z]:\\[Uu]sers\\[^\s"'`<>()\]]+)/g;
const ESCAPED_WINDOWS_HOME_PATH_PATTERN =
  /(?:^|[^\w/\\-])([A-Za-z]:\\\\[Uu]sers\\\\[^\s"'`<>()\]]+)/g;
const URL_PATTERN = /https?:\/\/[^\s"'`<>()]+/g;
const TRAILING_URL_PUNCTUATION = new Set([".", ",", ";", ":", "!", "?", ")", "]", "}"]);
const APPROVED_STRICT_URL_HOSTS = new Set([
  "api.twenty.com",
  "acme.twenty.com",
  "custom.twenty.com",
  "config.twenty.com",
  "env.twenty.com",
  "crm.acme.com",
  "idp.example.com",
  "old.twenty.com",
  "new.twenty.com",
  "smoke.example.com",
  "api.example.com",
  "staging.twenty.com",
  "example.com",
  "localhost",
  "127.0.0.1",
  "::1",
]);
const SECRET_LITERAL_PATTERNS = [
  /["'`](?:token|apiKey|api_key|accessToken|authToken|secret|password)["'`]\s*:\s*["'`]([A-Za-z0-9._-]{24,})["'`]/gi,
  /(?:^|[^\w?&])([A-Z][A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|API[_-]?KEY|ACCESS[_-]?TOKEN))\s*=\s*([A-Za-z0-9._-]{24,})\b/g,
  /(?:apiKey|api_key|token|secret|password)\s*[:=]\s*["'`]([A-Za-z0-9._-]{24,})["'`]/gi,
  /(?:Authorization\s*:\s*)?["']?Bearer\s+([A-Za-z0-9._-]{24,})["']?/gi,
  /\b(?:ghp|gho|ghu|ghs|ghr|sk|pk)_[A-Za-z0-9]{20,}\b/gi,
];
const SECRET_QUERY_PARAM_NAME_PATTERN =
  /^(?:token|accesstoken|authtoken|authorization|secret|signature|sig|apikey)$/;
const SECRET_QUERY_PARAM_VALUE_PATTERN = /^[A-Za-z0-9._~+/=-]{16,}$/;
const SIGNATURE_QUERY_PARAM_VALUE_PATTERN = /^sha256:[A-Za-z0-9._~+/=-]{16,}$/i;

function normalizeQueryParamName(name) {
  return name.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
}

function isPlanningDoc(filePath) {
  return PLANNING_DOC_PATH_PATTERNS.some((pattern) => pattern.test(filePath));
}

function isSafeFixturePath(filePath) {
  return HOME_PATH_SAFE_FIXTURE_PATHS.has(filePath);
}

function shouldEnforceStrictUrlRules(filePath) {
  return STRICT_URL_PATH_PATTERNS.some((pattern) => pattern.test(filePath));
}

function normalizeHostname(hostname) {
  if (hostname.startsWith("[") && hostname.endsWith("]")) {
    return hostname.slice(1, -1).toLowerCase();
  }

  return hostname.toLowerCase();
}

function parseUrl(url) {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

function normalizeUrlToken(url) {
  let candidate = url;

  while (candidate.length > 0 && TRAILING_URL_PUNCTUATION.has(candidate.at(-1))) {
    const trimmed = candidate.slice(0, -1);

    if (!parseUrl(trimmed)) {
      break;
    }

    candidate = trimmed;
  }

  return candidate;
}

function isApprovedUrl(url) {
  const parsed = parseUrl(url);

  if (!parsed) {
    return false;
  }

  return APPROVED_STRICT_URL_HOSTS.has(normalizeHostname(parsed.hostname));
}

function hasObviousSecretQueryParam(url) {
  const parsed = parseUrl(url);

  if (!parsed) {
    return false;
  }

  for (const [name, value] of parsed.searchParams.entries()) {
    if (!SECRET_QUERY_PARAM_NAME_PATTERN.test(normalizeQueryParamName(name))) {
      continue;
    }

    if (
      SECRET_QUERY_PARAM_VALUE_PATTERN.test(value) ||
      SIGNATURE_QUERY_PARAM_VALUE_PATTERN.test(value)
    ) {
      return true;
    }
  }

  return false;
}

function hasObviousSecretUserinfo(parsed) {
  if (!parsed.username && !parsed.password) {
    return false;
  }

  return [parsed.username, parsed.password].some((value) =>
    SECRET_QUERY_PARAM_VALUE_PATTERN.test(value),
  );
}

function hasObviousSecretFragment(parsed) {
  if (!parsed.hash) {
    return false;
  }

  const fragment = parsed.hash.slice(1);

  if (!fragment) {
    return false;
  }

  const fragmentSearchParams = new URLSearchParams(fragment.replace(/^[?#]/, ""));

  for (const [name, value] of fragmentSearchParams.entries()) {
    if (!SECRET_QUERY_PARAM_NAME_PATTERN.test(normalizeQueryParamName(name))) {
      continue;
    }

    if (
      SECRET_QUERY_PARAM_VALUE_PATTERN.test(value) ||
      SIGNATURE_QUERY_PARAM_VALUE_PATTERN.test(value)
    ) {
      return true;
    }
  }

  return (
    SECRET_QUERY_PARAM_NAME_PATTERN.test(normalizeQueryParamName(fragment)) &&
    SECRET_QUERY_PARAM_VALUE_PATTERN.test(fragment)
  );
}

function addFinding(findings, filePath, code, match) {
  findings.push({
    code,
    filePath,
    match,
  });
}

export function formatFindingForOutput(finding) {
  if (finding.code === "POSSIBLE_SECRET_LITERAL") {
    return `- ${finding.code} ${finding.filePath} [redacted]`;
  }

  return `- ${finding.code} ${finding.filePath}`;
}

function formatFindingDetail(finding) {
  if (finding.code === "POSSIBLE_SECRET_LITERAL") {
    return `  - ${finding.code} [redacted]`;
  }

  return `  - ${finding.code}`;
}

export function formatFindingsForOutput(findings) {
  const groupedFindings = new Map();

  for (const finding of findings) {
    const existing = groupedFindings.get(finding.filePath);

    if (existing) {
      existing.push(finding);
    } else {
      groupedFindings.set(finding.filePath, [finding]);
    }
  }

  const lines = [];

  for (const [filePath, fileFindings] of groupedFindings) {
    const findingCount = fileFindings.length;
    lines.push(`- ${filePath} (${findingCount} finding${findingCount === 1 ? "" : "s"})`);

    for (const finding of fileFindings) {
      lines.push(formatFindingDetail(finding));
    }
  }

  return lines;
}

export function scanFileContent(filePath, content) {
  const findings = [];
  const planningDoc = isPlanningDoc(filePath);
  const safeFixturePath = isSafeFixturePath(filePath);
  const strictUrlSurface = shouldEnforceStrictUrlRules(filePath);

  if (!planningDoc && !safeFixturePath) {
    for (const match of content.matchAll(UNIX_HOME_PATH_PATTERN)) {
      addFinding(findings, filePath, "ABSOLUTE_HOME_PATH", match[1]);
    }

    for (const match of content.matchAll(RAW_WINDOWS_HOME_PATH_PATTERN)) {
      addFinding(findings, filePath, "ABSOLUTE_HOME_PATH", match[1]);
    }

    for (const match of content.matchAll(ESCAPED_WINDOWS_HOME_PATH_PATTERN)) {
      addFinding(findings, filePath, "ABSOLUTE_HOME_PATH", match[1]);
    }
  }

  for (const match of content.matchAll(URL_PATTERN)) {
    const url = normalizeUrlToken(match[0]);
    const parsed = parseUrl(url);

    if (strictUrlSurface && (!parsed || !isApprovedUrl(url))) {
      addFinding(findings, filePath, "UNAPPROVED_URL_LITERAL", url);
    }

    if (hasObviousSecretQueryParam(url)) {
      addFinding(findings, filePath, "POSSIBLE_SECRET_LITERAL", url);
    }

    if (
      parsed &&
      isApprovedUrl(url) &&
      (hasObviousSecretUserinfo(parsed) || hasObviousSecretFragment(parsed))
    ) {
      addFinding(findings, filePath, "POSSIBLE_SECRET_LITERAL", url);
    }
  }

  for (const pattern of SECRET_LITERAL_PATTERNS) {
    for (const match of content.matchAll(pattern)) {
      addFinding(findings, filePath, "POSSIBLE_SECRET_LITERAL", match[0]);
    }
  }

  return findings;
}

function isTextBuffer(buffer) {
  return !buffer.includes(0);
}

export function listTrackedFiles(rootDir = process.cwd()) {
  const output = execFileSync("git", ["-C", rootDir, "ls-files", "-z"], {
    encoding: "buffer",
  });

  return output.toString("utf8").split("\0").filter(Boolean);
}

export function scanTrackedTextFiles(rootDir = process.cwd()) {
  const findings = [];

  for (const filePath of listTrackedFiles(rootDir)) {
    let buffer;

    try {
      buffer = readFileSync(path.resolve(rootDir, filePath));
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
        continue;
      }

      throw error;
    }

    if (!isTextBuffer(buffer)) {
      continue;
    }

    findings.push(...scanFileContent(filePath, buffer.toString("utf8")));
  }

  return findings;
}

export function checkRepoHygiene({ rootDir = process.cwd() } = {}) {
  const findings = scanTrackedTextFiles(rootDir);

  return {
    findings,
    hasFindings: findings.length > 0,
  };
}
