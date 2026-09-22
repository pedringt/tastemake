// One escaping helper for everything that goes into an HTML string (#38).
//
// Screens render with template strings and innerHTML, so any value that did not come from this repo's
// own source must be escaped: titles the user typed, imported catalog text, and anything a model wrote
// (pick reasons, hypothesis labels and claims). Model prose is untrusted text, not markup.
//
// Use esc() for text and attribute values. For anything richer, build DOM nodes instead.
const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ESCAPES[char]);
}
