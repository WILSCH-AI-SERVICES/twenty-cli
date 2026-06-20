import { describe, it, expect } from "vitest";

import { formatSearchTerms } from "../db-search-terms";

describe("formatSearchTerms", () => {
  it("returns empty string on empty input", () => {
    expect(formatSearchTerms("", "and")).toBe("");
    expect(formatSearchTerms("   ", "or")).toBe("");
  });

  it("prefix-matches a single word with :*", () => {
    expect(formatSearchTerms("john", "and")).toBe("john:*");
    expect(formatSearchTerms("john", "or")).toBe("john:*");
  });

  it("AND-joins multiple words with &", () => {
    expect(formatSearchTerms("john doe", "and")).toBe("john:* & doe:*");
  });

  it("OR-joins multiple words with |", () => {
    expect(formatSearchTerms("john doe", "or")).toBe("john:* | doe:*");
  });

  it("escapes tsquery special characters", () => {
    expect(formatSearchTerms("o'brien", "and")).toBe("o\\'brien:*");
    expect(formatSearchTerms("a&b", "and")).toBe("a\\&b:*");
    expect(formatSearchTerms("a|b", "or")).toBe("a\\|b:*");
    expect(formatSearchTerms("a:b", "and")).toBe("a\\:b:*");
  });

  it("collapses repeated whitespace", () => {
    expect(formatSearchTerms("  john   doe  ", "and")).toBe("john:* & doe:*");
  });
});
