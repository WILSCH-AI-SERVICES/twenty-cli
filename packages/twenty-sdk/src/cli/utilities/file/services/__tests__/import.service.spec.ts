import fs from "fs-extra";
import { describe, it, expect, vi, beforeEach } from "vitest";

import { ImportService } from "../import.service";

vi.mock("fs-extra");

describe("ImportService", () => {
  let service: ImportService;

  beforeEach(() => {
    service = new ImportService();
    vi.clearAllMocks();
  });

  describe("JSON import", () => {
    it("parses JSON array file", async () => {
      vi.mocked(fs.readFile).mockResolvedValue('[{"id":"1"},{"id":"2"}]');

      const result = await service.import("/path/to/file.json");

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ id: "1" });
    });

    it("wraps single JSON object in array", async () => {
      vi.mocked(fs.readFile).mockResolvedValue('{"id":"1","name":"Test"}');

      const result = await service.import("/path/to/file.json");

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ id: "1", name: "Test" });
    });
  });

  describe("CSV import", () => {
    it("parses CSV with headers", async () => {
      vi.mocked(fs.readFile).mockResolvedValue("id,name\n1,Alice\n2,Bob");

      const result = await service.import("/path/to/file.csv");

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ id: "1", name: "Alice" });
      expect(result[1]).toEqual({ id: "2", name: "Bob" });
    });

    it("trims header whitespace", async () => {
      vi.mocked(fs.readFile).mockResolvedValue(" id , name \n1,Alice");

      const result = await service.import("/path/to/file.csv");

      expect(result[0]).toHaveProperty("id");
      expect(result[0]).toHaveProperty("name");
    });

    it("skips empty lines", async () => {
      vi.mocked(fs.readFile).mockResolvedValue("id,name\n1,Alice\n\n2,Bob\n");

      const result = await service.import("/path/to/file.csv");

      expect(result).toHaveLength(2);
    });
  });

  describe("error handling", () => {
    it("throws for unsupported file extension", async () => {
      vi.mocked(fs.readFile).mockResolvedValue("data");

      await expect(service.import("/path/to/file.xml")).rejects.toThrow("Unsupported file format");
    });
  });
});
