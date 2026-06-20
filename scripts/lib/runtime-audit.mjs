const BLOCKING_SEVERITIES = new Set(["high", "critical"]);

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeAdvisories(report) {
  if (!isRecord(report)) {
    return [];
  }

  if (Array.isArray(report.advisories)) {
    return report.advisories.filter(isRecord);
  }

  if (isRecord(report.advisories)) {
    return Object.values(report.advisories).filter(isRecord);
  }

  return [];
}

function advisoryHasRuntimeFinding(advisory) {
  if (!Array.isArray(advisory.findings) || advisory.findings.length === 0) {
    return true;
  }

  return advisory.findings.some((finding) => isRecord(finding) && finding.dev !== true);
}

export function findBlockingRuntimeAdvisories(report) {
  return normalizeAdvisories(report)
    .filter((advisory) => BLOCKING_SEVERITIES.has(String(advisory.severity ?? "")))
    .filter(advisoryHasRuntimeFinding)
    .map((advisory) => ({
      moduleName: String(advisory.module_name ?? advisory.moduleName ?? "unknown"),
      severity: String(advisory.severity),
      title: String(advisory.title ?? "Untitled advisory"),
      url: typeof advisory.url === "string" ? advisory.url : undefined,
    }));
}

export function formatBlockingRuntimeAdvisories(findings) {
  if (findings.length === 0) {
    return "No high or critical runtime dependency advisories found.";
  }

  return [
    "High or critical runtime dependency advisories found:",
    ...findings.map((finding) => {
      const urlSuffix = finding.url ? ` (${finding.url})` : "";

      return `- ${finding.severity}: ${finding.moduleName} - ${finding.title}${urlSuffix}`;
    }),
  ].join("\n");
}
