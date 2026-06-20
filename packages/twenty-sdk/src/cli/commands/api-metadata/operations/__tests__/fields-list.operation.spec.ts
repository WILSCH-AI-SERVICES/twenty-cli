import { describe, it, expect, vi } from "vitest";

import { runFieldsList } from "../fields-list.operation";

describe("runFieldsList", () => {
  it("returns fields from object when --object is provided", async () => {
    const mockFields = [
      { id: "f1", name: "email", objectMetadataId: "obj1" },
      { id: "f2", name: "phone", objectMetadataId: "obj2" },
    ];
    const mockObjectWithFields = {
      id: "person-id",
      nameSingular: "person",
      fields: [
        { id: "pf1", name: "firstName" },
        { id: "pf2", name: "lastName" },
      ],
    };

    const rendered: unknown[] = [];
    const ctx = {
      options: { object: "person" },
      globalOptions: { output: "json" },
      services: {
        metadata: {
          listFields: vi.fn().mockResolvedValue(mockFields),
          listObjects: vi
            .fn()
            .mockResolvedValue([{ id: "person-id", nameSingular: "person", namePlural: "people" }]),
          getObject: vi.fn().mockResolvedValue(mockObjectWithFields),
        },
        output: {
          render: vi.fn().mockImplementation((data) => {
            rendered.push(data);
          }),
        },
      },
    };

    await runFieldsList(ctx as any);

    // Should call getObject to get fields from the object, not filter listFields
    expect(ctx.services.metadata.getObject).toHaveBeenCalledWith("person");
    expect(rendered[0]).toHaveLength(2);
    expect((rendered[0] as any)[0].name).toBe("firstName");
  });

  it("returns all fields when --object is not provided", async () => {
    const mockFields = [
      { id: "f1", name: "email" },
      { id: "f2", name: "phone" },
    ];

    const rendered: unknown[] = [];
    const ctx = {
      options: {},
      globalOptions: { output: "json" },
      services: {
        metadata: {
          listFields: vi.fn().mockResolvedValue(mockFields),
        },
        output: {
          render: vi.fn().mockImplementation((data) => {
            rendered.push(data);
          }),
        },
      },
    };

    await runFieldsList(ctx as any);

    expect(ctx.services.metadata.listFields).toHaveBeenCalled();
    expect(rendered[0]).toHaveLength(2);
  });
});
