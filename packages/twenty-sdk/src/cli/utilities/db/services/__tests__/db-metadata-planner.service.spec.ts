import { describe, expect, it, vi } from "vitest";

import { DbMetadataPlannerService } from "../db-metadata-planner.service";

describe("DbMetadataPlannerService", () => {
  it("preserves Twenty camelCase object names as record table names", async () => {
    const service = new DbMetadataPlannerService({
      listObjects: vi.fn().mockResolvedValue([
        {
          id: "calendar-channel-id",
          nameSingular: "calendarChannel",
          namePlural: "calendarChannels",
        },
      ]),
      getObject: vi.fn(),
    });

    const plan = await service.planObject("calendarChannels");

    expect(plan.tableName).toBe("calendarChannel");
  });
});
