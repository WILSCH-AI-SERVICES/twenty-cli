import { describe, expect, it, vi } from "vitest";

import { SearchService } from "../search.service";

describe("SearchService", () => {
  describe("search", () => {
    it("delegates through the shared read backend when provided", async () => {
      const mockApi = {
        post: vi.fn(),
      };
      const mockReadBackend = {
        runSearch: vi.fn().mockResolvedValue({
          data: [{ recordId: "1", label: "John" }],
          pageInfo: { hasNextPage: false },
        }),
      };

      const service = new SearchService(mockApi as never, mockReadBackend as never);
      const options = {
        query: "john",
        limit: 5,
        objects: ["person"],
        excludeObjects: ["note"],
        after: "cursor-1",
        filter: { city: { eq: "NYC" } },
      };
      const result = await service.search(options);

      expect(mockReadBackend.runSearch).toHaveBeenCalledWith(options);
      expect(mockApi.post).not.toHaveBeenCalled();
      expect(result).toEqual({
        data: [{ recordId: "1", label: "John" }],
        pageInfo: { hasNextPage: false },
      });
    });

    it("uses the API implementation when no shared read backend is provided", async () => {
      const mockApi = {
        post: vi.fn().mockResolvedValue({
          data: {
            data: {
              search: {
                edges: [
                  {
                    cursor: "cursor-1",
                    node: {
                      recordId: "1",
                      objectNameSingular: "person",
                      objectLabelSingular: "Person",
                      label: "John",
                      imageUrl: null,
                      tsRankCD: 0.9,
                      tsRank: 0.8,
                    },
                  },
                ],
                pageInfo: {
                  hasNextPage: false,
                  endCursor: "cursor-1",
                },
              },
            },
          },
        }),
      };

      const service = new SearchService(mockApi as never);
      const result = await service.search({ query: "john" });

      expect(mockApi.post).toHaveBeenCalledWith("/graphql", {
        query: expect.stringContaining("query Search"),
        variables: {
          searchInput: "john",
          limit: 20,
          after: undefined,
          filter: undefined,
          includedObjectNameSingulars: undefined,
          excludedObjectNameSingulars: undefined,
        },
      });
      expect(result).toEqual({
        data: [
          {
            recordId: "1",
            objectNameSingular: "person",
            objectLabelSingular: "Person",
            label: "John",
            imageUrl: null,
            tsRankCD: 0.9,
            tsRank: 0.8,
            cursor: "cursor-1",
          },
        ],
        pageInfo: {
          hasNextPage: false,
          endCursor: "cursor-1",
        },
      });
    });
  });
});
