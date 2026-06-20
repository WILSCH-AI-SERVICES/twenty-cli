import { describe, it, expect, vi } from "vitest";

import { CliError } from "../../../../utilities/errors/cli-error";
import {
  runCommandMenuItemsList,
  runFrontComponentsUpdate,
  runNavigationMenuItemsList,
  runViewsList,
  runViewsGet,
  runViewFieldsCreate,
  runViewFiltersUpdate,
  runViewGroupsDelete,
  runViewSortsList,
  runPageLayoutsList,
  runPageLayoutTabsList,
  runPageLayoutWidgetsList,
} from "../ui-metadata.operations";

vi.mock("../../../../utilities/shared/body", () => ({
  parseBody: vi.fn().mockImplementation(async (data: string | undefined) => {
    if (data) return JSON.parse(data);
    return {};
  }),
}));

function createMockContext(overrides: Record<string, unknown> = {}) {
  return {
    arg: undefined,
    options: {},
    globalOptions: { output: "json", query: undefined },
    services: {
      metadata: {
        getObject: vi.fn().mockResolvedValue({
          id: "obj-1",
          nameSingular: "person",
          namePlural: "people",
        }),
        listViews: vi.fn().mockResolvedValue([{ id: "view-1", name: "All People" }]),
        getView: vi.fn().mockResolvedValue({ id: "view-1", name: "All People" }),
        createViewField: vi.fn().mockResolvedValue({ id: "vf-1", fieldMetadataId: "fld-1" }),
        updateViewFilter: vi
          .fn()
          .mockResolvedValue({ id: "filter-1", operand: "john@example.com" }),
        deleteViewGroup: vi.fn().mockResolvedValue(true),
        listViewSorts: vi.fn().mockResolvedValue([{ id: "sort-1", viewId: "view-1" }]),
        listPageLayouts: vi
          .fn()
          .mockResolvedValue([{ id: "layout-1", pageLayoutType: "RECORD_PAGE" }]),
        listPageLayoutTabs: vi.fn().mockResolvedValue([{ id: "tab-1", pageLayoutId: "layout-1" }]),
        listPageLayoutWidgets: vi
          .fn()
          .mockResolvedValue([{ id: "widget-1", pageLayoutTabId: "tab-1" }]),
        listCommandMenuItems: vi.fn().mockResolvedValue([{ id: "cmd-1", label: "Open widget" }]),
        updateFrontComponent: vi
          .fn()
          .mockResolvedValue({ id: "front-1", name: "Updated component" }),
        listNavigationMenuItems: vi.fn().mockResolvedValue([{ id: "nav-1", name: "Accounts" }]),
      },
      output: {
        render: vi.fn(),
      },
    },
    ...overrides,
  } as any;
}

