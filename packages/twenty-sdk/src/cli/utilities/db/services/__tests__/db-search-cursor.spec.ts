import { describe, it, expect } from "vitest";

import { encodeSearchCursor, decodeSearchCursor, type SearchCursor } from "../db-search-cursor";

describe("encodeSearchCursor / decodeSearchCursor", () => {
  it("round-trips an empty cursor", () => {
    const c: SearchCursor = {
      lastRanks: { tsRankCD: 0, tsRank: 0 },
      lastRecordIdsPerObject: {},
    };
    const encoded = encodeSearchCursor(c);
    const decoded = decodeSearchCursor(encoded);
    expect(decoded).toEqual(c);
  });

  it("round-trips a populated cursor", () => {
    const c: SearchCursor = {
      lastRanks: { tsRankCD: 0.5, tsRank: 0.3 },
      lastRecordIdsPerObject: {
        person: "uuid-person-1",
        company: "uuid-company-1",
      },
    };
    const decoded = decodeSearchCursor(encodeSearchCursor(c));
    expect(decoded).toEqual(c);
  });

  it("encoding produces base64-JSON (verifiable shape)", () => {
    const c: SearchCursor = {
      lastRanks: { tsRankCD: 0.1, tsRank: 0.05 },
      lastRecordIdsPerObject: { person: "id-1" },
    };
    const encoded = encodeSearchCursor(c);
    const decoded = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
    expect(decoded).toEqual(c);
  });

  it("decode returns null for invalid base64", () => {
    expect(decodeSearchCursor("!!!not-valid-base64!!!")).toBeNull();
  });

  it("decode returns null for valid base64 but wrong shape", () => {
    const bad = Buffer.from(JSON.stringify({ foo: "bar" }), "utf8").toString("base64");
    expect(decodeSearchCursor(bad)).toBeNull();
  });

  it("decode returns null for valid base64 but malformed JSON", () => {
    const bad = Buffer.from("not json", "utf8").toString("base64");
    expect(decodeSearchCursor(bad)).toBeNull();
  });

  it("decode returns null when lastRanks is missing", () => {
    const bad = Buffer.from(JSON.stringify({ lastRecordIdsPerObject: {} }), "utf8").toString(
      "base64",
    );
    expect(decodeSearchCursor(bad)).toBeNull();
  });

  it("decode returns null when lastRanks fields are wrong types", () => {
    const bad = Buffer.from(
      JSON.stringify({ lastRanks: { tsRankCD: "x", tsRank: 0 }, lastRecordIdsPerObject: {} }),
      "utf8",
    ).toString("base64");
    expect(decodeSearchCursor(bad)).toBeNull();
  });

  it("decode returns null when lastRecordIdsPerObject is missing", () => {
    const bad = Buffer.from(
      JSON.stringify({ lastRanks: { tsRankCD: 0, tsRank: 0 } }),
      "utf8",
    ).toString("base64");
    expect(decodeSearchCursor(bad)).toBeNull();
  });

  it("decode returns null when lastRecordIdsPerObject is null", () => {
    const bad = Buffer.from(
      JSON.stringify({ lastRanks: { tsRankCD: 0, tsRank: 0 }, lastRecordIdsPerObject: null }),
      "utf8",
    ).toString("base64");
    expect(decodeSearchCursor(bad)).toBeNull();
  });

  it("decode returns null for legacy db:<offset> cursor format", () => {
    expect(decodeSearchCursor("db:0")).toBeNull();
    expect(decodeSearchCursor("db:42")).toBeNull();
  });
});
