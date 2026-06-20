import { extractCollection, extractDeleteResult, extractResource } from "../../api/rest-response";
import { ApiService } from "../../api/services/api.service";

interface GraphQLResponse<T = unknown> {
  data?: T;
  errors?: Array<{ message?: string }>;
}

/**
 * Minimal structural surface MetadataService needs from the schema cache.
 * Kept narrow so tests can mock it without pulling in the full SchemaCacheService.
 */
export interface MetadataSchemaCache {
  readFreshSchema(kind: "metadata-objects"): Promise<unknown | undefined>;
  writeSchema(kind: "metadata-objects", schema: unknown): Promise<void>;
}

const METADATA_GRAPHQL_ENDPOINT = "/metadata";

const COMMAND_MENU_ITEM_FIELDS = `
  id
  workflowVersionId
  frontComponentId
  engineComponentKey
  label
  icon
  shortLabel
  position
  isPinned
  availabilityType
  conditionalAvailabilityExpression
  availabilityObjectMetadataId
  applicationId
  createdAt
  updatedAt
`;

const FRONT_COMPONENT_FIELDS = `
  id
  name
  description
  sourceComponentPath
  builtComponentPath
  componentName
  builtComponentChecksum
  universalIdentifier
  applicationId
  createdAt
  updatedAt
  isHeadless
`;

const NAVIGATION_MENU_ITEM_FIELDS = `
  id
  userWorkspaceId
  targetRecordId
  targetObjectMetadataId
  viewId
  name
  link
  icon
  color
  folderId
  position
  applicationId
  createdAt
  updatedAt
`;

const LIST_COMMAND_MENU_ITEMS_QUERY = `query CommandMenuItems {
  commandMenuItems {
    ${COMMAND_MENU_ITEM_FIELDS}
  }
}`;

const GET_COMMAND_MENU_ITEM_QUERY = `query CommandMenuItem($id: UUID!) {
  commandMenuItem(id: $id) {
    ${COMMAND_MENU_ITEM_FIELDS}
  }
}`;

const CREATE_COMMAND_MENU_ITEM_MUTATION = `mutation CreateCommandMenuItem($input: CreateCommandMenuItemInput) {
  createCommandMenuItem(input: $input) {
    ${COMMAND_MENU_ITEM_FIELDS}
  }
}`;

const UPDATE_COMMAND_MENU_ITEM_MUTATION = `mutation UpdateCommandMenuItem($input: UpdateCommandMenuItemInput) {
  updateCommandMenuItem(input: $input) {
    ${COMMAND_MENU_ITEM_FIELDS}
  }
}`;

const DELETE_COMMAND_MENU_ITEM_MUTATION = `mutation DeleteCommandMenuItem($id: UUID) {
  deleteCommandMenuItem(id: $id) {
    ${COMMAND_MENU_ITEM_FIELDS}
  }
}`;

const LIST_FRONT_COMPONENTS_QUERY = `query FrontComponents {
  frontComponents {
    ${FRONT_COMPONENT_FIELDS}
  }
}`;

const GET_FRONT_COMPONENT_QUERY = `query FrontComponent($id: UUID!) {
  frontComponent(id: $id) {
    ${FRONT_COMPONENT_FIELDS}
  }
}`;

const CREATE_FRONT_COMPONENT_MUTATION = `mutation CreateFrontComponent($input: CreateFrontComponentInput) {
  createFrontComponent(input: $input) {
    ${FRONT_COMPONENT_FIELDS}
  }
}`;

const UPDATE_FRONT_COMPONENT_MUTATION = `mutation UpdateFrontComponent($input: UpdateFrontComponentInput) {
  updateFrontComponent(input: $input) {
    ${FRONT_COMPONENT_FIELDS}
  }
}`;

const DELETE_FRONT_COMPONENT_MUTATION = `mutation DeleteFrontComponent($id: UUID) {
  deleteFrontComponent(id: $id) {
    ${FRONT_COMPONENT_FIELDS}
  }
}`;

const LIST_NAVIGATION_MENU_ITEMS_QUERY = `query NavigationMenuItems {
  navigationMenuItems {
    ${NAVIGATION_MENU_ITEM_FIELDS}
  }
}`;

