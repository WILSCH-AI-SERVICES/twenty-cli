import { describe, it, expect } from "vitest";

import { resolveSearchProjection, joinLabelParts } from "../db-search-projection";

describe("resolveSearchProjection", () => {
  const personObject = {
    id: "obj-person",
    nameSingular: "person",
    namePlural: "people",
    labelIdentifierFieldMetadataId: "field-name",
    imageIdentifierFieldMetadataId: "field-avatar",
    fields: [
      { id: "field-name", name: "name", type: "FULL_NAME" },
      { id: "field-avatar", name: "avatarFile", type: "TEXT" },
      { id: "field-id", name: "id", type: "UUID" },
    ],
  };

  const taskObject = {
    id: "obj-task",
    nameSingular: "task",
    namePlural: "tasks",
    labelIdentifierFieldMetadataId: "field-title",
    imageIdentifierFieldMetadataId: null,
    fields: [{ id: "field-title", name: "title", type: "TEXT" }],
  };

  const companyNoImage = {
    id: "obj-company",
    nameSingular: "company",
    namePlural: "companies",
    labelIdentifierFieldMetadataId: "field-name",
    imageIdentifierFieldMetadataId: null,
    fields: [{ id: "field-name", name: "name", type: "TEXT" }],
  };

  it("returns FULL_NAME label as two columns", () => {
    const p = resolveSearchProjection(personObject as any);
    expect(p.labelColumns).toEqual(["nameFirstName", "nameLastName"]);
    expect(p.labelType).toBe("FULL_NAME");
  });

  it("returns simple text label as one column", () => {
    const p = resolveSearchProjection(taskObject as any);
    expect(p.labelColumns).toEqual(["title"]);
    expect(p.labelType).toBe("TEXT");
  });

  it("returns image column when imageIdentifierFieldMetadataId is set", () => {
    expect(resolveSearchProjection(personObject as any).imageColumn).toBe("avatarFile");
  });

  it("returns null image column when no field id and no hardcoded fallback", () => {
    expect(resolveSearchProjection(taskObject as any).imageColumn).toBeNull();
  });

  it("uses hardcoded image fallback for company when fieldMetadataId is null", () => {
    expect(resolveSearchProjection(companyNoImage as any).imageColumn).toBe(
      "domainNamePrimaryLinkUrl",
    );
  });

  it("uses hardcoded image fallback for person", () => {
    const personNoImage = { ...personObject, imageIdentifierFieldMetadataId: null };
    expect(resolveSearchProjection(personNoImage as any).imageColumn).toBe("avatarFile");
  });

  it("uses hardcoded image fallback for workspaceMember", () => {
    const wm = {
      ...taskObject,
      nameSingular: "workspaceMember",
      namePlural: "workspaceMembers",
    };
    expect(resolveSearchProjection(wm as any).imageColumn).toBe("avatarUrl");
  });

  it("throws if labelIdentifierFieldMetadataId is null", () => {
    const broken = { ...personObject, labelIdentifierFieldMetadataId: null };
    expect(() => resolveSearchProjection(broken as any)).toThrow(/label identifier/i);
  });

  it("throws if labelIdentifier field id doesn't appear in fields[]", () => {
    const broken = { ...personObject, labelIdentifierFieldMetadataId: "missing-id" };
    expect(() => resolveSearchProjection(broken as any)).toThrow(/not found/i);
  });
});

describe("joinLabelParts", () => {
  it("joins non-empty parts with a space", () => {
    expect(joinLabelParts(["John", "Doe"])).toBe("John Doe");
    expect(joinLabelParts(["John"])).toBe("John");
  });

  it("filters out null/undefined/empty parts", () => {
    expect(joinLabelParts(["John", null, "Doe"])).toBe("John Doe");
    expect(joinLabelParts([null, undefined, ""])).toBe("");
    expect(joinLabelParts(["", "Wang"])).toBe("Wang");
  });

  it("trims trailing whitespace", () => {
    expect(joinLabelParts(["John", ""])).toBe("John");
  });
});
