import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { TableService } from "../table.service";

describe("TableService", () => {
  let service: TableService;
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    service = new TableService();
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it("renders array of records as table", () => {
    const data = [
      { id: "1", name: "Alice" },
      { id: "2", name: "Bob" },
    ];

    service.render(data);

    const output = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("ID");
    expect(output).toContain("NAME");
    expect(output).toContain("Alice");
    expect(output).toContain("Bob");
  });

  it("handles single object by wrapping in array", () => {
    const data = { id: "1", name: "Alice" };

    service.render(data);

    const output = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("ID");
    expect(output).toContain("Alice");
  });

  it("shows message for empty array", () => {
    service.render([]);

    expect(consoleSpy).toHaveBeenCalledWith("No records found.");
  });

  it("shows message for null input", () => {
    service.render(null);

    expect(consoleSpy).toHaveBeenCalledWith("No records found.");
  });

  it("shows message for undefined input", () => {
    service.render(undefined);

    expect(consoleSpy).toHaveBeenCalledWith("No records found.");
  });

  it("prioritizes common columns (id, name, email)", () => {
    const data = [{ zebra: "z", id: "1", name: "Test", apple: "a" }];

    service.render(data);

    const headerLine = consoleSpy.mock.calls[0][0] as string;
    const idIndex = headerLine.indexOf("ID");
    const nameIndex = headerLine.indexOf("NAME");
    const zebraIndex = headerLine.indexOf("ZEBRA");

    // id and name should come before zebra
    expect(idIndex).toBeLessThan(zebraIndex);
    expect(nameIndex).toBeLessThan(zebraIndex);
  });

  it("sorts non-priority columns alphabetically", () => {
    const data = [{ zebra: "z", id: "1", apple: "a", mango: "m" }];

    service.render(data);

    const headerLine = consoleSpy.mock.calls[0][0] as string;
    const appleIndex = headerLine.indexOf("APPLE");
    const mangoIndex = headerLine.indexOf("MANGO");
    const zebraIndex = headerLine.indexOf("ZEBRA");

    // Non-priority columns should be sorted alphabetically
    expect(appleIndex).toBeLessThan(mangoIndex);
    expect(mangoIndex).toBeLessThan(zebraIndex);
  });

  it("truncates long values to 60 characters", () => {
    const data = [{ id: "1", description: "A".repeat(200) }];

    service.render(data);

    // Should not output 200 A's in full
    const output = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output.length).toBeLessThan(400);
    // The column width is capped at 60
    expect(output).not.toContain("A".repeat(61));
  });

  it("handles nested objects by stringifying", () => {
    const data = [{ id: "1", meta: { foo: "bar" } }];

    service.render(data);

    const output = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("foo");
    expect(output).toContain("bar");
  });

  it("handles arrays by stringifying", () => {
    const data = [{ id: "1", tags: ["a", "b", "c"] }];

    service.render(data);

    const output = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain('["a","b","c"]');
  });

  it("handles boolean values", () => {
    const data = [{ id: "1", active: true, deleted: false }];

    service.render(data);

    const output = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("true");
    expect(output).toContain("false");
  });

  it("handles numeric values", () => {
    const data = [{ id: "1", count: 42, price: 19.99 }];

    service.render(data);

    const output = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("42");
    expect(output).toContain("19.99");
  });

  it("handles null values as empty string", () => {
    const data = [{ id: "1", name: null }];

    service.render(data);

    const output = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("ID");
    expect(output).toContain("NAME");
  });

  it("handles single primitive value", () => {
    service.render("simple string");

    expect(consoleSpy).toHaveBeenCalledWith("simple string");
  });

  it("handles single number value", () => {
    service.render(42);

    expect(consoleSpy).toHaveBeenCalledWith("42");
  });

  it("renders multiple rows with consistent column widths", () => {
    const data = [
      { id: "1", name: "Short" },
      { id: "2", name: "Much Longer Name" },
    ];

    service.render(data);

    const lines = consoleSpy.mock.calls.map((c) => c[0]);
    // Header and two data rows
    expect(lines).toHaveLength(3);
    // All lines should have NAME column
    expect(lines[0]).toContain("NAME");
    expect(lines[1]).toContain("Short");
    expect(lines[2]).toContain("Much Longer Name");
  });

  it("uses priority order: id, name, email, title, status, createdAt", () => {
    const data = [
      {
        createdAt: "2024-01-01",
        status: "active",
        title: "Test",
        email: "test@example.com",
        name: "John",
        id: "1",
      },
    ];

    service.render(data);

    const headerLine = consoleSpy.mock.calls[0][0] as string;
    const idPos = headerLine.indexOf("ID");
    const namePos = headerLine.indexOf("NAME");
    const emailPos = headerLine.indexOf("EMAIL");
    const titlePos = headerLine.indexOf("TITLE");
    const statusPos = headerLine.indexOf("STATUS");
    const createdAtPos = headerLine.indexOf("CREATEDAT");

    expect(idPos).toBeLessThan(namePos);
    expect(namePos).toBeLessThan(emailPos);
    expect(emailPos).toBeLessThan(titlePos);
    expect(titlePos).toBeLessThan(statusPos);
    expect(statusPos).toBeLessThan(createdAtPos);
  });
});
