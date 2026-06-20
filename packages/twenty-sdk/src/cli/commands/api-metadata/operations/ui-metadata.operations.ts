import { CliError } from "../../../utilities/errors/cli-error";
import { parseBody } from "../../../utilities/shared/body";
import { ApiMetadataContext } from "./types";

export const runCommandMenuItemsList = createListOperation((ctx) =>
  ctx.services.metadata.listCommandMenuItems(),
);

export const runCommandMenuItemsGet = createGetOperation("command menu item ID", (ctx, id) =>
  ctx.services.metadata.getCommandMenuItem(id),
);

export const runCommandMenuItemsCreate = createCreateOperation((ctx, payload) =>
  ctx.services.metadata.createCommandMenuItem(payload),
);

export const runCommandMenuItemsUpdate = createUpdateOperation(
  "command menu item ID",
  (ctx, id, payload) => ctx.services.metadata.updateCommandMenuItem(id, payload),
);

export const runCommandMenuItemsDelete = createDeleteOperation(
  "command menu item ID",
  "Command menu item",
  (ctx, id) => ctx.services.metadata.deleteCommandMenuItem(id),
);

export const runFrontComponentsList = createListOperation((ctx) =>
  ctx.services.metadata.listFrontComponents(),
);

export const runFrontComponentsGet = createGetOperation("front component ID", (ctx, id) =>
  ctx.services.metadata.getFrontComponent(id),
);

export const runFrontComponentsCreate = createCreateOperation((ctx, payload) =>
  ctx.services.metadata.createFrontComponent(payload),
);

export const runFrontComponentsUpdate = createUpdateOperation(
  "front component ID",
  (ctx, id, payload) => ctx.services.metadata.updateFrontComponent(id, payload),
);

export const runFrontComponentsDelete = createDeleteOperation(
  "front component ID",
  "Front component",
  (ctx, id) => ctx.services.metadata.deleteFrontComponent(id),
);

export const runNavigationMenuItemsList = createListOperation((ctx) =>
  ctx.services.metadata.listNavigationMenuItems(),
);

export const runNavigationMenuItemsGet = createGetOperation("navigation menu item ID", (ctx, id) =>
  ctx.services.metadata.getNavigationMenuItem(id),
);

export const runNavigationMenuItemsCreate = createCreateOperation((ctx, payload) =>
  ctx.services.metadata.createNavigationMenuItem(payload),
);

export const runNavigationMenuItemsUpdate = createUpdateOperation(
  "navigation menu item ID",
  (ctx, id, payload) => ctx.services.metadata.updateNavigationMenuItem(id, payload),
);

export const runNavigationMenuItemsDelete = createDeleteOperation(
  "navigation menu item ID",
  "Navigation menu item",
  (ctx, id) => ctx.services.metadata.deleteNavigationMenuItem(id),
);

export const runViewsList = createListOperation(async (ctx) =>
  ctx.services.metadata.listViews(
    compactFilters({
      objectMetadataId: await resolveObjectMetadataId(ctx),
    }),
  ),
);

export const runViewsGet = createGetOperation("view ID", (ctx, id) =>
  ctx.services.metadata.getView(id),
);

export const runViewsCreate = createCreateOperation((ctx, payload) =>
  ctx.services.metadata.createView(payload),
);

export const runViewsUpdate = createUpdateOperation("view ID", (ctx, id, payload) =>
  ctx.services.metadata.updateView(id, payload),
);

export const runViewsDelete = createDeleteOperation("view ID", "View", (ctx, id) =>
  ctx.services.metadata.deleteView(id),
);

export const runViewFieldsList = createListOperation(async (ctx) =>
  ctx.services.metadata.listViewFields(
    compactFilters({
      viewId: ctx.options.view,
    }),
  ),
);

export const runViewFieldsGet = createGetOperation("view field ID", (ctx, id) =>
  ctx.services.metadata.getViewField(id),
);

export const runViewFieldsCreate = createCreateOperation((ctx, payload) =>
  ctx.services.metadata.createViewField(payload),
);

export const runViewFieldsUpdate = createUpdateOperation("view field ID", (ctx, id, payload) =>
  ctx.services.metadata.updateViewField(id, payload),
);

export const runViewFieldsDelete = createDeleteOperation("view field ID", "View field", (ctx, id) =>
  ctx.services.metadata.deleteViewField(id),
);

export const runViewFiltersList = createListOperation(async (ctx) =>
  ctx.services.metadata.listViewFilters(
    compactFilters({
      viewId: ctx.options.view,
    }),
  ),
);

export const runViewFiltersGet = createGetOperation("view filter ID", (ctx, id) =>
  ctx.services.metadata.getViewFilter(id),
);

