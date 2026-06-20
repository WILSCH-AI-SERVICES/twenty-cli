import { Command } from "commander";

import { createCommandContext } from "../../utilities/shared/context";
import { applyGlobalOptions } from "../../utilities/shared/global-options";
import { runFieldsCreate } from "./operations/fields-create.operation";
import { runFieldsDelete } from "./operations/fields-delete.operation";
import { runFieldsGet } from "./operations/fields-get.operation";
import { runFieldsList } from "./operations/fields-list.operation";
import { runFieldsUpdate } from "./operations/fields-update.operation";
import { runObjectsCreate } from "./operations/objects-create.operation";
import { runObjectsDelete } from "./operations/objects-delete.operation";
import { runObjectsGet } from "./operations/objects-get.operation";
import { runObjectsList } from "./operations/objects-list.operation";
import { runObjectsUpdate } from "./operations/objects-update.operation";
import { ApiMetadataContext, ApiMetadataOptions } from "./operations/types";
import {
  runCommandMenuItemsList,
  runCommandMenuItemsGet,
  runCommandMenuItemsCreate,
  runCommandMenuItemsUpdate,
  runCommandMenuItemsDelete,
  runFrontComponentsList,
  runFrontComponentsGet,
  runFrontComponentsCreate,
  runFrontComponentsUpdate,
  runFrontComponentsDelete,
  runNavigationMenuItemsList,
  runNavigationMenuItemsGet,
  runNavigationMenuItemsCreate,
  runNavigationMenuItemsUpdate,
  runNavigationMenuItemsDelete,
  runViewsList,
  runViewsGet,
  runViewsCreate,
  runViewsUpdate,
  runViewsDelete,
  runViewFieldsList,
  runViewFieldsGet,
  runViewFieldsCreate,
  runViewFieldsUpdate,
  runViewFieldsDelete,
  runViewFiltersList,
  runViewFiltersGet,
  runViewFiltersCreate,
  runViewFiltersUpdate,
  runViewFiltersDelete,
  runViewFilterGroupsList,
  runViewFilterGroupsGet,
  runViewFilterGroupsCreate,
  runViewFilterGroupsUpdate,
  runViewFilterGroupsDelete,
  runViewGroupsList,
  runViewGroupsGet,
  runViewGroupsCreate,
  runViewGroupsUpdate,
  runViewGroupsDelete,
  runViewSortsList,
  runViewSortsGet,
  runViewSortsCreate,
  runViewSortsUpdate,
  runViewSortsDelete,
  runPageLayoutsList,
  runPageLayoutsGet,
  runPageLayoutsCreate,
  runPageLayoutsUpdate,
  runPageLayoutsDelete,
  runPageLayoutTabsList,
  runPageLayoutTabsGet,
  runPageLayoutTabsCreate,
  runPageLayoutTabsUpdate,
  runPageLayoutTabsDelete,
  runPageLayoutWidgetsList,
  runPageLayoutWidgetsGet,
  runPageLayoutWidgetsCreate,
  runPageLayoutWidgetsUpdate,
  runPageLayoutWidgetsDelete,
} from "./operations/ui-metadata.operations";

interface MetadataOperationHandlers {
  list: (ctx: ApiMetadataContext) => Promise<void>;
  get: (ctx: ApiMetadataContext) => Promise<void>;
  create: (ctx: ApiMetadataContext) => Promise<void>;
  update: (ctx: ApiMetadataContext) => Promise<void>;
  delete: (ctx: ApiMetadataContext) => Promise<void>;
}

function applyMetadataOptions(command: Command): void {
  command
    .option("-d, --data <json>", "JSON payload")
    .option("-f, --file <path>", "JSON payload file (use - for stdin)")
    .option("--object <nameOrId>", "Filter by object name or metadata ID")
    .option("--view <id>", "Filter by view ID")
    .option("--page-layout <id>", "Filter by page layout ID")
    .option("--page-layout-tab <id>", "Filter by page layout tab ID")
    .option("--page-layout-type <type>", "Filter page layouts by type (requires --object)");
}

async function createMetadataContext(
  command: Command,
  type: string,
  operation: string,
  arg?: string,
): Promise<ApiMetadataContext> {
  const { globalOptions, services } = await createCommandContext(command);

  return {
    type,
    operation,
    arg,
    options: command.opts() as ApiMetadataOptions,
    services,
    globalOptions,
  };
}

