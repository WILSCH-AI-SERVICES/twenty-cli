import { describe, it, expect } from "vitest";

import {
  capitalize,
  singularize,
  parsePrimitive,
  parseKeyValuePairs,
  splitOnce,
  chunkArray,
  parseBooleanEnv,
  applySet,
  mergeSets,
} from "../parse";

describe("parse utilities", () => {
  describe("capitalize", () => {
    it("capitalizes first letter", () => {
      expect(capitalize("person")).toBe("Person");
      expect(capitalize("task")).toBe("Task");
    });

    it("preserves rest of string", () => {
      expect(capitalize("PERSON")).toBe("PERSON");
      expect(capitalize("personName")).toBe("PersonName");
    });

    it("handles empty string", () => {
      expect(capitalize("")).toBe("");
    });

    it("handles single character", () => {
      expect(capitalize("a")).toBe("A");
    });
  });

  describe("singularize", () => {
    it("handles regular plurals ending in s", () => {
      expect(singularize("tasks")).toBe("task");
      expect(singularize("notes")).toBe("note");
      expect(singularize("users")).toBe("user");
    });

    it("handles plurals ending in ies", () => {
      expect(singularize("companies")).toBe("company");
      expect(singularize("stories")).toBe("story");
      expect(singularize("entries")).toBe("entry");
    });

    it("handles plurals ending in ses", () => {
      expect(singularize("addresses")).toBe("address");
      expect(singularize("classes")).toBe("class");
    });

    it("handles irregular plurals", () => {
      expect(singularize("people")).toBe("person");
      expect(singularize("men")).toBe("man");
      expect(singularize("women")).toBe("woman");
      expect(singularize("children")).toBe("child");
    });

    it("returns original if already singular", () => {
      expect(singularize("task")).toBe("task");
      expect(singularize("person")).toBe("person");
    });

    it("preserves words ending in ss", () => {
      expect(singularize("class")).toBe("class");
      expect(singularize("boss")).toBe("boss");
    });
  });

  describe("parsePrimitive", () => {
    it("parses boolean true", () => {
      expect(parsePrimitive("true")).toBe(true);
    });

    it("parses boolean false", () => {
      expect(parsePrimitive("false")).toBe(false);
    });

    it("parses null", () => {
      expect(parsePrimitive("null")).toBe(null);
    });

    it("parses integers", () => {
      expect(parsePrimitive("42")).toBe(42);
      expect(parsePrimitive("0")).toBe(0);
      expect(parsePrimitive("-10")).toBe(-10);
    });

    it("parses floats", () => {
      expect(parsePrimitive("3.14")).toBe(3.14);
      expect(parsePrimitive("-2.5")).toBe(-2.5);
    });

    it("returns strings for non-primitives", () => {
      expect(parsePrimitive("hello")).toBe("hello");
      expect(parsePrimitive("hello world")).toBe("hello world");
    });

    it("handles empty string", () => {
      expect(parsePrimitive("")).toBe("");
    });

    it("trims whitespace", () => {
      expect(parsePrimitive("  true  ")).toBe(true);
      expect(parsePrimitive("  42  ")).toBe(42);
      expect(parsePrimitive("  hello  ")).toBe("hello");
    });

    it("parses JSON objects", () => {
      expect(parsePrimitive('{"key":"value"}')).toEqual({ key: "value" });
    });

    it("parses JSON arrays", () => {
      expect(parsePrimitive("[1,2,3]")).toEqual([1, 2, 3]);
    });

    it("parses JSON strings", () => {
      expect(parsePrimitive('"quoted"')).toBe("quoted");
    });

    it("returns original string for invalid JSON", () => {
      expect(parsePrimitive("{invalid}")).toBe("{invalid}");
    });
  });

  describe("parseKeyValuePairs", () => {
    it("parses key=value pairs", () => {
      const result = parseKeyValuePairs(["foo=bar", "baz=qux"]);
      expect(result).toEqual({ foo: ["bar"], baz: ["qux"] });
    });

    it("groups multiple values for same key", () => {
      const result = parseKeyValuePairs(["key=val1", "key=val2"]);
      expect(result).toEqual({ key: ["val1", "val2"] });
    });

    it("handles empty array", () => {
      expect(parseKeyValuePairs([])).toEqual({});
    });

    it("handles undefined", () => {
      expect(parseKeyValuePairs(undefined)).toEqual({});
    });

    it("handles key with empty value", () => {
      const result = parseKeyValuePairs(["key="]);
      expect(result).toEqual({ key: [""] });
    });

    it("handles value containing equals sign", () => {
      const result = parseKeyValuePairs(["url=http://example.com?foo=bar"]);
      expect(result).toEqual({ url: ["http://example.com?foo=bar"] });
    });

    it("handles pair without equals as key with empty value", () => {
      // splitOnce returns ['invalid', ''] when no delimiter found
      // parseKeyValuePairs then treats this as key='invalid', value=''
      const result = parseKeyValuePairs(["invalid"]);
      expect(result).toEqual({ invalid: [""] });
    });
  });

  describe("splitOnce", () => {
    it("splits on first occurrence", () => {
      expect(splitOnce("a=b=c", "=")).toEqual(["a", "b=c"]);
    });

    it("returns original if delimiter not found", () => {
      expect(splitOnce("abc", "=")).toEqual(["abc", ""]);
    });

    it("handles empty string", () => {
      expect(splitOnce("", "=")).toEqual(["", ""]);
    });

    it("handles delimiter at start", () => {
      expect(splitOnce("=value", "=")).toEqual(["", "value"]);
    });

    it("handles delimiter at end", () => {
      expect(splitOnce("key=", "=")).toEqual(["key", ""]);
    });

    it("handles multi-character delimiter", () => {
      expect(splitOnce("a::b::c", "::")).toEqual(["a", "b::c"]);
    });
  });

  describe("chunkArray", () => {
    it("chunks array into specified sizes", () => {
      expect(chunkArray([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    });

    it("handles empty array", () => {
      expect(chunkArray([], 2)).toEqual([]);
    });

    it("handles array smaller than chunk size", () => {
      expect(chunkArray([1, 2], 5)).toEqual([[1, 2]]);
    });

    it("handles chunk size equal to array length", () => {
      expect(chunkArray([1, 2, 3], 3)).toEqual([[1, 2, 3]]);
    });

    it("handles chunk size of 1", () => {
      expect(chunkArray([1, 2, 3], 1)).toEqual([[1], [2], [3]]);
    });

    it("throws for zero chunk size", () => {
      expect(() => chunkArray([1, 2, 3], 0)).toThrow("Chunk size must be a positive integer.");
    });

    it("throws for negative chunk size", () => {
      expect(() => chunkArray([1, 2, 3], -1)).toThrow("Chunk size must be a positive integer.");
    });

    it("throws for fractional chunk size", () => {
      expect(() => chunkArray([1, 2, 3], 1.5)).toThrow("Chunk size must be a positive integer.");
    });
  });

  describe("parseBooleanEnv", () => {
    it("parses truthy values", () => {
      expect(parseBooleanEnv("true")).toBe(true);
      expect(parseBooleanEnv("1")).toBe(true);
      expect(parseBooleanEnv("yes")).toBe(true);
    });

    it("parses truthy values case-insensitively", () => {
      expect(parseBooleanEnv("TRUE")).toBe(true);
      expect(parseBooleanEnv("True")).toBe(true);
      expect(parseBooleanEnv("YES")).toBe(true);
    });

    it("parses falsy values", () => {
      expect(parseBooleanEnv("false")).toBe(false);
      expect(parseBooleanEnv("0")).toBe(false);
      expect(parseBooleanEnv("no")).toBe(false);
    });

    it("parses falsy values case-insensitively", () => {
      expect(parseBooleanEnv("FALSE")).toBe(false);
      expect(parseBooleanEnv("False")).toBe(false);
      expect(parseBooleanEnv("NO")).toBe(false);
    });

    it("returns undefined for invalid value", () => {
      expect(parseBooleanEnv("maybe")).toBe(undefined);
      expect(parseBooleanEnv("invalid")).toBe(undefined);
      expect(parseBooleanEnv("")).toBe(undefined);
    });

    it("returns undefined for undefined input", () => {
      expect(parseBooleanEnv(undefined)).toBe(undefined);
    });
  });

  describe("applySet", () => {
    it("sets simple property", () => {
      const obj: Record<string, unknown> = {};
      applySet(obj, "name=Test");
      expect(obj.name).toBe("Test");
    });

    it("sets nested property", () => {
      const obj: Record<string, unknown> = {};
      applySet(obj, "meta.foo=bar");
      expect((obj.meta as Record<string, unknown>).foo).toBe("bar");
    });

    it("sets deeply nested property", () => {
      const obj: Record<string, unknown> = {};
      applySet(obj, "a.b.c.d=value");
      expect(
        (
          ((obj.a as Record<string, unknown>).b as Record<string, unknown>).c as Record<
            string,
            unknown
          >
        ).d,
      ).toBe("value");
    });

    it("parses primitive values", () => {
      const obj: Record<string, unknown> = {};
      applySet(obj, "count=42");
      expect(obj.count).toBe(42);
      applySet(obj, "enabled=true");
      expect(obj.enabled).toBe(true);
    });

    it("preserves existing nested objects", () => {
      const obj: Record<string, unknown> = { meta: { existing: "value" } };
      applySet(obj, "meta.new=added");
      expect(obj.meta).toEqual({ existing: "value", new: "added" });
    });

    it("handles empty value", () => {
      const obj: Record<string, unknown> = {};
      applySet(obj, "key=");
      expect(obj.key).toBe("");
    });

    it("throws on empty key", () => {
      const obj: Record<string, unknown> = {};
      expect(() => applySet(obj, "=value")).toThrow(
        'Invalid set expression "=value" (expected key=value)',
      );
    });

    it("throws on empty path segment", () => {
      const obj: Record<string, unknown> = {};
      expect(() => applySet(obj, "a..b=value")).toThrow(
        'Invalid set expression "a..b=value" (empty path segment)',
      );
    });

    it("throws when path conflicts with non-object", () => {
      const obj: Record<string, unknown> = { name: "string" };
      expect(() => applySet(obj, "name.nested=value")).toThrow(
        'Set path "name.nested" conflicts with non-object value',
      );
    });

    it("throws when path conflicts with array", () => {
      const obj: Record<string, unknown> = { items: [1, 2, 3] };
      expect(() => applySet(obj, "items.nested=value")).toThrow(
        'Set path "items.nested" conflicts with non-object value',
      );
    });

    it.each(["__proto__", "constructor", "prototype"])(
      "throws on unsafe path segment %s",
      (segment) => {
        const obj: Record<string, unknown> = {};
        expect(() => applySet(obj, `${segment}.polluted=true`)).toThrow(
          `unsafe path segment "${segment}"`,
        );
      },
    );
  });

  describe("mergeSets", () => {
    it("merges sets into base object", () => {
      const base = { existing: "value" };
      const result = mergeSets(base, ["name=Test", "count=42"]);
      expect(result).toEqual({ existing: "value", name: "Test", count: 42 });
    });

    it("does not mutate base object", () => {
      const base = { existing: "value" };
      const result = mergeSets(base, ["name=Test"]);
      expect(base).toEqual({ existing: "value" });
      expect(result).toEqual({ existing: "value", name: "Test" });
    });

    it("handles undefined sets", () => {
      const base = { existing: "value" };
      const result = mergeSets(base, undefined);
      expect(result).toEqual({ existing: "value" });
    });

    it("handles empty sets array", () => {
      const base = { existing: "value" };
      const result = mergeSets(base, []);
      expect(result).toEqual({ existing: "value" });
    });

    it("overwrites existing values", () => {
      const base = { name: "Old" };
      const result = mergeSets(base, ["name=New"]);
      expect(result).toEqual({ name: "New" });
    });

    it("handles nested sets", () => {
      const base = {};
      const result = mergeSets(base, ["user.name=John", "user.age=30"]);
      expect(result).toEqual({ user: { name: "John", age: 30 } });
    });
  });
});
