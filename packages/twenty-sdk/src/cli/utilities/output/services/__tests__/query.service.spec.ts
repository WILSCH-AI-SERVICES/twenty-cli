import { describe, it, expect } from "vitest";

import { QueryService } from "../query.service";

describe("QueryService", () => {
  const service = new QueryService();

  describe("apply", () => {
    it("extracts array elements", () => {
      const data = [
        { id: "1", name: "Alice" },
        { id: "2", name: "Bob" },
      ];
      const result = service.apply(data, "[*].name");
      expect(result).toEqual(["Alice", "Bob"]);
    });

    it("extracts nested properties", () => {
      const data = [{ id: "1", name: { first: "Alice", last: "Smith" } }];
      const result = service.apply(data, "[*].name.first");
      expect(result).toEqual(["Alice"]);
    });

    it("filters with conditions", () => {
      const data = [
        { id: "1", status: "active" },
        { id: "2", status: "inactive" },
        { id: "3", status: "active" },
      ];
      const result = service.apply(data, "[?status=='active'].id");
      expect(result).toEqual(["1", "3"]);
    });

    it("projects specific fields", () => {
      const data = [{ id: "1", name: "Alice", age: 30, city: "NYC" }];
      const result = service.apply(data, "[*].{id: id, name: name}");
      expect(result).toEqual([{ id: "1", name: "Alice" }]);
    });

    it("gets array length", () => {
      const data = [1, 2, 3, 4, 5];
      const result = service.apply(data, "length(@)");
      expect(result).toBe(5);
    });

    it("handles null/undefined data", () => {
      expect(service.apply(null, "[*].id")).toBeNull();
      expect(service.apply(undefined, "[*].id")).toBeNull();
    });

    it("handles empty arrays", () => {
      const result = service.apply([], "[*].id");
      expect(result).toEqual([]);
    });

    it("handles single object", () => {
      const data = { id: "1", name: "Test" };
      const result = service.apply(data, "name");
      expect(result).toBe("Test");
    });

    it("extracts first element", () => {
      const data = [
        { id: "1", name: "Alice" },
        { id: "2", name: "Bob" },
      ];
      const result = service.apply(data, "[0]");
      expect(result).toEqual({ id: "1", name: "Alice" });
    });

    it("extracts last element with negative index", () => {
      const data = [
        { id: "1", name: "Alice" },
        { id: "2", name: "Bob" },
      ];
      const result = service.apply(data, "[-1]");
      expect(result).toEqual({ id: "2", name: "Bob" });
    });

    it("slices arrays", () => {
      const data = [1, 2, 3, 4, 5];
      const result = service.apply(data, "[1:3]");
      expect(result).toEqual([2, 3]);
    });

    it("filters with numeric comparison", () => {
      const data = [
        { id: "1", age: 25 },
        { id: "2", age: 35 },
        { id: "3", age: 30 },
      ];
      const result = service.apply(data, "[?age > `30`].id");
      expect(result).toEqual(["2"]);
    });

    it("uses contains function", () => {
      const data = [
        { id: "1", tags: ["admin", "user"] },
        { id: "2", tags: ["user"] },
        { id: "3", tags: ["admin"] },
      ];
      const result = service.apply(data, "[?contains(tags, 'admin')].id");
      expect(result).toEqual(["1", "3"]);
    });

    it("sorts results", () => {
      const data = [
        { id: "1", name: "Charlie" },
        { id: "2", name: "Alice" },
        { id: "3", name: "Bob" },
      ];
      const result = service.apply(data, "sort_by(@, &name)[*].name");
      expect(result).toEqual(["Alice", "Bob", "Charlie"]);
    });

    it("pipes multiple expressions", () => {
      const data = [
        { id: "1", status: "active" },
        { id: "2", status: "inactive" },
        { id: "3", status: "active" },
      ];
      const result = service.apply(data, "[?status=='active'] | length(@)");
      expect(result).toBe(2);
    });

    it("handles deeply nested structures", () => {
      const data = {
        company: {
          departments: [
            { name: "Engineering", employees: [{ name: "Alice" }, { name: "Bob" }] },
            { name: "Sales", employees: [{ name: "Charlie" }] },
          ],
        },
      };
      const result = service.apply(data, "company.departments[*].employees[*].name");
      expect(result).toEqual([["Alice", "Bob"], ["Charlie"]]);
    });

    it("flattens nested arrays", () => {
      const data = {
        company: {
          departments: [
            { name: "Engineering", employees: [{ name: "Alice" }, { name: "Bob" }] },
            { name: "Sales", employees: [{ name: "Charlie" }] },
          ],
        },
      };
      const result = service.apply(data, "company.departments[].employees[].name");
      expect(result).toEqual(["Alice", "Bob", "Charlie"]);
    });

    it("returns null for non-existent path", () => {
      const data = { id: "1", name: "Test" };
      const result = service.apply(data, "nonexistent.path");
      expect(result).toBeNull();
    });
  });
});
