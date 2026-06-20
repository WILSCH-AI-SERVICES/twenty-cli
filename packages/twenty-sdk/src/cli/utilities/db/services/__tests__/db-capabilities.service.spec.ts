import { describe, expect, it } from "vitest";

import { DbCapabilitiesService, type DbSchemaSnapshot } from "../db-capabilities.service";

describe("DbCapabilitiesService", () => {
  it("reports a required table and columns present", () => {
    const service = new DbCapabilitiesService();
    const snapshot: DbSchemaSnapshot = {
      tables: new Set(["workspace_test.person"]),
      columns: new Map([["workspace_test.person", new Set(["id", "name"])]]),
    };

    expect(
      service.snapshotHas(snapshot, {
        table: { schemaName: "workspace_test", tableName: "person" },
        columns: ["id", "name"],
      }),
    ).toBe(true);
  });

  it("reports a missing column absent", () => {
    const service = new DbCapabilitiesService();
    const snapshot: DbSchemaSnapshot = {
      tables: new Set(["workspace_test.person"]),
      columns: new Map([["workspace_test.person", new Set(["id", "name"])]]),
    };

    expect(
      service.snapshotHas(snapshot, {
        table: { schemaName: "workspace_test", tableName: "person" },
        columns: ["id", "foo"],
      }),
    ).toBe(false);
  });
});
