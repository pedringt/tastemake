// T1/T2 trust fixes (Nov 3, 2026): what the app may claim about AI and about corrections.
//   - A set of catalog picks is never presented as Live AI, including after a reload.
//   - The header badge stays neutral until an answer this session establishes the AI state.
//   - The Taste Profile copy promises only what the software does.
import { readFileSync } from "node:fs";
import { createSuite } from "./lib/assert.mjs";
import { badgeFor, noteAiAnswer, setSource, syncAiBadge, CATALOG_SET_LINE } from "../../src/ai/ai-status.js";

const { check, eq, finish } = createSuite("ai status tests");

const catalogPick = (i) => ({ id: `c${i}`, title: `Catalog ${i}`, ai: null });
const modelPick = (i) => ({ id: `m${i}`, title: `Model ${i}`, ai: { cites: ["ev:x"], tests: null, kind: "pick", contract: "2026-09-22" } });
const catalogSet = [1, 2, 3, 4, 5, 6].map(catalogPick);
const modelSet = [1, 2, 3, 4, 5, 6].map(modelPick);
// What state.js gives a page load: the saved sets come back, the session-only AI flags do not.
const reloaded = (sets) => ({ recommendationSets: sets, aiPaused: false, aiLive: false });

// --- setSource: read from the saved set itself ---
eq("a set saved with ai:null on every pick is a catalog set", setSource(catalogSet), "catalog");
eq("a set with the AI's answer on every pick is a model set", setSource(modelSet), "model");
eq("an empty set has no known source", setSource([]), null);
eq("a missing set has no known source", setSource(undefined), null);
eq("a mixed set is not claimed either way", setSource([catalogPick(1), modelPick(2)]), null);
eq("a pick saved before the ai field existed counts as catalog, never as AI", setSource([{ id: "old" }]), "catalog");

// --- badge after a reload ---
eq("reload with a catalog set: badge is neutral", badgeFor(reloaded([modelSet, catalogSet])).text, "AI picks");
eq("reload with a model set: badge is neutral until this session hears from the AI", badgeFor(reloaded([catalogSet, modelSet])).text, "AI picks");
eq("reload with no sets: badge is neutral", badgeFor(reloaded([])).text, "AI picks");
check("the neutral badge never says Live AI", !/live ai/i.test(`${badgeFor(reloaded([])).text} ${badgeFor(reloaded([])).title}`));

// --- badge during a session ---
{
  const state = reloaded([modelSet]);
  noteAiAnswer(state, { usedModel: true });
  eq("a model answer this session: badge says Live AI", badgeFor(state).text, "Live AI");
  state.recommendationSets.push(catalogSet);
  noteAiAnswer(state, { usedModel: false });
  eq("a later catalog set (failed validation, AI off): badge drops Live AI", badgeFor(state).text, "AI picks");
  noteAiAnswer(state, { budgetPaused: true });
  eq("a paused answer: badge says AI paused", badgeFor(state).text, "AI paused");
  eq("a paused answer clears the earlier Live AI", state.aiLive, false);
  state.recommendationSets.push(modelSet);
  noteAiAnswer(state, { usedModel: true });
  eq("a model answer after a pause: Live AI again", badgeFor(state).text, "Live AI");
  eq("a model answer clears the pause", state.aiPaused, false);
}
{
  // The Taste Profile's own model answer must not relabel catalog picks on screen as Live AI.
  const state = reloaded([catalogSet]);
  noteAiAnswer(state, { usedModel: true });
  eq("a Profile model answer while catalog picks are shown: badge stays neutral", badgeFor(state).text, "AI picks");
}

// --- syncAiBadge writes what badgeFor decides ---
{
  const badge = { textContent: "Live AI", title: "", classList: { on: false, toggle(_, on) { this.on = on; } } };
  const root = { querySelector: (sel) => (sel === ".prototype-label" ? badge : null) };
  syncAiBadge(reloaded([catalogSet]), root);
  eq("syncAiBadge replaces a stale Live AI over catalog picks", badge.textContent, "AI picks");
  eq("neutral badge is not styled as paused", badge.classList.on, false);
  syncAiBadge({ recommendationSets: [catalogSet], aiPaused: true, aiLive: false }, root);
  eq("syncAiBadge shows AI paused", badge.textContent, "AI paused");
  eq("paused badge is styled as paused", badge.classList.on, true);
}

// --- the reload label and the first paint ---
check("the catalog line names the source and gives no reason", CATALOG_SET_LINE === "These picks came from the catalog, not AI." && !/pause|budget|fail|valid/i.test(CATALOG_SET_LINE));
const indexHtml = readFileSync(new URL("../../index.html", import.meta.url), "utf8");
const firstPaint = indexHtml.match(/<span class="prototype-label"[^>]*>([^<]*)<\/span>/);
eq("the badge's first paint (before any script runs) is neutral", firstPaint?.[1], "AI picks");
check("the badge's first-paint tooltip makes no Live AI claim", firstPaint && !/live ai is gated/i.test(firstPaint[0]));

// --- the flags stay session-only ---
const persistence = readFileSync(new URL("../../src/persistence.js", import.meta.url), "utf8");
check("aiLive is never saved with the user's data", !/["']aiLive["']/.test(persistence));
check("aiPaused is never saved with the user's data", !/["']aiPaused["']/.test(persistence));

// --- T1: Taste Profile copy promises only what the software does ---
const profile = readFileSync(new URL("../../src/screens/profile.js", import.meta.url), "utf8");
for (const stale of [
  "Future recommendations will leave this pattern out.",
  "will count more when Tastemake ranks future picks",
  "will count less when Tastemake ranks future picks",
  "It will not use it for",
  "Tastemake leaves it out of what it picks for you.",
  "changed how Tastemake will choose future picks"
]) check(`profile copy no longer promises: "${stale}"`, !profile.includes(stale));
for (const approved of [
  "Tastemake won’t use this pattern in your Taste Profile, and asks its AI not to lean on it when explaining picks.",
  "Tastemake will tell its AI this pattern matters more to you.",
  "Tastemake will tell its AI this pattern matters less to you.",
  "Your Taste Profile won’t apply it to",
  "Tastemake leaves it out of your Taste Profile. Picks can still resemble the titles behind it, because your ratings still count.",
  "changed your Taste Profile, which Tastemake’s AI uses when it explains future picks."
]) check(`profile copy says: "${approved.slice(0, 60)}…"`, profile.includes(approved));

finish();
