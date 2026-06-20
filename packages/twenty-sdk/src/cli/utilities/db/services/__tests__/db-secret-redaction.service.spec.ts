import { describe, expect, it } from "vitest";

import {
  redactDatabaseUrl,
  redactDbProfile,
  redactDbSecrets,
} from "../db-secret-redaction.service";

describe("db secret redaction", () => {
  it("redacts database passwords while keeping routing details", () => {
    expect(
      redactDatabaseUrl("postgresql://reader:secret@db.example.com:5432/twenty?sslmode=require"),
    ).toBe("postgresql://reader:***@db.example.com:5432/twenty?sslmode=require");
  });

  it("handles urls without passwords", () => {
    expect(redactDatabaseUrl("postgresql://reader@db.example.com/twenty")).toBe(
      "postgresql://reader@db.example.com/twenty",
    );
  });

  it("redacts profile databaseUrl and cachedPassword", () => {
    expect(
      redactDbProfile({
        name: "prod",
        workspace: "demo",
        databaseUrl: "postgresql://reader:secret@db.example.com/twenty",
        credentialSource: "manual",
        cachedPassword: "secret",
      }),
    ).toMatchObject({
      name: "prod",
      workspace: "demo",
      databaseUrl: "postgresql://reader:***@db.example.com/twenty",
      credentialSource: "manual",
      cachedPassword: "[hidden]",
    });
  });

  it("redacts embedded database URLs in diagnostic text", () => {
    expect(
      redactDbSecrets(
        "connection failed for postgresql://reader:secret@db.example.com/twenty with timeout",
      ),
    ).toBe("connection failed for postgresql://reader:***@db.example.com/twenty with timeout");
  });
});
