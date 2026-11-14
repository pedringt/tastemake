// R-1 (Nov 4, 2026): the Taste Profile's "Learning out loud" panel reported every correction as
// "Where this pattern applies changed", because a user answer is recorded without the pattern's
// categories, supports or level and was compared field by field with the refresh before it. The next
// refresh after a correction had the mirror problem (an empty supports list read as "gained another
// supporting example"). These checks render the real Profile screen for each history shape.
import { createSuite } from "./lib/assert.mjs";

const stored = new Map();
globalThis.localStorage = { getItem: (k) => stored.get(k) ?? null, setItem: (k, v) => stored.set(k, String(v)), removeItem: (k) => stored.delete(k) };
globalThis.sessionStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
globalThis.document = { documentElement: { dataset: {} }, querySelector: () => null };

const { check, finish } = createSuite("learning panel tests");
const { state, resetState } = await import("../../src/state.js");
const { renderProfile } = await import("../../src/screens/profile.js");
const { setStatement } = await import("../../src/model/statements.js");
const { recordRevision } = await import("../../src/model/history.js");

const CATEGORY_CHANGE = "Where this pattern applies changed.";
const NEW_SUPPORT = "This pattern gained another supporting example.";
const ANSWER_CONSEQUENCE = "Tastemake keeps your answer alongside its own read of this pattern.";

const pattern = {
  id: "ai-test-pattern", title: "Quiet dread", label: "Quiet dread",
  claim: "Responds to slow, quiet dread more than jump scares across films and books.",
  evidence: "Arrival, Annihilation", supports: ["ev:a", "ev:b"], counters: [], domains: ["movies", "read"],
  strength: "Supported", status: "supported", level: "supported"
};
const refresh = (overrides = {}) => recordRevision(state, {
  hypothesisId: pattern.id, claim: pattern.claim, supports: pattern.supports, counters: [], domains: pattern.domains,
  level: "supported", origin: "model", reason: "Live Taste Profile refresh", ...overrides
});

function setup() {
  resetState();
  Object.assign(state, { displayName: "Test", setupComplete: true, onboarded: true, profileView: "list" });
  state.modelHypotheses = [{ ...pattern }];
  state.hypothesisHistory = [];
  state.patternStatements = [];
}
// The panel's text only (it is the <section class="profile-learning"> block).
const panel = () => (renderProfile().match(/<section class="profile-learning"[\s\S]*?<\/section>/) ?? [""])[0];

// 1. A user answer with no category change: the answer is reported as itself.
setup();
refresh();
setStatement(state, pattern.id, "says", "accurate");
let html = panel();
check("1. answer: no false category change", !html.includes(CATEGORY_CHANGE));
check("1. answer: no false new supporting example", !html.includes(NEW_SUPPORT));
check("1. answer: the user's own answer is shown", html.includes("Quiet dread: You said this is accurate.") || /You said this is accurate/.test(html), html.slice(0, 400));
check("1. answer: with the answer's consequence", html.includes(ANSWER_CONSEQUENCE));

// 1b. A Tastebreak-shaped answer (same origin, no fields) behaves the same way.
setup();
refresh();
recordRevision(state, { hypothesisId: pattern.id, claim: pattern.claim, origin: "user-confirmed", reason: "Arrival: confirmed as part of why it landed." });
html = panel();
check("1b. Tastebreak: no false category change", !html.includes(CATEGORY_CHANGE));
check("1b. Tastebreak: the answer is shown", html.includes("Arrival: confirmed as part of why it landed.") && html.includes(ANSWER_CONSEQUENCE));

// 2. A genuine category change from a refresh, no user answer: still reported.
setup();
refresh();
refresh({ domains: ["movies"] });
html = panel();
check("2. real category change: reported", html.includes(CATEGORY_CHANGE));
check("2. real category change: no answer consequence", !html.includes(ANSWER_CONSEQUENCE));

// 2b. A genuine new supporting example from a refresh: still reported.
setup();
refresh();
refresh({ supports: [...pattern.supports, "ev:c"] });
check("2b. real new support: reported", panel().includes(NEW_SUPPORT));

// 3a. The refresh after an answer, with nothing actually changed: no false change at all.
setup();
refresh();
setStatement(state, pattern.id, "says", "accurate");
refresh();
html = panel();
check("3a. refresh after answer, unchanged: no false new supporting example", !html.includes(NEW_SUPPORT));
check("3a. refresh after answer, unchanged: no false category change", !html.includes(CATEGORY_CHANGE));

// 3b. Both happen: an answer, then a refresh that really changes the categories. The latest event
// (the real category change) is what the panel reports; the answer stays on the pattern card.
setup();
refresh();
setStatement(state, pattern.id, "says", "accurate");
refresh({ domains: ["movies"] });
html = panel();
check("3b. answer then real category change: the category change is reported", html.includes(CATEGORY_CHANGE));
check("3b. answer then real category change: no stale answer line in the panel", !html.includes(ANSWER_CONSEQUENCE));
check("3b. the answer is still shown on the pattern card", renderProfile().includes("<span>Confirmed</span>"));

finish();
