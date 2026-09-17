import { describe, expect, it, vi } from "vitest";

import { ApiRecordsReadService } from "../api-records-read.service";

/**
 * The server serves an included to-many relation through
 * QUERY_MAX_RECORDS_FROM_RELATION (60, compiled into twenty-shared) and in no
 * guaranteed order. A record whose relation is longer comes back truncated to its
 * OLDEST 60 with nothing on the response marking it partial — a wrong-state read
 * that looks complete. These tests pin the repair.
 */
describe("ApiRecordsReadService relation completion", () => {
  const RELATION_CEILING = 60;

  const activity = (n: number) => ({
    id: `a${n}`,
    createdAt: `2026-07-${String((n % 28) + 1).padStart(2, "0")}T00:00:0${n % 10}.000Z`,
  });

  /** The 60 the server sends back: the oldest, and out of order. */
  const truncatedAndShuffled = Array.from({ length: RELATION_CEILING }, (_, i) =>
    activity(i),
  ).reverse();

  const wholeTrail = Array.from({ length: 239 }, (_, i) => activity(i));

  function makeApi(embedded: unknown[]) {
    return {
      get: vi.fn().mockResolvedValue({
        data: { data: { opportunity: { id: "opp-1", name: "Doru", activities: embedded } } },
      }),
    };
  }

  it("re-reads a truncated relation whole, ascending by createdAt", async () => {
    const api = makeApi(truncatedAndShuffled);
    const service = new ApiRecordsReadService(api as any);
    vi.spyOn(service, "listAll").mockResolvedValue({ data: [...wholeTrail].reverse() } as any);

    const record = (await service.get("opportunities", "opp-1", {
      include: "activities",
    })) as Record<string, unknown>;
    const activities = record.activities as Array<{ createdAt: string }>;

    expect(activities).toHaveLength(239);
    expect(service.listAll).toHaveBeenCalledWith("activities", {
      filter: "opportunityId[eq]:opp-1",
      sort: "createdAt",
      order: "asc",
    });
  });

  it("asks for ascending order on an uncapped relation too, not only a truncated one", async () => {
    const short = [activity(5), activity(1), activity(3)];
    const api = makeApi(short);
    const service = new ApiRecordsReadService(api as any);
    const listAll = vi
      .spyOn(service, "listAll")
      .mockResolvedValue({ data: [activity(1), activity(3), activity(5)] } as any);

    const record = (await service.get("opportunities", "opp-1", {
      include: "activities",
    })) as Record<string, unknown>;
    const dates = (record.activities as Array<{ createdAt: string }>).map((a) => a.createdAt);

    // The embedded order the record carried is discarded, ordered or not.
    expect(listAll).toHaveBeenCalledWith("activities", {
      filter: "opportunityId[eq]:opp-1",
      sort: "createdAt",
      order: "asc",
    });
    expect(dates).toEqual([...dates].sort());
  });

  it("keeps what the record carried when the relation cannot be read as a collection", async () => {
    const api = makeApi(truncatedAndShuffled);
    const service = new ApiRecordsReadService(api as any);
    vi.spyOn(service, "listAll").mockRejectedValue(new Error("no such object"));

    const record = (await service.get("opportunities", "opp-1", {
      include: "activities",
    })) as Record<string, unknown>;
    const dates = (record.activities as Array<{ createdAt: string }>).map((a) => a.createdAt);

    // Nothing is lost, and what survived is at least ordered.
    expect(dates).toHaveLength(RELATION_CEILING);
    expect(dates).toEqual([...dates].sort());
  });

  it("leaves a to-one relation untouched", async () => {
    const api = {
      get: vi.fn().mockResolvedValue({
        data: { data: { opportunity: { id: "opp-1", company: { id: "c1", name: "IAK" } } } },
      }),
    };
    const service = new ApiRecordsReadService(api as any);
    const listAll = vi.spyOn(service, "listAll");

    const record = (await service.get("opportunities", "opp-1", {
      include: "company",
    })) as Record<string, unknown>;

    expect(record.company).toEqual({ id: "c1", name: "IAK" });
    expect(listAll).not.toHaveBeenCalled();
  });

  it("does not page anything when no include is asked for", async () => {
    const api = makeApi(truncatedAndShuffled);
    const service = new ApiRecordsReadService(api as any);
    const listAll = vi.spyOn(service, "listAll");

    await service.get("opportunities", "opp-1");

    expect(listAll).not.toHaveBeenCalled();
  });
});
