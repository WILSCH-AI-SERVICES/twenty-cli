import { describe, it, expect } from "vitest";

import {
  encodeRecordCursor,
  decodeRecordCursor,
  buildKeysetWhereClause,
  type RecordListCursor,
} from "../db-records-cursor";

describe("encodeRecordCursor / decodeRecordCursor", () => {
  it("round-trips a populated cursor", () => {
    const c: RecordListCursor = {
      lastSortValue: "2026-04-13T03:45:18.171Z",
      lastId: "uuid-1",
      sortField: "createdAt",
      sortDirection: "desc",
    };
    expect(decodeRecordCursor(encodeRecordCursor(c))).toEqual(c);
  });

  it("round-trips a null lastSortValue", () => {
    const c: RecordListCursor = {
      lastSortValue: null,
      lastId: "uuid-1",
      sortField: "deletedAt",
      sortDirection: "asc",
    };
    expect(decodeRecordCursor(encodeRecordCursor(c))).toEqual(c);
  });

  it("round-trips a numeric lastSortValue", () => {
    const c: RecordListCursor = {
      lastSortValue: 42,
      lastId: "uuid-1",
      sortField: "position",
      sortDirection: "asc",
    };
    expect(decodeRecordCursor(encodeRecordCursor(c))).toEqual(c);
  });

  it("encoding produces base64-JSON (verifiable shape)", () => {
    const c: RecordListCursor = {
      lastSortValue: "2026-04-13T03:45:18.171Z",
      lastId: "uuid-1",
      sortField: "createdAt",
      sortDirection: "desc",
    };
    const encoded = encodeRecordCursor(c);
    const decoded = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
    expect(decoded).toEqual(c);
  });

  it("decode returns null for invalid base64", () => {
    expect(decodeRecordCursor("!!!not-base64!!!")).toBeNull();
  });

  it("decode returns null for legacy db:<offset> format", () => {
    expect(decodeRecordCursor("db:0")).toBeNull();
    expect(decodeRecordCursor("db:42")).toBeNull();
  });

  it("decode returns null for valid base64 but malformed JSON", () => {
    const bad = Buffer.from("not json", "utf8").toString("base64");
    expect(decodeRecordCursor(bad)).toBeNull();
  });

  it("decode returns null for valid base64 but missing required fields", () => {
    const bad = Buffer.from(JSON.stringify({ foo: "bar" }), "utf8").toString("base64");
    expect(decodeRecordCursor(bad)).toBeNull();
  });

  it("decode returns null when lastId is missing", () => {
    const bad = Buffer.from(
      JSON.stringify({
        lastSortValue: "x",
        sortField: "createdAt",
        sortDirection: "desc",
      }),
      "utf8",
    ).toString("base64");
    expect(decodeRecordCursor(bad)).toBeNull();
  });

  it("decode returns null when sortField is missing", () => {
    const bad = Buffer.from(
      JSON.stringify({
        lastSortValue: "x",
        lastId: "id",
        sortDirection: "desc",
      }),
      "utf8",
    ).toString("base64");
    expect(decodeRecordCursor(bad)).toBeNull();
  });

  it("decode returns null for invalid sortDirection", () => {
    const bad = Buffer.from(
      JSON.stringify({
        lastSortValue: "x",
        lastId: "id",
        sortField: "createdAt",
        sortDirection: "sideways",
      }),
      "utf8",
    ).toString("base64");
    expect(decodeRecordCursor(bad)).toBeNull();
  });

  it("decode returns null for unsupported lastSortValue type (e.g. boolean)", () => {
    const bad = Buffer.from(
      JSON.stringify({
        lastSortValue: true,
        lastId: "id",
        sortField: "createdAt",
        sortDirection: "desc",
      }),
      "utf8",
    ).toString("base64");
    expect(decodeRecordCursor(bad)).toBeNull();
  });
});

describe("buildKeysetWhereClause", () => {
  it("desc sort uses < comparator with id > tiebreaker", () => {
    const c: RecordListCursor = {
      lastSortValue: "2026-04-13",
      lastId: "uuid-1",
      sortField: "createdAt",
      sortDirection: "desc",
    };
    const { sql, params } = buildKeysetWhereClause(c, /* paramOffset */ 3);
    expect(sql).toMatch(/t\."createdAt"\s*<\s*\$3/);
    expect(sql).toMatch(/t\."createdAt"\s*=\s*\$3/);
    expect(sql).toMatch(/t\."id"::text\s*>\s*\$4/);
    expect(params).toEqual(["2026-04-13", "uuid-1"]);
  });

  it("asc sort uses > comparator", () => {
    const c: RecordListCursor = {
      lastSortValue: "Acme",
      lastId: "uuid-1",
      sortField: "name",
      sortDirection: "asc",
    };
    const { sql, params } = buildKeysetWhereClause(c, 3);
    expect(sql).toMatch(/t\."name"\s*>\s*\$3/);
    expect(sql).toMatch(/t\."name"\s*=\s*\$3/);
    expect(sql).toMatch(/t\."id"::text\s*>\s*\$4/);
    expect(params).toEqual(["Acme", "uuid-1"]);
  });

  it("escapes sortField as a SQL identifier", () => {
    const c: RecordListCursor = {
      lastSortValue: "x",
      lastId: "id",
      sortField: 'a"b',
      sortDirection: "desc",
    };
    const { sql } = buildKeysetWhereClause(c, 1);
    // Identifier must be quoted with " escaped as ""
    expect(sql).toContain(`t."a""b"`);
  });

  it("respects paramOffset for placeholder numbers", () => {
    const c: RecordListCursor = {
      lastSortValue: "x",
      lastId: "id",
      sortField: "createdAt",
      sortDirection: "desc",
    };
    const { sql } = buildKeysetWhereClause(c, 7);
    expect(sql).toMatch(/\$7/);
    expect(sql).toMatch(/\$8/);
    expect(sql).not.toMatch(/\$9/);
  });
});
