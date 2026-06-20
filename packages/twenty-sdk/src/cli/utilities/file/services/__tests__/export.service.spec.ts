import fs from "fs-extra";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { ExportService } from "../export.service";

vi.mock("fs-extra");

describe("ExportService", () => {
  let service: ExportService;
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    service = new ExportService();
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.clearAllMocks();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  describe("JSON export", () => {
    it("outputs JSON to stdout when no file specified", async () => {
      const records = [{ id: "1", name: "Test" }];

      await service.export(records, { format: "json" });

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('"id": "1"'));
    });

    it("writes JSON to file when output specified", async () => {
      const records = [{ id: "1" }];
      vi.mocked(fs.writeFile).mockResolvedValue();

      await service.export(records, { format: "json", output: "/tmp/out.json" });

      expect(fs.writeFile).toHaveBeenCalledWith(
        "/tmp/out.json",
        expect.stringContaining('"id": "1"'),
      );
      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("Exported 1 records"));
    });

    it("formats JSON with indentation", async () => {
      const records = [{ id: "1", nested: { key: "value" } }];

      await service.export(records, { format: "json" });

      const output = consoleSpy.mock.calls[0][0];
      expect(output).toContain("  "); // Contains indentation
      expect(output).toContain('"nested"');
    });

    it("handles empty records array", async () => {
      const records: Record<string, unknown>[] = [];

      await service.export(records, { format: "json" });

      expect(consoleSpy).toHaveBeenCalledWith("[]");
    });
  });

  describe("CSV export", () => {
    it("outputs CSV to stdout when no file specified", async () => {
      const records = [{ id: "1", name: "Test" }];

      await service.export(records, { format: "csv" });

      const output = consoleSpy.mock.calls[0][0];
      expect(output).toContain("id");
      expect(output).toContain("name");
      expect(output).toContain("Test");
    });

    it("writes CSV to file when output specified", async () => {
      const records = [{ id: "1", name: "Test" }];
      vi.mocked(fs.writeFile).mockResolvedValue();

      await service.export(records, { format: "csv", output: "/tmp/out.csv" });

      expect(fs.writeFile).toHaveBeenCalledWith("/tmp/out.csv", expect.stringContaining("id"));
    });

    it("generates CSV header from record keys", async () => {
      const records = [{ firstName: "John", lastName: "Doe", email: "john@example.com" }];

      await service.export(records, { format: "csv" });

      const output = consoleSpy.mock.calls[0][0];
      expect(output).toContain("firstName");
      expect(output).toContain("lastName");
      expect(output).toContain("email");
    });

    it("handles multiple records", async () => {
      const records = [
        { id: "1", name: "First" },
        { id: "2", name: "Second" },
      ];

      await service.export(records, { format: "csv" });

      const output = consoleSpy.mock.calls[0][0];
      expect(output).toContain("First");
      expect(output).toContain("Second");
    });

    it("handles empty records array", async () => {
      const records: Record<string, unknown>[] = [];

      await service.export(records, { format: "csv" });

      expect(consoleSpy).toHaveBeenCalled();
    });

    it("escapes formula-like strings in CSV output", async () => {
      const records = [{ id: "1", name: '=HYPERLINK("https://example.com")' }];

      await service.export(records, { format: "csv" });

      const output = consoleSpy.mock.calls[0][0];
      expect(output).toContain("\"'=HYPERLINK");
      expect(output).not.toContain("\n1,=HYPERLINK");
    });
  });

  describe("file output", () => {
    it("reports correct record count for multiple records", async () => {
      const records = [{ id: "1" }, { id: "2" }, { id: "3" }];
      vi.mocked(fs.writeFile).mockResolvedValue();

      await service.export(records, { format: "json", output: "/tmp/out.json" });

      expect(consoleErrorSpy).toHaveBeenCalledWith("Exported 3 records to /tmp/out.json");
    });

    it("includes file path in success message", async () => {
      const records = [{ id: "1" }];
      vi.mocked(fs.writeFile).mockResolvedValue();

      await service.export(records, { format: "csv", output: "/custom/path/data.csv" });

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("/custom/path/data.csv"),
      );
    });
  });
});
