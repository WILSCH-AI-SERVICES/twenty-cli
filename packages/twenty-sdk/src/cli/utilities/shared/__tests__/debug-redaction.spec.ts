import { describe, expect, it } from "vitest";

import { redactSensitiveText, stringifyDebugPreview } from "../debug-redaction";

describe("debug redaction", () => {
  it("redacts sensitive object keys recursively", () => {
    const preview = stringifyDebugPreview({
      authorization: "Bearer token-123",
      nested: {
        apiKey: "secret-api-key",
        refresh_token: "refresh-token",
      },
      safe: "visible",
    });

    expect(preview).toContain('"authorization":"[REDACTED]"');
    expect(preview).toContain('"apiKey":"[REDACTED]"');
    expect(preview).toContain('"refresh_token":"[REDACTED]"');
    expect(preview).toContain('"safe":"visible"');
    expect(preview).not.toContain("token-123");
    expect(preview).not.toContain("secret-api-key");
  });

  it("redacts bearer tokens and token query parameters in text", () => {
    expect(
      redactSensitiveText("GET /callback?token=abc123&safe=true Authorization: Bearer live-token"),
    ).toBe("GET /callback?token=[REDACTED]&safe=true Authorization: Bearer [REDACTED]");
  });

  it("redacts JSON-like sensitive fields inside text values", () => {
    expect(redactSensitiveText('tool text {"apiKey":"secret","name":"visible"}')).toBe(
      'tool text {"apiKey":"[REDACTED]","name":"visible"}',
    );
  });

  it("truncates previews after redaction", () => {
    const preview = stringifyDebugPreview({ token: "secret", payload: "x".repeat(1000) }, 80);

    expect(preview.length).toBeLessThanOrEqual(83);
    expect(preview).toContain("[REDACTED]");
    expect(preview).not.toContain("secret");
  });
});