describe("UI metadata operations", () => {
  it("lists command menu items", async () => {
    const ctx = createMockContext();

    await runCommandMenuItemsList(ctx);

    expect(ctx.services.metadata.listCommandMenuItems).toHaveBeenCalledWith();
    expect(ctx.services.output.render).toHaveBeenCalledWith(
      [{ id: "cmd-1", label: "Open widget" }],
      { format: "json", query: undefined },
    );
  });

  it("lists views filtered by object name", async () => {
    const ctx = createMockContext({
      options: { object: "person" },
    });

    await runViewsList(ctx);

    expect(ctx.services.metadata.getObject).toHaveBeenCalledWith("person");
    expect(ctx.services.metadata.listViews).toHaveBeenCalledWith({
      objectMetadataId: "obj-1",
    });
    expect(ctx.services.output.render).toHaveBeenCalledWith(
      [{ id: "view-1", name: "All People" }],
      { format: "json", query: undefined },
    );
  });

  it("throws when a view identifier is missing", async () => {
    const ctx = createMockContext();

    await expect(runViewsGet(ctx)).rejects.toThrow(CliError);
    await expect(runViewsGet(ctx)).rejects.toThrow("Missing view ID");
  });

  it("creates a view field from JSON input", async () => {
    const ctx = createMockContext({
      options: {
        data: '{"viewId":"view-1","fieldMetadataId":"fld-1","position":0}',
      },
    });

    await runViewFieldsCreate(ctx);

    expect(ctx.services.metadata.createViewField).toHaveBeenCalledWith({
      viewId: "view-1",
      fieldMetadataId: "fld-1",
      position: 0,
    });
    expect(ctx.services.output.render).toHaveBeenCalledWith(
      { id: "vf-1", fieldMetadataId: "fld-1" },
      { format: "json", query: undefined },
    );
  });

  it("updates a view filter", async () => {
    const ctx = createMockContext({
      arg: "filter-1",
      options: {
        data: '{"operand":"john@example.com"}',
      },
    });

    await runViewFiltersUpdate(ctx);

    expect(ctx.services.metadata.updateViewFilter).toHaveBeenCalledWith("filter-1", {
      operand: "john@example.com",
    });
    expect(ctx.services.output.render).toHaveBeenCalledWith(
      { id: "filter-1", operand: "john@example.com" },
      { format: "json", query: undefined },
    );
  });

  it("updates a front component", async () => {
    const ctx = createMockContext({
      arg: "front-1",
      options: {
        data: '{"name":"Updated component"}',
      },
    });

    await runFrontComponentsUpdate(ctx);

    expect(ctx.services.metadata.updateFrontComponent).toHaveBeenCalledWith("front-1", {
      name: "Updated component",
    });
    expect(ctx.services.output.render).toHaveBeenCalledWith(
      { id: "front-1", name: "Updated component" },
      { format: "json", query: undefined },
    );
  });

  it("deletes a view group", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const ctx = createMockContext({
      arg: "group-1",
    });

    await runViewGroupsDelete(ctx);

    expect(ctx.services.metadata.deleteViewGroup).toHaveBeenCalledWith("group-1");
    expect(consoleSpy).toHaveBeenCalledWith("View group group-1 deleted.");

    consoleSpy.mockRestore();
  });

  it("throws when a delete response reports failure", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const ctx = createMockContext({
      arg: "group-1",
    });
    ctx.services.metadata.deleteViewGroup.mockResolvedValue(false);

    await expect(runViewGroupsDelete(ctx)).rejects.toThrow(CliError);
    await expect(runViewGroupsDelete(ctx)).rejects.toThrow("View group group-1 was not deleted");
    expect(consoleSpy).not.toHaveBeenCalled();

    consoleSpy.mockRestore();
  });

  it("lists view sorts filtered by view", async () => {
    const ctx = createMockContext({
      options: { view: "view-1" },
    });

    await runViewSortsList(ctx);

    expect(ctx.services.metadata.listViewSorts).toHaveBeenCalledWith({
      viewId: "view-1",
    });
    expect(ctx.services.output.render).toHaveBeenCalledWith([{ id: "sort-1", viewId: "view-1" }], {
      format: "json",
      query: undefined,
    });
  });

  it("lists page layouts with object and layout-type filters", async () => {
    const ctx = createMockContext({
      options: {
        object: "person",
        pageLayoutType: "RECORD_PAGE",
      },
    });

    await runPageLayoutsList(ctx);

    expect(ctx.services.metadata.listPageLayouts).toHaveBeenCalledWith({
      objectMetadataId: "obj-1",
      pageLayoutType: "RECORD_PAGE",
    });
    expect(ctx.services.output.render).toHaveBeenCalledWith(
      [{ id: "layout-1", pageLayoutType: "RECORD_PAGE" }],
      { format: "json", query: undefined },
    );
  });

  it("requires an object filter when a page layout type is provided", async () => {
    const ctx = createMockContext({
      options: {
        pageLayoutType: "RECORD_PAGE",
      },
    });

    await expect(runPageLayoutsList(ctx)).rejects.toThrow(CliError);
    await expect(runPageLayoutsList(ctx)).rejects.toThrow(
      "Missing object filter when page layout type is provided",
    );
  });

  it("requires a page layout ID to list page layout tabs", async () => {
    const ctx = createMockContext();

    await expect(runPageLayoutTabsList(ctx)).rejects.toThrow(CliError);
    await expect(runPageLayoutTabsList(ctx)).rejects.toThrow("Missing page layout ID");
  });

  it("requires a page layout tab ID to list page layout widgets", async () => {
    const ctx = createMockContext();

    await expect(runPageLayoutWidgetsList(ctx)).rejects.toThrow(CliError);
    await expect(runPageLayoutWidgetsList(ctx)).rejects.toThrow("Missing page layout tab ID");
  });

  it("lists navigation menu items", async () => {
    const ctx = createMockContext();

    await runNavigationMenuItemsList(ctx);

    expect(ctx.services.metadata.listNavigationMenuItems).toHaveBeenCalledWith();
    expect(ctx.services.output.render).toHaveBeenCalledWith([{ id: "nav-1", name: "Accounts" }], {
      format: "json",
      query: undefined,
    });
  });
});