const GET_NAVIGATION_MENU_ITEM_QUERY = `query NavigationMenuItem($id: UUID!) {
  navigationMenuItem(id: $id) {
    ${NAVIGATION_MENU_ITEM_FIELDS}
  }
}`;

const CREATE_NAVIGATION_MENU_ITEM_MUTATION = `mutation CreateNavigationMenuItem($input: CreateNavigationMenuItemInput) {
  createNavigationMenuItem(input: $input) {
    ${NAVIGATION_MENU_ITEM_FIELDS}
  }
}`;

const UPDATE_NAVIGATION_MENU_ITEM_MUTATION = `mutation UpdateNavigationMenuItem($input: UpdateOneNavigationMenuItemInput) {
  updateNavigationMenuItem(input: $input) {
    ${NAVIGATION_MENU_ITEM_FIELDS}
  }
}`;

const DELETE_NAVIGATION_MENU_ITEM_MUTATION = `mutation DeleteNavigationMenuItem($id: UUID) {
  deleteNavigationMenuItem(id: $id) {
    ${NAVIGATION_MENU_ITEM_FIELDS}
  }
}`;

export interface ObjectMetadata {
  id: string;
  nameSingular?: string;
  namePlural?: string;
  fields?: FieldMetadata[];
  [key: string]: unknown;
}

export interface FieldMetadata {
  id: string;
  objectMetadataId?: string;
  [key: string]: unknown;
}

export interface MetadataResource {
  id: string;
  [key: string]: unknown;
}

export class MetadataService {
  constructor(
    private api: ApiService,
    private schemaCache?: MetadataSchemaCache,
  ) {}

  private listObjectsPromise?: Promise<ObjectMetadata[]>;

  async listObjects(): Promise<ObjectMetadata[]> {
    if (!this.listObjectsPromise) {
      this.listObjectsPromise = this.fetchListObjects().catch((error) => {
        this.listObjectsPromise = undefined;
        throw error;
      });
    }
    return this.listObjectsPromise;
  }

  resetListObjectsCache(): void {
    this.listObjectsPromise = undefined;
  }

  private async fetchListObjects(): Promise<ObjectMetadata[]> {
    if (this.schemaCache) {
      const cached = await this.schemaCache.readFreshSchema("metadata-objects");
      if (cached !== undefined) {
        return extractCollection(cached, "objects") as ObjectMetadata[];
      }
    }

    const response = await this.api.get("/rest/metadata/objects");

    if (this.schemaCache) {
      // Fire-and-forget: cache failures must not break the request.
      void Promise.resolve(this.schemaCache.writeSchema("metadata-objects", response.data)).catch(
        () => undefined,
      );
    }

    return extractCollection(response.data, "objects") as ObjectMetadata[];
  }

  async getObject(nameOrId: string): Promise<ObjectMetadata> {
    if (looksLikeUuid(nameOrId)) {
      const response = await this.api.get(`/rest/metadata/objects/${nameOrId}`);
      return extractResource<ObjectMetadata>(response.data, "object");
    }

    const objects = await this.listObjects();
    const match = objects.find(
      (obj) => obj.nameSingular === nameOrId || obj.namePlural === nameOrId,
    );
    if (!match) {
      throw new Error(`Object not found: ${nameOrId}`);
    }

    const response = await this.api.get(`/rest/metadata/objects/${match.id}`);
    return extractResource<ObjectMetadata>(response.data, "object");
  }

  async createObject(data: Record<string, unknown>): Promise<unknown> {
    const response = await this.api.post("/rest/metadata/objects", data);
    return response.data ?? null;
  }

  async updateObject(id: string, data: Record<string, unknown>): Promise<unknown> {
    const response = await this.api.patch(`/rest/metadata/objects/${id}`, data);
    return response.data ?? null;
  }

  async deleteObject(id: string): Promise<void> {
    await this.api.delete(`/rest/metadata/objects/${id}`);
  }

