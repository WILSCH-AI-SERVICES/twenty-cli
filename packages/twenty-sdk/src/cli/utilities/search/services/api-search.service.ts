import { GraphQLResponse, formatGraphqlErrors } from "../../api/graphql-response";
import { ApiService } from "../../api/services/api.service";
import { CliError } from "../../errors/cli-error";

type SearchApiClient = Pick<ApiService, "post">;

const DEFAULT_SEARCH_LIMIT = 20;

export interface SearchResult {
  recordId: string;
  objectNameSingular: string;
  objectLabelSingular: string;
  label: string;
  imageUrl?: string | null;
  tsRankCD: number;
  tsRank: number;
  cursor?: string;
}

export interface SearchPageInfo {
  hasNextPage?: boolean;
  endCursor?: string;
}

export interface SearchResponse {
  data: SearchResult[];
  pageInfo?: SearchPageInfo;
}

export interface SearchOptions {
  query: string;
  limit?: number;
  objects?: string[];
  excludeObjects?: string[];
  after?: string;
  filter?: Record<string, unknown>;
}

type GraphQLSearchResponse = GraphQLResponse<{
  search?: {
    edges?: Array<{
      cursor: string;
      node: SearchResult;
    }>;
    pageInfo?: SearchPageInfo;
  };
}>;

export class ApiSearchService {
  constructor(private readonly api: SearchApiClient) {}

  async search(options: SearchOptions): Promise<SearchResponse> {
    const limit = options.limit ?? DEFAULT_SEARCH_LIMIT;
    const query = `
      query Search($searchInput: String!, $limit: Int!, $after: String, $filter: ObjectRecordFilterInput, $includedObjectNameSingulars: [String!], $excludedObjectNameSingulars: [String!]) {
        search(
          searchInput: $searchInput
          limit: $limit
          after: $after
          filter: $filter
          includedObjectNameSingulars: $includedObjectNameSingulars
          excludedObjectNameSingulars: $excludedObjectNameSingulars
        ) {
          edges {
            cursor
            node {
              recordId
              objectNameSingular
              objectLabelSingular
              label
              imageUrl
              tsRankCD
              tsRank
            }
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    `;
    const variables = {
      searchInput: options.query,
      limit,
      after: options.after,
      filter: options.filter,
      includedObjectNameSingulars: options.objects,
      excludedObjectNameSingulars: options.excludeObjects,
    };
    const response = await this.api.post<GraphQLSearchResponse>("/graphql", { query, variables });
    const payload = response.data;
    const errorMessage = formatGraphqlErrors(payload);

    if (errorMessage) {
      throw new CliError(errorMessage, "API_ERROR");
    }

    const search = payload.data?.search;

    return {
      data:
        search?.edges?.map((edge) => ({
          ...edge.node,
          cursor: edge.cursor,
        })) ?? [],
      pageInfo: search?.pageInfo,
    };
  }
}
