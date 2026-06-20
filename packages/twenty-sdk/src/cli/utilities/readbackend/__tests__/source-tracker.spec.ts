import { describe, expect, it } from "vitest";

import { SourceTracker } from "../types";

describe("SourceTracker", () => {
  it("reports db when only db reads happened", () => {
    const tracker = new SourceTracker();

    tracker.mark("db");

    expect(tracker.outputSource()).toBe("db");
  });

  it("reports mixed when both db and api happened", () => {
    const tracker = new SourceTracker();

    tracker.mark("db");
    tracker.mark("api");

    expect(tracker.outputSource()).toBe("mixed");
  });

  it("records the last fallback reason", () => {
    const tracker = new SourceTracker();

    tracker.recordFallback("undefined_column (42703)");

    expect(tracker.lastFallbackReason).toContain("42703");
  });

  it("returns no output metadata before a read source is observed", () => {
    const tracker = new SourceTracker();

    expect(tracker.outputMetadata()).toBeUndefined();
  });

  it("exposes structured fallback metadata only after a fallback", () => {
    const tracker = new SourceTracker();

    tracker.mark("db");
    expect(tracker.outputMetadata()).toEqual({ read: { source: "db" } });

    tracker.recordFallback("schema drift (42703)");
    tracker.mark("api");

    expect(tracker.outputMetadata()).toEqual({
      read: {
        source: "mixed",
        fallback: {
          from: "db",
          to: "api",
          reason: "schema drift (42703)",
        },
      },
    });
  });
});
