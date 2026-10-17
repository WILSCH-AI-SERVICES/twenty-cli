/**
 * The matching half of `twenty search-text` (#3355), kept pure so it is tested apart from the
 * instance. A phrase is its words in order, any run of whitespace between them — a mail's text
 * wraps lines mid-sentence, so "Nuvasa Bay" stands in it as "Nuvasa\nBay". Case is folded with
 * umlauts included, so "GRÜßE" finds "Grüße", and a word is matched as typed — with its umlaut
 * or ß, never only retyped without it. Text and phrase are both brought to NFC first, so an
 * umlaut stored decomposed still matches one typed composed.
 */

export function phraseWords(phrase: string): string[] {
  return phrase.normalize("NFC").trim().split(/\s+/u).filter(Boolean);
}

function escapeRegExp(word: string): string {
  return word.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

export function phraseRegExp(phrase: string): RegExp {
  const words = phraseWords(phrase);
  if (words.length === 0) {
    throw new Error("empty phrase");
  }
  return new RegExp(words.map(escapeRegExp).join("\\s+"), "iu");
}

/** The SQL LIKE metacharacters escaped, so a phrase holding `%` or `_` matches them literally. */
function escapeLike(word: string): string {
  return word.replace(/[\\%_]/gu, "\\$&");
}

/**
 * The ILIKE patterns the instance narrows mails by: the words in order with anything between,
 * once composed (NFC) and once decomposed (NFD) when the two differ. It is a coarse sieve —
 * `%Nuvasa%Bay%` also passes "Nuvasa … far below … Bay" — and every row it passes is checked
 * against `phraseRegExp` before it is a hit.
 */
export function likePatterns(phrase: string): string[] {
  const words = phraseWords(phrase);
  const composed = `%${words.map(escapeLike).join("%")}%`;
  const decomposed = composed.normalize("NFD");
  return composed === decomposed ? [composed] : [composed, decomposed];
}

export interface TextMatch {
  index: number;
  excerpt: string;
}

/** Where the phrase stands in the text, with a one-line excerpt around it; undefined if absent. */
export function findPhrase(text: string, phrase: string, radius = 80): TextMatch | undefined {
  const normalized = text.normalize("NFC");
  const match = phraseRegExp(phrase).exec(normalized);
  if (!match) {
    return undefined;
  }
  const start = Math.max(0, match.index - radius);
  const end = Math.min(normalized.length, match.index + match[0].length + radius);
  const excerpt =
    (start > 0 ? "…" : "") +
    normalized.slice(start, end).replace(/\s+/gu, " ").trim() +
    (end < normalized.length ? "…" : "");
  return { index: match.index, excerpt };
}

/**
 * A CallRecording's transcript as one text: its segments' words in spoken order, one space
 * between them, so a phrase said across two segments is still found. The transcript is the
 * RAW_JSON the adapter stores — `[{ words: [{ text }], participant }]`; anything else in it
 * is ignored rather than guessed at.
 */
export function transcriptText(transcript: unknown): string {
  if (!Array.isArray(transcript)) {
    return typeof transcript === "string" ? transcript : "";
  }
  const parts: string[] = [];
  for (const segment of transcript) {
    const words = (segment as { words?: unknown })?.words;
    if (!Array.isArray(words)) continue;
    for (const word of words) {
      const text = (word as { text?: unknown })?.text;
      if (typeof text === "string" && text.trim()) parts.push(text.trim());
    }
  }
  return parts.join(" ");
}
