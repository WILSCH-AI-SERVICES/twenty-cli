import { describe, it, expect, vi } from "vitest";

import { MetadataService } from "../metadata.service";

describe("MetadataService", () => {
  describe("listObjects", () => {
    it("returns array of objects", async () => {
      const mockApi = {
        get: vi.fn().mockResolvedValue({
          data: { data: { objects: [{ id: "1", nameSingular: "person" }] } },
        }),
      };

      const service = new MetadataService(mockApi as any);
      const result = await service.listObjects();

      expect(mockApi.get).toHaveBeenCalledWith("/rest/metadata/objects");
      expect(result).toHaveLength(1);
      expect(result[0].nameSingular).toBe("person");
    });

    it("returns empty array when no objects", async () => {
      const mockApi = {
        get: vi.fn().mockResolvedValue({
          data: { data: { objects: [] } },
        }),
      };

      const service = new MetadataService(mockApi as any);
      const result = await service.listObjects();

      expect(result).toEqual([]);
    });

    it("handles missing data gracefully", async () => {
      const mockApi = {
        get: vi.fn().mockResolvedValue({ data: {} }),
      };

      const service = new MetadataService(mockApi as any);
      const result = await service.listObjects();

      expect(result).toEqual([]);
    });
  });

  describe("getObject", () => {
    it("fetches by ID when UUID provided", async () => {
      const uuid = "12345678-1234-5678-9012-123456789012";
      const mockApi = {
        get: vi.fn().mockResolvedValue({
          data: { data: { object: { id: uuid, nameSingular: "person" } } },
        }),
      };

      const service = new MetadataService(mockApi as any);
      const result = await service.getObject(uuid);

      expect(mockApi.get).toHaveBeenCalledWith(`/rest/metadata/objects/${uuid}`);
      expect(result.nameSingular).toBe("person");
    });

    it("looks up by nameSingular when non-UUID provided", async () => {
      const mockApi = {
        get: vi
          .fn()
          .mockResolvedValueOnce({
            data: {
              data: { objects: [{ id: "obj-id", nameSingular: "person", namePlural: "people" }] },
            },
          })
          .mockResolvedValueOnce({
            data: { data: { object: { id: "obj-id", nameSingular: "person", fields: [] } } },
          }),
      };

      const service = new MetadataService(mockApi as any);
      const result = await service.getObject("person");

      expect(mockApi.get).toHaveBeenCalledWith("/rest/metadata/objects");
      expect(mockApi.get).toHaveBeenCalledWith("/rest/metadata/objects/obj-id");
      expect(result.id).toBe("obj-id");
    });

    it("looks up by namePlural when non-UUID provided", async () => {
      const mockApi = {
        get: vi
          .fn()
          .mockResolvedValueOnce({
            data: {
              data: { objects: [{ id: "obj-id", nameSingular: "person", namePlural: "people" }] },
            },
          })
          .mockResolvedValueOnce({
            data: { data: { object: { id: "obj-id", nameSingular: "person" } } },
          }),
      };

      const service = new MetadataService(mockApi as any);
      await service.getObject("people");

      expect(mockApi.get).toHaveBeenCalledWith("/rest/metadata/objects");
      expect(mockApi.get).toHaveBeenCalledWith("/rest/metadata/objects/obj-id");
    });

    it("throws when object not found by name", async () => {
      const mockApi = {
        get: vi.fn().mockResolvedValue({
          data: { data: { objects: [{ id: "1", nameSingular: "task" }] } },
        }),
      };

      const service = new MetadataService(mockApi as any);

      await expect(service.getObject("nonexistent")).rejects.toThrow(
        "Object not found: nonexistent",
      );
    });

    it("handles fallback data structure for direct ID lookup", async () => {
      const uuid = "12345678-1234-5678-9012-123456789012";
      const mockApi = {
        get: vi.fn().mockResolvedValue({
          data: { data: { id: uuid, nameSingular: "widget" } },
        }),
      };

      const service = new MetadataService(mockApi as any);
      const result = await service.getObject(uuid);

      expect(result.id).toBe(uuid);
      expect(result.nameSingular).toBe("widget");
    });
  });

  describe("listFields", () => {
    it("returns array of fields", async () => {
      const mockApi = {
        get: vi.fn().mockResolvedValue({
          data: { data: { fields: [{ id: "1", name: "email" }] } },
        }),
      };

      const service = new MetadataService(mockApi as any);
      const result = await service.listFields();

      expect(mockApi.get).toHaveBeenCalledWith("/rest/metadata/fields");
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("1");
    });

    it("returns empty array when no fields", async () => {
      const mockApi = {
        get: vi.fn().mockResolvedValue({
          data: { data: { fields: [] } },
        }),
      };

      const service = new MetadataService(mockApi as any);
      const result = await service.listFields();

      expect(result).toEqual([]);
    });

    it("handles missing data gracefully", async () => {
      const mockApi = {
        get: vi.fn().mockResolvedValue({ data: {} }),
      };

      const service = new MetadataService(mockApi as any);
      const result = await service.listFields();

      expect(result).toEqual([]);
    });
  });

  describe("getField", () => {
    it("fetches field by ID", async () => {
      const mockApi = {
        get: vi.fn().mockResolvedValue({
          data: { data: { field: { id: "f1", name: "email" } } },
        }),
      };

      const service = new MetadataService(mockApi as any);
      const result = await service.getField("f1");

      expect(mockApi.get).toHaveBeenCalledWith("/rest/metadata/fields/f1");
      expect(result.id).toBe("f1");
    });

    it("handles fallback data structure", async () => {
      const mockApi = {
        get: vi.fn().mockResolvedValue({
          data: { data: { id: "f2", name: "phone" } },
        }),
      };

      const service = new MetadataService(mockApi as any);
      const result = await service.getField("f2");

      expect(result.id).toBe("f2");
    });
  });

  describe("createObject", () => {
    it("posts new object definition", async () => {
      const mockApi = {
        post: vi.fn().mockResolvedValue({
          data: { data: { createObject: { id: "new-id" } } },
        }),
      };

      const service = new MetadataService(mockApi as any);
      const result = await service.createObject({ nameSingular: "widget", namePlural: "widgets" });

      expect(mockApi.post).toHaveBeenCalledWith("/rest/metadata/objects", {
        nameSingular: "widget",
        namePlural: "widgets",
      });
      expect(result).toEqual({ data: { createObject: { id: "new-id" } } });
    });

    it("returns null when response has no data", async () => {
      const mockApi = {
        post: vi.fn().mockResolvedValue({}),
      };

      const service = new MetadataService(mockApi as any);
      const result = await service.createObject({ nameSingular: "test" });

      expect(result).toBeNull();
    });
  });

  describe("createField", () => {
    it("posts new field definition", async () => {
      const mockApi = {
        post: vi.fn().mockResolvedValue({
          data: { data: { createField: { id: "new-field-id" } } },
        }),
      };

      const service = new MetadataService(mockApi as any);
      const result = await service.createField({
        objectMetadataId: "obj-1",
        name: "rating",
        type: "NUMBER",
      });

      expect(mockApi.post).toHaveBeenCalledWith("/rest/metadata/fields", {
        objectMetadataId: "obj-1",
        name: "rating",
        type: "NUMBER",
      });
      expect(result).toEqual({ data: { createField: { id: "new-field-id" } } });
    });

    it("returns null when response has no data", async () => {
      const mockApi = {
        post: vi.fn().mockResolvedValue({}),
      };

      const service = new MetadataService(mockApi as any);
      const result = await service.createField({ name: "test" });

      expect(result).toBeNull();
    });
  });

  describe("updateObject", () => {
    it("calls PATCH with correct endpoint and data", async () => {
      const mockApi = {
        patch: vi.fn().mockResolvedValue({
          data: { data: { object: { id: "obj-1", nameSingular: "updated" } } },
        }),
      };

      const service = new MetadataService(mockApi as any);
      const result = await service.updateObject("obj-1", { nameSingular: "updated" });

      expect(mockApi.patch).toHaveBeenCalledWith("/rest/metadata/objects/obj-1", {
        nameSingular: "updated",
      });
      expect(result).toEqual({ data: { object: { id: "obj-1", nameSingular: "updated" } } });
    });

    it("returns null when response has no data", async () => {
      const mockApi = {
        patch: vi.fn().mockResolvedValue({}),
      };

      const service = new MetadataService(mockApi as any);
      const result = await service.updateObject("obj-1", { nameSingular: "test" });

      expect(result).toBeNull();
    });
  });

  describe("deleteObject", () => {
    it("calls DELETE with correct endpoint", async () => {
      const mockApi = {
        delete: vi.fn().mockResolvedValue({}),
      };

      const service = new MetadataService(mockApi as any);
      await service.deleteObject("obj-1");

      expect(mockApi.delete).toHaveBeenCalledWith("/rest/metadata/objects/obj-1");
    });
  });

  describe("updateField", () => {
    it("calls PATCH with correct endpoint and data", async () => {
      const mockApi = {
        patch: vi.fn().mockResolvedValue({
          data: { data: { field: { id: "f1", name: "updatedField" } } },
        }),
      };

      const service = new MetadataService(mockApi as any);
      const result = await service.updateField("f1", { name: "updatedField" });

      expect(mockApi.patch).toHaveBeenCalledWith("/rest/metadata/fields/f1", {
        name: "updatedField",
      });
      expect(result).toEqual({ data: { field: { id: "f1", name: "updatedField" } } });
    });

    it("returns null when response has no data", async () => {
      const mockApi = {
        patch: vi.fn().mockResolvedValue({}),
      };

      const service = new MetadataService(mockApi as any);
      const result = await service.updateField("f1", { name: "test" });

      expect(result).toBeNull();
    });
  });

  describe("deleteField", () => {
    it("calls DELETE with correct endpoint", async () => {
      const mockApi = {
        delete: vi.fn().mockResolvedValue({}),
      };

      const service = new MetadataService(mockApi as any);
      await service.deleteField("f1");

      expect(mockApi.delete).toHaveBeenCalledWith("/rest/metadata/fields/f1");
    });
  });

  describe("UI metadata resources", () => {
    const resourceCases = [
      {
        label: "views",
        listMethod: "listViews",
        getMethod: "getView",
        createMethod: "createView",
        updateMethod: "updateView",
        deleteMethod: "deleteView",
        endpoint: "/rest/metadata/views",
        listKey: "views",
        singleKey: "view",
        listParams: { objectMetadataId: "obj-1" },
        deleteData: { success: true },
      },
      {
        label: "view fields",
        listMethod: "listViewFields",
        getMethod: "getViewField",
        createMethod: "createViewField",
        updateMethod: "updateViewField",
        deleteMethod: "deleteViewField",
        endpoint: "/rest/metadata/viewFields",
        listKey: "viewFields",
        singleKey: "viewField",
        listParams: { viewId: "view-1" },
        deleteData: { success: true },
      },
      {
        label: "view filters",
        listMethod: "listViewFilters",
        getMethod: "getViewFilter",
        createMethod: "createViewFilter",
        updateMethod: "updateViewFilter",
        deleteMethod: "deleteViewFilter",
        endpoint: "/rest/metadata/viewFilters",
        listKey: "viewFilters",
        singleKey: "viewFilter",
        listParams: { viewId: "view-1" },
        deleteData: { success: true },
      },
      {
        label: "view filter groups",
        listMethod: "listViewFilterGroups",
        getMethod: "getViewFilterGroup",
        createMethod: "createViewFilterGroup",
        updateMethod: "updateViewFilterGroup",
        deleteMethod: "deleteViewFilterGroup",
        endpoint: "/rest/metadata/viewFilterGroups",
        listKey: "viewFilterGroups",
        singleKey: "viewFilterGroup",
        listParams: { viewId: "view-1" },
        deleteData: { success: true },
      },
      {
        label: "view groups",
        listMethod: "listViewGroups",
        getMethod: "getViewGroup",
        createMethod: "createViewGroup",
        updateMethod: "updateViewGroup",
        deleteMethod: "deleteViewGroup",
        endpoint: "/rest/metadata/viewGroups",
        listKey: "viewGroups",
        singleKey: "viewGroup",
        listParams: { viewId: "view-1" },
        deleteData: { success: true },
      },
      {
        label: "view sorts",
        listMethod: "listViewSorts",
        getMethod: "getViewSort",
        createMethod: "createViewSort",
        updateMethod: "updateViewSort",
        deleteMethod: "deleteViewSort",
        endpoint: "/rest/metadata/viewSorts",
        listKey: "viewSorts",
        singleKey: "viewSort",
        listParams: { viewId: "view-1" },
        deleteData: { success: true },
      },
      {
        label: "page layouts",
        listMethod: "listPageLayouts",
        getMethod: "getPageLayout",
        createMethod: "createPageLayout",
        updateMethod: "updatePageLayout",
        deleteMethod: "deletePageLayout",
        endpoint: "/rest/metadata/pageLayouts",
        listKey: "pageLayouts",
        singleKey: "pageLayout",
        listParams: {
          objectMetadataId: "obj-1",
          pageLayoutType: "RECORD_PAGE",
        },
        deleteData: true,
      },
      {
        label: "page layout tabs",
        listMethod: "listPageLayoutTabs",
        getMethod: "getPageLayoutTab",
        createMethod: "createPageLayoutTab",
        updateMethod: "updatePageLayoutTab",
        deleteMethod: "deletePageLayoutTab",
        endpoint: "/rest/metadata/pageLayoutTabs",
        listKey: "pageLayoutTabs",
        singleKey: "pageLayoutTab",
        listParams: { pageLayoutId: "layout-1" },
        deleteData: true,
      },
      {
        label: "page layout widgets",
        listMethod: "listPageLayoutWidgets",
        getMethod: "getPageLayoutWidget",
        createMethod: "createPageLayoutWidget",
        updateMethod: "updatePageLayoutWidget",
        deleteMethod: "deletePageLayoutWidget",
        endpoint: "/rest/metadata/pageLayoutWidgets",
        listKey: "pageLayoutWidgets",
        singleKey: "pageLayoutWidget",
        listParams: { pageLayoutTabId: "tab-1" },
        deleteData: true,
      },
    ] as const;

    describe.each(resourceCases)("$label", (resource) => {
      it("lists resources with query params", async () => {
        const mockApi = {
          get: vi.fn().mockResolvedValue({
            data: { data: { [resource.listKey]: [{ id: "resource-1" }] } },
          }),
        };

        const service = new MetadataService(mockApi as any);
        const result = await (service as any)[resource.listMethod](resource.listParams);

        expect(mockApi.get).toHaveBeenCalledWith(resource.endpoint, {
          params: resource.listParams,
        });
        expect(result).toEqual([{ id: "resource-1" }]);
      });

      it("gets a single resource", async () => {
        const mockApi = {
          get: vi.fn().mockResolvedValue({
            data: { data: { [resource.singleKey]: { id: "resource-1" } } },
          }),
        };

        const service = new MetadataService(mockApi as any);
        const result = await (service as any)[resource.getMethod]("resource-1");

        expect(mockApi.get).toHaveBeenCalledWith(`${resource.endpoint}/resource-1`);
        expect(result).toEqual({ id: "resource-1" });
      });

      it("creates a resource", async () => {
        const mockApi = {
          post: vi.fn().mockResolvedValue({
            data: { data: { [resource.singleKey]: { id: "resource-1" } } },
          }),
        };

        const service = new MetadataService(mockApi as any);
        const payload = { name: "Example" };
        const result = await (service as any)[resource.createMethod](payload);

        expect(mockApi.post).toHaveBeenCalledWith(resource.endpoint, payload);
        expect(result).toEqual({ data: { [resource.singleKey]: { id: "resource-1" } } });
      });

      it("updates a resource", async () => {
        const mockApi = {
          patch: vi.fn().mockResolvedValue({
            data: { data: { [resource.singleKey]: { id: "resource-1", name: "Updated" } } },
          }),
        };

        const service = new MetadataService(mockApi as any);
        const payload = { name: "Updated" };
        const result = await (service as any)[resource.updateMethod]("resource-1", payload);

        expect(mockApi.patch).toHaveBeenCalledWith(`${resource.endpoint}/resource-1`, payload);
        expect(result).toEqual({
          data: { [resource.singleKey]: { id: "resource-1", name: "Updated" } },
        });
      });

      it("deletes a resource", async () => {
        const mockApi = {
          delete: vi.fn().mockResolvedValue({
            data: resource.deleteData,
          }),
        };

        const service = new MetadataService(mockApi as any);
        const result = await (service as any)[resource.deleteMethod]("resource-1");

        expect(mockApi.delete).toHaveBeenCalledWith(`${resource.endpoint}/resource-1`);
        expect(result).toBe(true);
      });
    });

    it("supports direct array responses for view lists", async () => {
      const mockApi = {
        get: vi.fn().mockResolvedValue({
          data: [{ id: "view-1", name: "All People" }],
        }),
      };

      const service = new MetadataService(mockApi as any);
      const result = await (service as any).listViews();

      expect(mockApi.get).toHaveBeenCalledWith("/rest/metadata/views");
      expect(result).toEqual([{ id: "view-1", name: "All People" }]);
    });

    it("supports direct object responses for single view fetches", async () => {
      const mockApi = {
        get: vi.fn().mockResolvedValue({
          data: { id: "view-1", name: "All People" },
        }),
      };

      const service = new MetadataService(mockApi as any);
      const result = await (service as any).getView("view-1");

      expect(result).toEqual({ id: "view-1", name: "All People" });
    });

    it("returns false when a wrapped delete response reports failure", async () => {
      const mockApi = {
        delete: vi.fn().mockResolvedValue({
          data: { success: false },
        }),
      };

      const service = new MetadataService(mockApi as any);
      const result = await (service as any).deleteView("view-1");

      expect(result).toBe(false);
    });

    it("returns false when a boolean delete response reports failure", async () => {
      const mockApi = {
        delete: vi.fn().mockResolvedValue({
          data: false,
        }),
      };

      const service = new MetadataService(mockApi as any);
      const result = await (service as any).deletePageLayout("layout-1");

      expect(result).toBe(false);
    });
  });

  describe("metadata graphql resources", () => {
    const resourceCases = [
      {
        label: "command menu items",
        listMethod: "listCommandMenuItems",
        getMethod: "getCommandMenuItem",
        createMethod: "createCommandMenuItem",
        updateMethod: "updateCommandMenuItem",
        deleteMethod: "deleteCommandMenuItem",
        listField: "commandMenuItems",
        getField: "commandMenuItem",
        createField: "createCommandMenuItem",
        updateField: "updateCommandMenuItem",
        deleteField: "deleteCommandMenuItem",
        updateVariables: {
          input: {
            id: "resource-1",
            label: "Updated",
          },
        },
        updatePayload: {
          label: "Updated",
        },
      },
      {
        label: "front components",
        listMethod: "listFrontComponents",
        getMethod: "getFrontComponent",
        createMethod: "createFrontComponent",
        updateMethod: "updateFrontComponent",
        deleteMethod: "deleteFrontComponent",
        listField: "frontComponents",
        getField: "frontComponent",
        createField: "createFrontComponent",
        updateField: "updateFrontComponent",
        deleteField: "deleteFrontComponent",
        updateVariables: {
          input: {
            id: "resource-1",
            update: {
              name: "Updated",
            },
          },
        },
        updatePayload: {
          name: "Updated",
        },
      },
      {
        label: "navigation menu items",
        listMethod: "listNavigationMenuItems",
        getMethod: "getNavigationMenuItem",
        createMethod: "createNavigationMenuItem",
        updateMethod: "updateNavigationMenuItem",
        deleteMethod: "deleteNavigationMenuItem",
        listField: "navigationMenuItems",
        getField: "navigationMenuItem",
        createField: "createNavigationMenuItem",
        updateField: "updateNavigationMenuItem",
        deleteField: "deleteNavigationMenuItem",
        updateVariables: {
          input: {
            id: "resource-1",
            update: {
              name: "Updated",
            },
          },
        },
        updatePayload: {
          name: "Updated",
        },
      },
    ] as const;

    describe.each(resourceCases)("$label", (resource) => {
      it("lists resources", async () => {
        const mockApi = {
          post: vi.fn().mockResolvedValue({
            data: { data: { [resource.listField]: [{ id: "resource-1" }] } },
          }),
        };

        const service = new MetadataService(mockApi as any);
        const result = await (service as any)[resource.listMethod]();

        expect(mockApi.post).toHaveBeenCalledWith(
          "/metadata",
          expect.objectContaining({
            query: expect.stringContaining(resource.listField),
          }),
        );
        expect(result).toEqual([{ id: "resource-1" }]);
      });

      it("gets a single resource", async () => {
        const mockApi = {
          post: vi.fn().mockResolvedValue({
            data: { data: { [resource.getField]: { id: "resource-1" } } },
          }),
        };

        const service = new MetadataService(mockApi as any);
        const result = await (service as any)[resource.getMethod]("resource-1");

        expect(mockApi.post).toHaveBeenCalledWith(
          "/metadata",
          expect.objectContaining({
            variables: { id: "resource-1" },
          }),
        );
        expect(mockApi.post.mock.calls[0][1].query).toContain(resource.getField);
        expect(mockApi.post.mock.calls[0][1].query).toContain("$id: UUID!");
        expect(result).toEqual({ id: "resource-1" });
      });

      it("creates a resource", async () => {
        const mockApi = {
          post: vi.fn().mockResolvedValue({
            data: { data: { [resource.createField]: { id: "resource-1" } } },
          }),
        };

        const service = new MetadataService(mockApi as any);
        const payload = { name: "Example" };
        const result = await (service as any)[resource.createMethod](payload);

        expect(mockApi.post).toHaveBeenCalledWith(
          "/metadata",
          expect.objectContaining({
            query: expect.stringContaining(resource.createField),
            variables: { input: payload },
          }),
        );
        expect(result).toEqual({ id: "resource-1" });
      });

      it("updates a resource", async () => {
        const mockApi = {
          post: vi.fn().mockResolvedValue({
            data: { data: { [resource.updateField]: { id: "resource-1", name: "Updated" } } },
          }),
        };

        const service = new MetadataService(mockApi as any);
        const payload = resource.updatePayload;
        const result = await (service as any)[resource.updateMethod]("resource-1", payload);

        expect(mockApi.post).toHaveBeenCalledWith(
          "/metadata",
          expect.objectContaining({
            query: expect.stringContaining(resource.updateField),
            variables: resource.updateVariables,
          }),
        );
        expect(result).toEqual({ id: "resource-1", name: "Updated" });
      });

      it("deletes a resource", async () => {
        const mockApi = {
          post: vi.fn().mockResolvedValue({
            data: { data: { [resource.deleteField]: { id: "resource-1" } } },
          }),
        };

        const service = new MetadataService(mockApi as any);
        const result = await (service as any)[resource.deleteMethod]("resource-1");

        expect(mockApi.post).toHaveBeenCalledWith(
          "/metadata",
          expect.objectContaining({
            query: expect.stringContaining(resource.deleteField),
            variables: { id: "resource-1" },
          }),
        );
        expect(result).toBe(true);
      });
    });

    it("returns false when a graphql delete response is empty", async () => {
      const mockApi = {
        post: vi.fn().mockResolvedValue({
          data: { data: { deleteCommandMenuItem: null } },
        }),
      };

      const service = new MetadataService(mockApi as any);
      const result = await (service as any).deleteCommandMenuItem("resource-1");

      expect(result).toBe(false);
    });

    it("does not request navigation menu identifier subfields inline", async () => {
      const mockApi = {
        post: vi.fn().mockResolvedValue({
          data: { data: { navigationMenuItems: [] } },
        }),
      };

      const service = new MetadataService(mockApi as any);
      await (service as any).listNavigationMenuItems();

      expect(mockApi.post).toHaveBeenCalledWith(
        "/metadata",
        expect.objectContaining({
          query: expect.not.stringContaining("targetRecordIdentifier"),
        }),
      );
    });
  });

  describe("listObjects memoization", () => {
    it("coalesces concurrent calls to a single HTTP request", async () => {
      const mockApi = {
        get: vi.fn().mockResolvedValue({
          data: { data: { objects: [{ id: "1", nameSingular: "person" }] } },
        }),
      };
      const service = new MetadataService(mockApi as any);

      const [a, b] = await Promise.all([service.listObjects(), service.listObjects()]);

      expect(mockApi.get).toHaveBeenCalledTimes(1);
      expect(a).toEqual(b);
    });

    it("memoizes successful responses across sequential calls", async () => {
      const mockApi = {
        get: vi.fn().mockResolvedValue({
          data: { data: { objects: [{ id: "1", nameSingular: "person" }] } },
        }),
      };
      const service = new MetadataService(mockApi as any);

      await service.listObjects();
      await service.listObjects();

      expect(mockApi.get).toHaveBeenCalledTimes(1);
    });

    it("retries after a failed fetch", async () => {
      const mockApi = {
        get: vi
          .fn()
          .mockRejectedValueOnce(new Error("network"))
          .mockResolvedValueOnce({
            data: { data: { objects: [{ id: "1", nameSingular: "person" }] } },
          }),
      };
      const service = new MetadataService(mockApi as any);

      await expect(service.listObjects()).rejects.toThrow("network");
      const second = await service.listObjects();

      expect(mockApi.get).toHaveBeenCalledTimes(2);
      expect(second).toHaveLength(1);
    });

    it("resetListObjectsCache forces the next call to hit HTTP", async () => {
      const mockApi = {
        get: vi.fn().mockResolvedValue({
          data: { data: { objects: [{ id: "1", nameSingular: "person" }] } },
        }),
      };
      const service = new MetadataService(mockApi as any);

      await service.listObjects();
      service.resetListObjectsCache();
      await service.listObjects();

      expect(mockApi.get).toHaveBeenCalledTimes(2);
    });
  });

  describe("listObjects on-disk cache", () => {
    it("returns cached schema without calling the API when fresh", async () => {
      const mockApi = { get: vi.fn() };
      const schemaCache = {
        readFreshSchema: vi.fn().mockResolvedValue({
          data: { objects: [{ id: "cached-1", nameSingular: "cached" }] },
        }),
        writeSchema: vi.fn(),
      };

      const service = new MetadataService(mockApi as any, schemaCache as any);
      const result = await service.listObjects();

      expect(schemaCache.readFreshSchema).toHaveBeenCalledWith("metadata-objects");
      expect(mockApi.get).not.toHaveBeenCalled();
      expect(schemaCache.writeSchema).not.toHaveBeenCalled();
      expect(result).toEqual([{ id: "cached-1", nameSingular: "cached" }]);
    });

    it("falls back to HTTP and writes to cache when no fresh entry exists", async () => {
      const mockApi = {
        get: vi.fn().mockResolvedValue({
          data: { data: { objects: [{ id: "http-1", nameSingular: "person" }] } },
        }),
      };
      const schemaCache = {
        readFreshSchema: vi.fn().mockResolvedValue(undefined),
        writeSchema: vi.fn().mockResolvedValue(undefined),
      };

      const service = new MetadataService(mockApi as any, schemaCache as any);
      const result = await service.listObjects();

      expect(schemaCache.readFreshSchema).toHaveBeenCalledWith("metadata-objects");
      expect(mockApi.get).toHaveBeenCalledWith("/rest/metadata/objects");
      expect(schemaCache.writeSchema).toHaveBeenCalledWith("metadata-objects", {
        data: { objects: [{ id: "http-1", nameSingular: "person" }] },
      });
      expect(result).toEqual([{ id: "http-1", nameSingular: "person" }]);
    });

    it("memoizer still coalesces concurrent calls when schemaCache is wired", async () => {
      const mockApi = {
        get: vi.fn().mockResolvedValue({
          data: { data: { objects: [{ id: "1", nameSingular: "person" }] } },
        }),
      };
      const schemaCache = {
        readFreshSchema: vi.fn().mockResolvedValue(undefined),
        writeSchema: vi.fn(),
      };
      const service = new MetadataService(mockApi as any, schemaCache as any);

      const [a, b] = await Promise.all([service.listObjects(), service.listObjects()]);

      expect(schemaCache.readFreshSchema).toHaveBeenCalledTimes(1);
      expect(mockApi.get).toHaveBeenCalledTimes(1);
      expect(a).toEqual(b);
    });

    it("works without a schemaCache (backward compatible)", async () => {
      const mockApi = {
        get: vi.fn().mockResolvedValue({
          data: { data: { objects: [{ id: "1", nameSingular: "person" }] } },
        }),
      };
      const service = new MetadataService(mockApi as any);
      const result = await service.listObjects();

      expect(mockApi.get).toHaveBeenCalledTimes(1);
      expect(result).toHaveLength(1);
    });

    it("does not crash if writeSchema rejects", async () => {
      const mockApi = {
        get: vi.fn().mockResolvedValue({
          data: { data: { objects: [{ id: "1", nameSingular: "person" }] } },
        }),
      };
      const schemaCache = {
        readFreshSchema: vi.fn().mockResolvedValue(undefined),
        writeSchema: vi.fn().mockRejectedValue(new Error("disk full")),
      };
      const service = new MetadataService(mockApi as any, schemaCache as any);

      const result = await service.listObjects();
      expect(result).toHaveLength(1);
    });
  });
});
