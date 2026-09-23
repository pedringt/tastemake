// #37: a lightweight, append-only revision history for taste hypotheses.
//
// Why: once live AI generates and revises hypotheses, an interpretation can become an opaque
// current-state blob unless something records what Tastemake used to think, what evidence changed
// it, and whether the user or the model made the change. This module is that record. It is
// deliberately small: append/query only, no UI, no automatic "taste eras" — see the issue's
// non-goals. A revision is never edited or deleted; only added, so `latestRevision` always answers
// "what does Tastemake think now" while `revisionsFor` keeps everything that came before inspectable.
//
// A revision entry:
//   id            stable, unique within this session
//   hypothesisId  which pattern this is about
//   claim         the interpretation text at this point
//   supports      evidence refs (ev:*) that backed it here
//   counters      evidence refs that counted against it here
//   domains       domain/context scope at this point
//   level         confidence/maturity label at this point (Emerging/Supported/Strong/etc.)
//   origin        "model" | "user-confirmed" | "system" — who made this revision
//   reason        short human-readable reason this revision exists, if known
//   createdAt     ISO timestamp
//   supersedes    the id of the revision this one replaces as "current", or null for the first

let counter = 0;
function nextId() {
  counter += 1;
  return `rev-${Date.now().toString(36)}-${counter}`;
}

export function revisionsFor(state, hypothesisId) {
  return (state.hypothesisHistory ?? []).filter((r) => r.hypothesisId === hypothesisId);
}

export function latestRevision(state, hypothesisId) {
  const list = revisionsFor(state, hypothesisId);
  return list.length ? list[list.length - 1] : null;
}

// Appends a revision and returns it. `supersedes` is filled in automatically from the current
// latest revision for this hypothesis unless the caller passes one explicitly.
export function recordRevision(state, entry) {
  state.hypothesisHistory ??= [];
  const previous = latestRevision(state, entry.hypothesisId);
  const revision = {
    id: nextId(),
    hypothesisId: entry.hypothesisId,
    claim: entry.claim ?? previous?.claim ?? null,
    supports: entry.supports ?? [],
    counters: entry.counters ?? [],
    domains: entry.domains ?? [],
    level: entry.level ?? null,
    origin: entry.origin,
    reason: entry.reason ?? null,
    createdAt: entry.createdAt ?? new Date().toISOString(),
    supersedes: entry.supersedes !== undefined ? entry.supersedes : (previous?.id ?? null)
  };
  state.hypothesisHistory.push(revision);
  return revision;
}

// All revisions in insertion order (oldest first), across every hypothesis. Useful for evals/debugging
// ("what changed this session") without having to know hypothesis ids up front.
export function allRevisions(state) {
  return state.hypothesisHistory ?? [];
}