  async listFields(): Promise<FieldMetadata[]> {
    const response = await this.api.get("/rest/metadata/fields");
    return extractCollection(response.data, "fields") as FieldMetadata[];
  }

  async getField(id: string): Promise<FieldMetadata> {
    const response = await this.api.get(`/rest/metadata/fields/${id}`);
    return extractResource<FieldMetadata>(response.data, "field");
  }

  async createField(data: Record<string, unknown>): Promise<unknown> {
    const response = await this.api.post("/rest/metadata/fields", data);
    return response.data ?? null;
  }

  async updateField(id: string, data: Record<string, unknown>): Promise<unknown> {
    const response = await this.api.patch(`/rest/metadata/fields/${id}`, data);
    return response.data ?? null;
  }

  async deleteField(id: string): Promise<void> {
    await this.api.delete(`/rest/metadata/fields/${id}`);
  }

  async listViews(params?: Record<string, string | undefined>): Promise<MetadataResource[]> {
    return this.listResource("/rest/metadata/views", "views", params);
  }

  async getView(id: string): Promise<MetadataResource> {
    return this.getResource(`/rest/metadata/views/${id}`, "view");
  }

  async createView(data: Record<string, unknown>): Promise<unknown> {
    return this.createResource("/rest/metadata/views", data);
  }

  async updateView(id: string, data: Record<string, unknown>): Promise<unknown> {
    return this.updateResource(`/rest/metadata/views/${id}`, data);
  }

  async deleteView(id: string): Promise<boolean> {
    return this.deleteResource(`/rest/metadata/views/${id}`);
  }

  async listViewFields(params?: Record<string, string | undefined>): Promise<MetadataResource[]> {
    return this.listResource("/rest/metadata/viewFields", "viewFields", params);
  }

  async getViewField(id: string): Promise<MetadataResource> {
    return this.getResource(`/rest/metadata/viewFields/${id}`, "viewField");
  }

  async createViewField(data: Record<string, unknown>): Promise<unknown> {
    return this.createResource("/rest/metadata/viewFields", data);
  }

  async updateViewField(id: string, data: Record<string, unknown>): Promise<unknown> {
    return this.updateResource(`/rest/metadata/viewFields/${id}`, data);
  }

  async deleteViewField(id: string): Promise<boolean> {
    return this.deleteResource(`/rest/metadata/viewFields/${id}`);
  }

  async listViewFilters(params?: Record<string, string | undefined>): Promise<MetadataResource[]> {
    return this.listResource("/rest/metadata/viewFilters", "viewFilters", params);
  }

  async getViewFilter(id: string): Promise<MetadataResource> {
    return this.getResource(`/rest/metadata/viewFilters/${id}`, "viewFilter");
  }

  async createViewFilter(data: Record<string, unknown>): Promise<unknown> {
    return this.createResource("/rest/metadata/viewFilters", data);
  }

  async updateViewFilter(id: string, data: Record<string, unknown>): Promise<unknown> {
    return this.updateResource(`/rest/metadata/viewFilters/${id}`, data);
  }

  async deleteViewFilter(id: string): Promise<boolean> {
    return this.deleteResource(`/rest/metadata/viewFilters/${id}`);
  }

  async listViewFilterGroups(
    params?: Record<string, string | undefined>,
  ): Promise<MetadataResource[]> {
    return this.listResource("/rest/metadata/viewFilterGroups", "viewFilterGroups", params);
  }

  async getViewFilterGroup(id: string): Promise<MetadataResource> {
    return this.getResource(`/rest/metadata/viewFilterGroups/${id}`, "viewFilterGroup");
  }

  async createViewFilterGroup(data: Record<string, unknown>): Promise<unknown> {
    return this.createResource("/rest/metadata/viewFilterGroups", data);
  }

  async updateViewFilterGroup(id: string, data: Record<string, unknown>): Promise<unknown> {
    return this.updateResource(`/rest/metadata/viewFilterGroups/${id}`, data);
  }

  async deleteViewFilterGroup(id: string): Promise<boolean> {
    return this.deleteResource(`/rest/metadata/viewFilterGroups/${id}`);
  }

