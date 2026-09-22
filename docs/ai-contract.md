# Live-AI authority boundary and output contract (#31)

> **AI interprets. The product controls evidence and state.**

This is the contract for the first live-AI version. Code: `src/ai/contract.js` (shapes), `src/ai/validate.js` (the gate), `src/ai/context.js` (what a model is given), `src/ai/baseline.js` (the deterministic producer and fallback). Evidence semantics: `docs/evidence-contract.md`.

## Who owns what

| The model may | The product (application logic) owns |
|---|---|
| Propose working taste hypotheses from typed evidence | Whether an action is experienced taste, intent, setting or lookup |
| Write the "Why this one?" for a pick, citing evidence | Provenance and source of every piece of evidence |
| Notice possible contradictions, exceptions, cross-domain links | User-confirmed vs model-inferred status (a model can never mark anything user-confirmed) |
| Propose refinements after feedback | Confidence thresholds (the same as the Taste Profile, #26) |
| Choose among eligible candidates | Which items are eligible (not seen, not reacted to, area on, in the curated pool) |
| Generate questions for reflective flows (later: Tastebreak) | All state changes and persistence; domain and context scoping; user corrections and their authority |

A model's answer is only ever a **proposal**. It is validated, stamped and then shown; it is never written into evidence.

## What the model is given
`buildContext(state)`: typed evidence records (`ref: "ev:<itemId>"`, kind, class, domains, source; see `evidence.js`), the eligible candidates, whether a curveball is allowed, user-confirmed statements about patterns, and contexts the user gave (none yet). Never a prose summary, and never anything it could mistake for permission to change state.

## Response shapes

**Hypotheses** `{ hypotheses: [...], insufficientEvidence }`. Each hypothesis: `label`, `claim`, `evidence` (refs, at least one), `counter` (refs), `domains`, `crossDomain` (untested / tentative / supported), `level` (emerging / supported / strong), `conditional`, `context` (null unless the user gave one). `insufficientEvidence: true` with an empty list is a valid answer.

**Picks** `{ picks: [...] }`. Each pick: `itemId` (one of the candidates), `why`, `cites` (refs, at least one), `tests` (hypothesis id or null), `kind` (pick / curveball).

## What the validator does (hard rules)

| Situation | What happens |
|---|---|
| Invalid structure | That proposal is rejected; if nothing valid is left, fall back |
| A citation points at evidence that doesn't exist | Rejected |
| Support cites intent (bookmark, untried More/Less, Not interested) | Rejected: interest is not experience |
| Support cites something the user disliked | Rejected: contradicts explicit evidence |
| Claims a domain with no cited support there | Rejected |
| Cross-domain status beyond what the evidence shows | Rejected: cross-domain links start as hypotheses |
| Confidence above what the evidence allows | **Kept, but lowered** to the product's level, and noted |
| The user said this pattern is "not me" | Rejected: user-confirmed outranks inference |
| States a single identity ("your aesthetic is...") | Rejected |
| Genre-only or too short to test ("likes fantasy") | Rejected |
| Invents a context the user never gave | Rejected |
| Pick not among the eligible candidates (invented, already seen, area off) | Rejected |
| Pick with no citations, or resting only on intent | Rejected |
| Circular reasoning ("matches your taste") | Rejected |
| More than one curveball, or a curveball when they are off | Rejected |
| Model error, timeout, or too little survives | **Fall back** to the deterministic result and say so |

Everything accepted is stamped `authority: "inferred"`, `source: "model"` and the contract version.

## Failing conservatively
`acceptOrFallback(result, deterministic)`: on an error, a timeout, or fewer valid items than needed, the product uses the deterministic answer (`src/ai/baseline.js`) and records why. It never fills gaps with invented certainty. Too little evidence is an acceptable answer.

## Not yet
- User-confirmed pattern statements are honored by the validator but can't be made in the UI yet (next step).
- Contexts (taste modes) aren't collected, so any context a model offers is rejected.
- The live call itself (a Vercel serverless function with the Anthropic API) comes after this.