export const runViewFiltersCreate = createCreateOperation((ctx, payload) =>
  ctx.services.metadata.createViewFilter(payload),
);

export const runViewFiltersUpdate = createUpdateOperation("view filter ID", (ctx, id, payload) =>
  ctx.services.metadata.updateViewFilter(id, payload),
);

export const runViewFiltersDelete = createDeleteOperation(
  "view filter ID",
  "View filter",
  (ctx, id) => ctx.services.metadata.deleteViewFilter(id),
);

export const runViewFilterGroupsList = createListOperation(async (ctx) =>
  ctx.services.metadata.listViewFilterGroups(
    compactFilters({
      viewId: ctx.options.view,
    }),
  ),
);

export const runViewFilterGroupsGet = createGetOperation("view filter group ID", (ctx, id) =>
  ctx.services.metadata.getViewFilterGroup(id),
);

export const runViewFilterGroupsCreate = createCreateOperation((ctx, payload) =>
  ctx.services.metadata.createViewFilterGroup(payload),
);

export const runViewFilterGroupsUpdate = createUpdateOperation(
  "view filter group ID",
  (ctx, id, payload) => ctx.services.metadata.updateViewFilterGroup(id, payload),
);

export const runViewFilterGroupsDelete = createDeleteOperation(
  "view filter group ID",
  "View filter group",
  (ctx, id) => ctx.services.metadata.deleteViewFilterGroup(id),
);

export const runViewGroupsList = createListOperation(async (ctx) =>
  ctx.services.metadata.listViewGroups(
    compactFilters({
      viewId: ctx.options.view,
    }),
  ),
);

export const runViewGroupsGet = createGetOperation("view group ID", (ctx, id) =>
  ctx.services.metadata.getViewGroup(id),
);

export const runViewGroupsCreate = createCreateOperation((ctx, payload) =>
  ctx.services.metadata.createViewGroup(payload),
);

export const runViewGroupsUpdate = createUpdateOperation("view group ID", (ctx, id, payload) =>
  ctx.services.metadata.updateViewGroup(id, payload),
);

export const runViewGroupsDelete = createDeleteOperation("view group ID", "View group", (ctx, id) =>
  ctx.services.metadata.deleteViewGroup(id),
);

export const runViewSortsList = createListOperation(async (ctx) =>
  ctx.services.metadata.listViewSorts(
    compactFilters({
      viewId: ctx.options.view,
    }),
  ),
);

export const runViewSortsGet = createGetOperation("view sort ID", (ctx, id) =>
  ctx.services.metadata.getViewSort(id),
);

export const runViewSortsCreate = createCreateOperation((ctx, payload) =>
  ctx.services.metadata.createViewSort(payload),
);

export const runViewSortsUpdate = createUpdateOperation("view sort ID", (ctx, id, payload) =>
  ctx.services.metadata.updateViewSort(id, payload),
);

export const runViewSortsDelete = createDeleteOperation("view sort ID", "View sort", (ctx, id) =>
  ctx.services.metadata.deleteViewSort(id),
);

export const runPageLayoutsList = createListOperation(async (ctx) =>
  ctx.services.metadata.listPageLayouts(
    compactFilters({
      objectMetadataId: await resolvePageLayoutObjectMetadataId(ctx),
      pageLayoutType: ctx.options.pageLayoutType,
    }),
  ),
);

export const runPageLayoutsGet = createGetOperation("page layout ID", (ctx, id) =>
  ctx.services.metadata.getPageLayout(id),
);

export const runPageLayoutsCreate = createCreateOperation((ctx, payload) =>
  ctx.services.metadata.createPageLayout(payload),
);

export const runPageLayoutsUpdate = createUpdateOperation("page layout ID", (ctx, id, payload) =>
  ctx.services.metadata.updatePageLayout(id, payload),
);

export const runPageLayoutsDelete = createDeleteOperation(
  "page layout ID",
  "Page layout",
  (ctx, id) => ctx.services.metadata.deletePageLayout(id),
);

export const runPageLayoutTabsList = createListOperation(async (ctx) =>
  ctx.services.metadata.listPageLayoutTabs({
    pageLayoutId: requireOption(ctx.options.pageLayout, "Missing page layout ID."),
  }),
);

export const runPageLayoutTabsGet = createGetOperation("page layout tab ID", (ctx, id) =>
  ctx.services.metadata.getPageLayoutTab(id),
);

export const runPageLayoutTabsCreate = createCreateOperation((ctx, payload) =>
  ctx.services.metadata.createPageLayoutTab(payload),
);

export const runPageLayoutTabsUpdate = createUpdateOperation(
  "page layout tab ID",
  (ctx, id, payload) => ctx.services.metadata.updatePageLayoutTab(id, payload),
);

