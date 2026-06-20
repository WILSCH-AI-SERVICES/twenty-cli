const SPECIAL_CHARS = /[\\:'&|!()@<>]/g;

export function formatSearchTerms(input: string, op: "and" | "or"): string {
  const trimmed = input.trim();
  if (!trimmed) return "";
  const sep = op === "and" ? " & " : " | ";
  return trimmed
    .split(/\s+/)
    .map((word) => `${word.replace(SPECIAL_CHARS, "\\$&")}:*`)
    .join(sep);
}
