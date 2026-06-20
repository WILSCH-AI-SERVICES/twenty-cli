import { describe, it, expect, vi } from "vitest";

import { runGroupByOperation } from "../group-by.operation";

describe("runGroupByOperation", () => {
  it("sends groupBy in query params when --field is provided without payload", async () => {
    const mockResponse = { data: { groups: [] } };
    const ctx = {
      object: "people",
      options: { field: "city" },
      globalOptions: { output: "json" },
      services: {
        records: {
          groupBy: vi.fn().mockResolvedValue(mockResponse),
        },
        output: {
          render: vi.fn(),
        },
      },
    };

    await runGroupByOperation(ctx as any);

    expect(ctx.services.records.groupBy).toHaveBeenCalledWith(
      "people",
      { groupBy: [{ city: true }] },
      undefined,
    );
  });

  it("sends payload as POST body when --data is provided", async () => {
    const mockResponse = { data: { groups: [] } };
    const ctx = {
      object: "people",
      options: { data: '{"groupBy":"status","filter":{"city":{"eq":"NYC"}}}' },
      globalOptions: { output: "json" },
      services: {
        records: {
          groupBy: vi.fn().mockResolvedValue(mockResponse),
        },
        output: {
          render: vi.fn(),
        },
      },
    };

    await runGroupByOperation(ctx as any);

    expect(ctx.services.records.groupBy).toHaveBeenCalledWith(
      "people",
      { groupBy: [{ status: true }], filter: { city: { eq: "NYC" } } },
      undefined,
    );
  });
});