  async listViewGroups(params?: Record<string, string | undefined>): Promise<MetadataResource[]> {
    return this.listResource("/rest/metadata/viewGroups", "viewGroups", params);
  }

  async getViewGroup(id: string): Promise<MetadataResource> {
    return this.getResource(`/rest/metadata/viewGroups/${id}`, "viewGroup");
  }

  async createViewGroup(data: Record<string, unknown>): Promise<unknown> {
    return this.createResource("/rest/metadata/viewGroups", data);
  }

  async updateViewGroup(id: string, data: Record<string, unknown>): Promise<unknown> {
    return this.updateResource(`/rest/metadata/viewGroups/${id}`, data);
  }

  async deleteViewGroup(id: string): Promise<boolean> {
    return this.deleteResource(`/rest/metadata/viewGroups/${id}`);
  }

  async listViewSorts(params?: Record<string, string | undefined>): Promise<MetadataResource[]> {
    return this.listResource("/rest/metadata/viewSorts", "viewSorts", params);
  }

  async getViewSort(id: string): Promise<MetadataResource> {
    return this.getResource(`/rest/metadata/viewSorts/${id}`, "viewSort");
  }

  async createViewSort(data: Record<string, unknown>): Promise<unknown> {
    return this.createResource("/rest/metadata/viewSorts", data);
  }

  async updateViewSort(id: string, data: Record<string, unknown>): Promise<unknown> {
    return this.updateResource(`/rest/metadata/viewSorts/${id}`, data);
  }

  async deleteViewSort(id: string): Promise<boolean> {
    return this.deleteResource(`/rest/metadata/viewSorts/${id}`);
  }

  async listPageLayouts(params?: Record<string, string | undefined>): Promise<MetadataResource[]> {
    return this.listResource("/rest/metadata/pageLayouts", "pageLayouts", params);
  }

  async getPageLayout(id: string): Promise<MetadataResource> {
    return this.getResource(`/rest/metadata/pageLayouts/${id}`, "pageLayout");
  }

  async createPageLayout(data: Record<string, unknown>): Promise<unknown> {
    return this.createResource("/rest/metadata/pageLayouts", data);
  }

  async updatePageLayout(id: string, data: Record<string, unknown>): Promise<unknown> {
    return this.updateResource(`/rest/metadata/pageLayouts/${id}`, data);
  }

  async deletePageLayout(id: string): Promise<boolean> {
    return this.deleteResource(`/rest/metadata/pageLayouts/${id}`);
  }

  async listPageLayoutTabs(
    params?: Record<string, string | undefined>,
  ): Promise<MetadataResource[]> {
    return this.listResource("/rest/metadata/pageLayoutTabs", "pageLayoutTabs", params);
  }

  async getPageLayoutTab(id: string): Promise<MetadataResource> {
    return this.getResource(`/rest/metadata/pageLayoutTabs/${id}`, "pageLayoutTab");
  }

  async createPageLayoutTab(data: Record<string, unknown>): Promise<unknown> {
    return this.createResource("/rest/metadata/pageLayoutTabs", data);
  }

  async updatePageLayoutTab(id: string, data: Record<string, unknown>): Promise<unknown> {
    return this.updateResource(`/rest/metadata/pageLayoutTabs/${id}`, data);
  }

  async deletePageLayoutTab(id: string): Promise<boolean> {
    return this.deleteResource(`/rest/metadata/pageLayoutTabs/${id}`);
  }

  async listPageLayoutWidgets(
    params?: Record<string, string | undefined>,
  ): Promise<MetadataResource[]> {
    return this.listResource("/rest/metadata/pageLayoutWidgets", "pageLayoutWidgets", params);
  }

  async getPageLayoutWidget(id: string): Promise<MetadataResource> {
    return this.getResource(`/rest/metadata/pageLayoutWidgets/${id}`, "pageLayoutWidget");
  }

  async createPageLayoutWidget(data: Record<string, unknown>): Promise<unknown> {
    return this.createResource("/rest/metadata/pageLayoutWidgets", data);
  }

