// User-facing recommendation copy must never expose internal evidence identifiers.
// Structured refs such as ev:tmdb-movie-123 remain available separately in ai.cites for validation/provenance.
const INTERNAL_RETRIEVAL_LANGUAGE = /\b(catalog (?:neighbor|neighborhood|branch|path|cluster|signals?)|provider relationship|provider data|nearby metadata|metadata (?:path|relationship)|catalog relationship|catalog overlap|retrieval (?:path|signal|source)|embedding|similarity score)\b/i;

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

  // Retrieval provenance is useful for debugging, not for explaining taste to a user. If a model
  // leaks provider/catalog plumbing into its rationale, discard that rationale and let the caller
  // substitute a plain, user-facing fallback.
  if (INTERNAL_RETRIEVAL_LANGUAGE.test(value)) return "";

  // If the only visible content was an internal ref or markdown around it, render nothing rather
  // than leaking an implementation detail or leaving a punctuation-only rationale.
  if (!/[\p{L}\p{N}]/u.test(value)) return "";
  return value;
}