export const runPageLayoutTabsDelete = createDeleteOperation(
  "page layout tab ID",
  "Page layout tab",
  (ctx, id) => ctx.services.metadata.deletePageLayoutTab(id),
);

export const runPageLayoutWidgetsList = createListOperation(async (ctx) =>
  ctx.services.metadata.listPageLayoutWidgets({
    pageLayoutTabId: requireOption(ctx.options.pageLayoutTab, "Missing page layout tab ID."),
  }),
);

export const runPageLayoutWidgetsGet = createGetOperation("page layout widget ID", (ctx, id) =>
  ctx.services.metadata.getPageLayoutWidget(id),
);

export const runPageLayoutWidgetsCreate = createCreateOperation((ctx, payload) =>
  ctx.services.metadata.createPageLayoutWidget(payload),
);

export const runPageLayoutWidgetsUpdate = createUpdateOperation(
  "page layout widget ID",
  (ctx, id, payload) => ctx.services.metadata.updatePageLayoutWidget(id, payload),
);

export const runPageLayoutWidgetsDelete = createDeleteOperation(
  "page layout widget ID",
  "Page layout widget",
  (ctx, id) => ctx.services.metadata.deletePageLayoutWidget(id),
);

type MetadataPayload = Record<string, unknown>;

function createListOperation(
  list: (ctx: ApiMetadataContext) => Promise<unknown[]>,
): (ctx: ApiMetadataContext) => Promise<void> {
  return async (ctx) => {
    const result = await list(ctx);
    await render(ctx, result);
  };
}

function createGetOperation(
  identifierLabel: string,
  get: (ctx: ApiMetadataContext, id: string) => Promise<unknown>,
): (ctx: ApiMetadataContext) => Promise<void> {
  return async (ctx) => {
    const id = requireArg(ctx.arg, identifierLabel);
    const result = await get(ctx, id);
    await render(ctx, result);
  };
}

function createCreateOperation(
  create: (ctx: ApiMetadataContext, payload: MetadataPayload) => Promise<unknown>,
): (ctx: ApiMetadataContext) => Promise<void> {
  return async (ctx) => {
    const payload = await parseBody(ctx.options.data, ctx.options.file);
    const result = await create(ctx, payload as MetadataPayload);
    await render(ctx, result);
  };
}

function createUpdateOperation(
  identifierLabel: string,
  update: (ctx: ApiMetadataContext, id: string, payload: MetadataPayload) => Promise<unknown>,
): (ctx: ApiMetadataContext) => Promise<void> {
  return async (ctx) => {
    const id = requireArg(ctx.arg, identifierLabel);
    const payload = await parseBody(ctx.options.data, ctx.options.file);
    const result = await update(ctx, id, payload as MetadataPayload);
    await render(ctx, result);
  };
}

function createDeleteOperation(
  identifierLabel: string,
  noun: string,
  del: (ctx: ApiMetadataContext, id: string) => Promise<boolean>,
): (ctx: ApiMetadataContext) => Promise<void> {
  return async (ctx) => {
    const id = requireArg(ctx.arg, identifierLabel);
    const deleted = await del(ctx, id);
    if (!deleted) {
      throw new CliError(`${noun} ${id} was not deleted.`, "API_ERROR");
    }
    console.log(`${noun} ${id} deleted.`);
  };
}

async function resolveObjectMetadataId(ctx: ApiMetadataContext): Promise<string | undefined> {
  if (!ctx.options.object) {
    return undefined;
  }

  const object = await ctx.services.metadata.getObject(ctx.options.object);
  return object.id;
}

async function resolvePageLayoutObjectMetadataId(
  ctx: ApiMetadataContext,
): Promise<string | undefined> {
  if (ctx.options.pageLayoutType && !ctx.options.object) {
    throw new CliError(
      "Missing object filter when page layout type is provided.",
      "INVALID_ARGUMENTS",
    );
  }

  return resolveObjectMetadataId(ctx);
}

function requireArg(value: string | undefined, label: string): string {
  if (!value) {
    throw new CliError(`Missing ${label}.`, "INVALID_ARGUMENTS");
  }

  return value;
}

function requireOption(value: string | undefined, message: string): string {
  if (!value) {
    throw new CliError(message, "INVALID_ARGUMENTS");
  }

  return value;
}

function compactFilters(
  filters: Record<string, string | undefined>,
): Record<string, string> | undefined {
  const filtered = Object.fromEntries(
    Object.entries(filters).filter(([, value]) => value !== undefined && value !== ""),
  ) as Record<string, string>;

  return Object.keys(filtered).length > 0 ? filtered : undefined;
}

async function render(ctx: ApiMetadataContext, data: unknown): Promise<void> {
  await ctx.services.output.render(data, {
    format: ctx.globalOptions.output,
    query: ctx.globalOptions.query,
  });
}