  async updatePageLayoutWidget(id: string, data: Record<string, unknown>): Promise<unknown> {
    return this.updateResource(`/rest/metadata/pageLayoutWidgets/${id}`, data);
  }

  async deletePageLayoutWidget(id: string): Promise<boolean> {
    return this.deleteResource(`/rest/metadata/pageLayoutWidgets/${id}`);
  }

  async listCommandMenuItems(): Promise<MetadataResource[]> {
    return this.listGraphqlCollection(LIST_COMMAND_MENU_ITEMS_QUERY, "commandMenuItems");
  }

  async getCommandMenuItem(id: string): Promise<MetadataResource> {
    return this.getGraphqlResource(GET_COMMAND_MENU_ITEM_QUERY, "commandMenuItem", { id });
  }

  async createCommandMenuItem(data: Record<string, unknown>): Promise<unknown> {
    return this.createGraphqlResource(
      CREATE_COMMAND_MENU_ITEM_MUTATION,
      "createCommandMenuItem",
      data,
    );
  }

  async updateCommandMenuItem(id: string, data: Record<string, unknown>): Promise<unknown> {
    return this.updateGraphqlResource(UPDATE_COMMAND_MENU_ITEM_MUTATION, "updateCommandMenuItem", {
      id,
      ...data,
    });
  }

  async deleteCommandMenuItem(id: string): Promise<boolean> {
    return this.deleteGraphqlResource(DELETE_COMMAND_MENU_ITEM_MUTATION, "deleteCommandMenuItem", {
      id,
    });
  }

  async listFrontComponents(): Promise<MetadataResource[]> {
    return this.listGraphqlCollection(LIST_FRONT_COMPONENTS_QUERY, "frontComponents");
  }

  async getFrontComponent(id: string): Promise<MetadataResource> {
    return this.getGraphqlResource(GET_FRONT_COMPONENT_QUERY, "frontComponent", { id });
  }

  async createFrontComponent(data: Record<string, unknown>): Promise<unknown> {
    return this.createGraphqlResource(
      CREATE_FRONT_COMPONENT_MUTATION,
      "createFrontComponent",
      data,
    );
  }

  async updateFrontComponent(id: string, data: Record<string, unknown>): Promise<unknown> {
    return this.updateGraphqlResource(UPDATE_FRONT_COMPONENT_MUTATION, "updateFrontComponent", {
      id,
      update: data,
    });
  }

  async deleteFrontComponent(id: string): Promise<boolean> {
    return this.deleteGraphqlResource(DELETE_FRONT_COMPONENT_MUTATION, "deleteFrontComponent", {
      id,
    });
  }

  async listNavigationMenuItems(): Promise<MetadataResource[]> {
    return this.listGraphqlCollection(LIST_NAVIGATION_MENU_ITEMS_QUERY, "navigationMenuItems");
  }

  async getNavigationMenuItem(id: string): Promise<MetadataResource> {
    return this.getGraphqlResource(GET_NAVIGATION_MENU_ITEM_QUERY, "navigationMenuItem", { id });
  }

  async createNavigationMenuItem(data: Record<string, unknown>): Promise<unknown> {
    return this.createGraphqlResource(
      CREATE_NAVIGATION_MENU_ITEM_MUTATION,
      "createNavigationMenuItem",
      data,
    );
  }

  async updateNavigationMenuItem(id: string, data: Record<string, unknown>): Promise<unknown> {
    return this.updateGraphqlResource(
      UPDATE_NAVIGATION_MENU_ITEM_MUTATION,
      "updateNavigationMenuItem",
      {
        id,
        update: data,
      },
    );
  }

  async deleteNavigationMenuItem(id: string): Promise<boolean> {
    return this.deleteGraphqlResource(
      DELETE_NAVIGATION_MENU_ITEM_MUTATION,
      "deleteNavigationMenuItem",
      { id },
    );
  }

  private async listResource(
    path: string,
    key: string,
    params?: Record<string, string | undefined>,
  ): Promise<MetadataResource[]> {
    const config = buildQueryConfig(params);
    const response = config ? await this.api.get(path, config) : await this.api.get(path);
    return extractCollection(response.data, key) as MetadataResource[];
  }

