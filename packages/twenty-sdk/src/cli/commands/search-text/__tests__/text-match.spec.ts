import { describe, expect, it } from "vitest";

import { findPhrase, likePatterns, phraseRegExp, transcriptText } from "../text-match";

describe("findPhrase", () => {
  it("finds a phrase the text wraps across a line", () => {
    const text = "about a long stay at The Nove, Nuvasa\nBay. I would like";
    expect(findPhrase(text, "Nuvasa Bay")?.excerpt).toContain("Nuvasa Bay");
  });

  it("matches an umlaut and ß as typed, in either case", () => {
    expect(findPhrase("Viele Grüße / Best regards", "grüße")).toBeDefined();
    expect(findPhrase("Viele Grüße / Best regards", "GRÜßE")).toBeDefined();
    expect(findPhrase("Viele Grüße / Best regards", "Gruse")).toBeUndefined();
  });

  it("matches an umlaut stored decomposed against one typed composed", () => {
    expect(findPhrase("Viele Grüße", "Grüße")).toBeDefined();
  });

  it("does not find words that stand apart", () => {
    expect(findPhrase("Nuvasa is far from the Bay", "Nuvasa Bay")).toBeUndefined();
  });

  it("takes regex and LIKE metacharacters literally", () => {
    expect(findPhrase("21 % tax (and service)", "21 % tax (and")).toBeDefined();
    expect(findPhrase("a.b", "a?b")).toBeUndefined();
  });
});

describe("likePatterns", () => {
  it("joins the words with % and escapes LIKE metacharacters", () => {
    expect(likePatterns(" Nuvasa  Bay ")).toEqual(["%Nuvasa%Bay%"]);
    expect(likePatterns("21 % tax_x")).toEqual(["%21%\\%%tax\\_x%"]);
  });

  it("adds the decomposed form when an umlaut is in the phrase", () => {
    expect(likePatterns("Grüße")).toEqual(["%Grüße%", "%Grüße%"]);
  });
});

describe("phraseRegExp", () => {
  it("refuses an empty phrase", () => {
    expect(() => phraseRegExp("   ")).toThrow();
  });
});

describe("transcriptText", () => {
  it("joins the segments' words in order, so a phrase said across two is found", () => {
    const transcript = [
      { words: [{ text: "Ja, ja, alles gut." }], participant: { name: "Speaker 1" } },
      { words: [{ text: "Ein bisschen anstrengender Tag" }], participant: { name: "Speaker 2" } },
    ];
    const text = transcriptText(transcript);
    expect(text).toBe("Ja, ja, alles gut. Ein bisschen anstrengender Tag");
    expect(findPhrase(text, "gut. Ein bisschen")).toBeDefined();
  });

  it("reads nothing out of a shape it does not know", () => {
    expect(transcriptText(null)).toBe("");
    expect(transcriptText([{ other: 1 }])).toBe("");
  });
});
