// User-facing recommendation copy must never expose internal evidence identifiers.
// Structured refs such as ev:tmdb-movie-123 remain available separately in ai.cites for validation/provenance.
export function sanitizeRecommendationCopy(text) {
  let value = String(text ?? "");
  if (!value) return "";

  value = value
    // Common model forms: (ev:...), **(ev:...)**, or a bare ev:... token.
    .replace(/\*{0,2}\(?\s*ev:[\w-]+\s*\)?[.,;:]?\*{0,2}/gi, "")
    // Clean punctuation/spacing left behind by removing a citation token.
    .replace(/\(\s*\)/g, "")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/([([{])\s+/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();

  // If the only visible content was an internal ref or markdown around it, render nothing rather
  // than leaking an implementation detail or leaving a punctuation-only rationale.
  if (!/[\p{L}\p{N}]/u.test(value)) return "";
  return value;
}