  private async getResource(path: string, key: string): Promise<MetadataResource> {
    const response = await this.api.get(path);
    return extractResource<MetadataResource>(response.data, key);
  }

  private async createResource(path: string, data: Record<string, unknown>): Promise<unknown> {
    const response = await this.api.post(path, data);
    return response.data ?? null;
  }

  private async updateResource(path: string, data: Record<string, unknown>): Promise<unknown> {
    const response = await this.api.patch(path, data);
    return response.data ?? null;
  }

  private async deleteResource(path: string): Promise<boolean> {
    const response = await this.api.delete(path);
    return extractDeleteResult(response.data);
  }

  private async listGraphqlCollection(
    query: string,
    key: string,
    variables?: Record<string, unknown>,
  ): Promise<MetadataResource[]> {
    const response = await this.postMetadataGraphql<MetadataResource[]>(query, variables);
    return extractGraphqlCollection(response, key);
  }

  private async getGraphqlResource(
    query: string,
    key: string,
    variables?: Record<string, unknown>,
  ): Promise<MetadataResource> {
    const response = await this.postMetadataGraphql<MetadataResource>(query, variables);
    return extractGraphqlResource(response, key);
  }

  private async createGraphqlResource(
    query: string,
    key: string,
    input: Record<string, unknown>,
  ): Promise<unknown> {
    const response = await this.postMetadataGraphql<unknown>(query, { input });
    return extractGraphqlField(response, key) ?? null;
  }

  private async updateGraphqlResource(
    query: string,
    key: string,
    input: Record<string, unknown>,
  ): Promise<unknown> {
    const response = await this.postMetadataGraphql<unknown>(query, { input });
    return extractGraphqlField(response, key) ?? null;
  }

  private async deleteGraphqlResource(
    query: string,
    key: string,
    variables: Record<string, unknown>,
  ): Promise<boolean> {
    const response = await this.postMetadataGraphql<unknown>(query, variables);
    const result = extractGraphqlField(response, key);

    return Boolean(result);
  }

  private async postMetadataGraphql<T = unknown>(
    query: string,
    variables?: Record<string, unknown>,
  ): Promise<GraphQLResponse<Record<string, T>>> {
    const response = await this.api.post<GraphQLResponse<Record<string, T>>>(
      METADATA_GRAPHQL_ENDPOINT,
      variables ? { query, variables } : { query },
    );
    const payload = response.data ?? {};

    ensureNoGraphqlErrors(payload);

    return payload;
  }
}

function looksLikeUuid(value: string): boolean {
  return value.length === 36 && value[8] === "-" && value[13] === "-";
}

function buildQueryConfig(
  params?: Record<string, string | undefined>,
): { params: Record<string, string> } | undefined {
  if (!params) {
    return undefined;
  }

  const filtered = Object.fromEntries(
    Object.entries(params).filter(([, value]) => value !== undefined && value !== ""),
  ) as Record<string, string>;

  if (Object.keys(filtered).length === 0) {
    return undefined;
  }

  return { params: filtered };
}

function ensureNoGraphqlErrors(payload: GraphQLResponse<unknown>): void {
  if (!Array.isArray(payload.errors) || payload.errors.length === 0) {
    return;
  }

  const message = payload.errors
    .map((error) => error.message?.trim())
    .filter((value): value is string => Boolean(value))
    .join("\n");

  throw new Error(message || "Metadata GraphQL request failed.");
}

function extractGraphqlField<T>(
  payload: GraphQLResponse<Record<string, T>>,
  key: string,
): T | undefined {
  return payload.data?.[key];
}

function extractGraphqlCollection(
  payload: GraphQLResponse<Record<string, MetadataResource[]>>,
  key: string,
): MetadataResource[] {
  const result = extractGraphqlField(payload, key);
  return Array.isArray(result) ? result : [];
}

function extractGraphqlResource(
  payload: GraphQLResponse<Record<string, MetadataResource>>,
  key: string,
): MetadataResource {
  const result = extractGraphqlField(payload, key);
  return (result && typeof result === "object" ? result : {}) as MetadataResource;
}
