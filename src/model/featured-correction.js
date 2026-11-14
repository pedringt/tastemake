// #319: one real correction, read straight from the saved record, so the example's Overview can show it
// apart from the strongest six (which stay ranked as before). Nothing here is inferred or reconstructed:
//   inferred  the last model revision of the pattern before the user's answer, or null if none was saved
//   answer    the user-confirmed revision that recorded the answer (its reason is the app's own message)
//   later     model revisions recorded after the answer (empty means the pattern has not changed since)
// Only answers that push back on an inference count: "partly accurate", "not me", "not sure yet".
// A plain "accurate" is a confirmation, not a correction.
import { revisionsFor } from "./history.js";
import { statementFor } from "./statements.js";

export const CORRECTION_ANSWERS = ["partial", "not-me", "unsure"];

export function featuredCorrection(state) {
  const candidates = [];
  for (const pattern of state.modelHypotheses ?? []) {
    const said = statementFor(state, pattern.id);
    if (!CORRECTION_ANSWERS.includes(said?.says)) continue;
    const revisions = revisionsFor(state, pattern.id);
    const answerIndex = revisions.findLastIndex((revision) => revision.origin === "user-confirmed");
    if (answerIndex < 0) continue;   // no recorded answer: nothing verifiable to feature
    const answer = revisions[answerIndex];
    const inferred = revisions.slice(0, answerIndex).findLast((revision) => revision.origin === "model") ?? null;
    const later = revisions.slice(answerIndex + 1).filter((revision) => revision.origin === "model");
    candidates.push({ pattern, said, answer, inferred, later });
  }
  // The most recent answer wins; ISO timestamps sort as text.
  candidates.sort((a, b) => String(b.answer.createdAt ?? "").localeCompare(String(a.answer.createdAt ?? "")));
  return candidates[0] ?? null;
}