function registerMetadataFamily(
  root: Command,
  type: string,
  description: string,
  handlers: MetadataOperationHandlers,
): void {
  const family = root.command(type).description(description);
  applyGlobalOptions(family);

  const listCmd = family.command("list").description(`List ${type}`);
  applyMetadataOptions(listCmd);
  applyGlobalOptions(listCmd);
  listCmd.action(async (_options: unknown, command: Command) => {
    await handlers.list(await createMetadataContext(command, type, "list"));
  });

  const getCmd = family.command("get").description(`Get ${type}`).argument("[id]", "Identifier");
  applyMetadataOptions(getCmd);
  applyGlobalOptions(getCmd);
  getCmd.action(async (id: string | undefined, _options: unknown, command: Command) => {
    await handlers.get(await createMetadataContext(command, type, "get", id));
  });

  const createCmd = family.command("create").description(`Create ${type}`);
  applyMetadataOptions(createCmd);
  applyGlobalOptions(createCmd);
  createCmd.action(async (_options: unknown, command: Command) => {
    await handlers.create(await createMetadataContext(command, type, "create"));
  });

  const updateCmd = family
    .command("update")
    .description(`Update ${type}`)
    .argument("[id]", "Identifier");
  applyMetadataOptions(updateCmd);
  applyGlobalOptions(updateCmd);
  updateCmd.action(async (id: string | undefined, _options: unknown, command: Command) => {
    await handlers.update(await createMetadataContext(command, type, "update", id));
  });

  const deleteCmd = family
    .command("delete")
    .description(`Delete ${type}`)
    .argument("[id]", "Identifier");
  applyMetadataOptions(deleteCmd);
  applyGlobalOptions(deleteCmd);
  deleteCmd.action(async (id: string | undefined, _options: unknown, command: Command) => {
    await handlers.delete(await createMetadataContext(command, type, "delete", id));
  });
}

export function registerApiMetadataCommand(program: Command): void {
  const apiMetadata = program.command("api-metadata").description("Schema operations");
  applyGlobalOptions(apiMetadata);

  registerMetadataFamily(apiMetadata, "objects", "Manage object metadata", {
    list: runObjectsList,
    get: runObjectsGet,
    create: runObjectsCreate,
    update: runObjectsUpdate,
    delete: runObjectsDelete,
  });

  registerMetadataFamily(apiMetadata, "fields", "Manage field metadata", {
    list: runFieldsList,
    get: runFieldsGet,
    create: runFieldsCreate,
    update: runFieldsUpdate,
    delete: runFieldsDelete,
  });

  registerMetadataFamily(apiMetadata, "command-menu-items", "Manage command menu items", {
    list: runCommandMenuItemsList,
    get: runCommandMenuItemsGet,
    create: runCommandMenuItemsCreate,
    update: runCommandMenuItemsUpdate,
    delete: runCommandMenuItemsDelete,
  });

  registerMetadataFamily(apiMetadata, "front-components", "Manage front components", {
    list: runFrontComponentsList,
    get: runFrontComponentsGet,
    create: runFrontComponentsCreate,
    update: runFrontComponentsUpdate,
    delete: runFrontComponentsDelete,
  });

  registerMetadataFamily(apiMetadata, "navigation-menu-items", "Manage navigation menu items", {
    list: runNavigationMenuItemsList,
    get: runNavigationMenuItemsGet,
    create: runNavigationMenuItemsCreate,
    update: runNavigationMenuItemsUpdate,
    delete: runNavigationMenuItemsDelete,
  });

  registerMetadataFamily(apiMetadata, "views", "Manage views", {
    list: runViewsList,
    get: runViewsGet,
    create: runViewsCreate,
    update: runViewsUpdate,
    delete: runViewsDelete,
  });

  registerMetadataFamily(apiMetadata, "view-fields", "Manage view fields", {
    list: runViewFieldsList,
    get: runViewFieldsGet,
    create: runViewFieldsCreate,
    update: runViewFieldsUpdate,
    delete: runViewFieldsDelete,
  });

  registerMetadataFamily(apiMetadata, "view-filters", "Manage view filters", {
    list: runViewFiltersList,
    get: runViewFiltersGet,
    create: runViewFiltersCreate,
    update: runViewFiltersUpdate,
    delete: runViewFiltersDelete,
  });

  registerMetadataFamily(apiMetadata, "view-filter-groups", "Manage view filter groups", {
    list: runViewFilterGroupsList,
    get: runViewFilterGroupsGet,
    create: runViewFilterGroupsCreate,
    update: runViewFilterGroupsUpdate,
    delete: runViewFilterGroupsDelete,
  });

  registerMetadataFamily(apiMetadata, "view-groups", "Manage view groups", {
    list: runViewGroupsList,
    get: runViewGroupsGet,
    create: runViewGroupsCreate,
    update: runViewGroupsUpdate,
    delete: runViewGroupsDelete,
  });

  registerMetadataFamily(apiMetadata, "view-sorts", "Manage view sorts", {
    list: runViewSortsList,
    get: runViewSortsGet,
    create: runViewSortsCreate,
    update: runViewSortsUpdate,
    delete: runViewSortsDelete,
  });

  registerMetadataFamily(apiMetadata, "page-layouts", "Manage page layouts", {
    list: runPageLayoutsList,
    get: runPageLayoutsGet,
    create: runPageLayoutsCreate,
    update: runPageLayoutsUpdate,
    delete: runPageLayoutsDelete,
  });

  registerMetadataFamily(apiMetadata, "page-layout-tabs", "Manage page layout tabs", {
    list: runPageLayoutTabsList,
    get: runPageLayoutTabsGet,
    create: runPageLayoutTabsCreate,
    update: runPageLayoutTabsUpdate,
    delete: runPageLayoutTabsDelete,
  });

  registerMetadataFamily(apiMetadata, "page-layout-widgets", "Manage page layout widgets", {
    list: runPageLayoutWidgetsList,
    get: runPageLayoutWidgetsGet,
    create: runPageLayoutWidgetsCreate,
    update: runPageLayoutWidgetsUpdate,
    delete: runPageLayoutWidgetsDelete,
  });
}
