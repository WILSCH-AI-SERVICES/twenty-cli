import { ApiService } from "../../api/services/api.service";
import type { SearchReadBackend } from "../../readbackend/types";
import { ApiSearchService, type SearchOptions } from "./api-search.service";

type SearchApiClient = Pick<ApiService, "post">;

export type {
  SearchOptions,
  SearchPageInfo,
  SearchResponse,
  SearchResult,
} from "./api-search.service";

export class SearchService {
  private readonly readBackend: SearchReadBackend;

  constructor(api: SearchApiClient, readBackend?: SearchReadBackend) {
    if (readBackend) {
      this.readBackend = readBackend;
      return;
    }

    const apiSearch = new ApiSearchService(api);
    this.readBackend = {
      runSearch: (options) => apiSearch.search(options),
    };
  }

  async search(options: SearchOptions) {
    return this.readBackend.runSearch(options);
  }
}
