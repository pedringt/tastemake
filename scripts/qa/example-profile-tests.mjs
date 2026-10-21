// Paige's Example Profile (Oct 21): loads into memory only, is never saved over a visitor's own profile,
// and never makes a model call. No network: the data file is read from disk and fetch is stubbed.
import { readFileSync } from "node:fs";
import { createSuite } from "./lib/assert.mjs";

const stored = new Map();
globalThis.localStorage = { getItem: (k) => stored.get(k) ?? null, setItem: (k, v) => stored.set(k, String(v)), removeItem: (k) => stored.delete(k) };
globalThis.document = { documentElement: { dataset: {} }, querySelector: () => null };

const { check, eq, finish } = createSuite("example profile tests");
const { state } = await import("../../src/state.js");
const { persistState } = await import("../../src/persistence.js");
const { parseBackupText } = await import("../../src/model/export.js");
const { loadExampleProfile, exampleBannerHtml, isViewingExample, EXAMPLE_URL } = await import("../../src/example-profile.js");
const { refreshProfileHypotheses } = await import("../../src/ai/hypothesis-profile.js");

const text = readFileSync(new URL("../../data/example-profile.json", import.meta.url), "utf8");
const parsed = parseBackupText(text);
check("the data file is a valid Tastemake backup", Boolean(parsed.feedbackByRecommendation));
check("it carries the inferred patterns", (parsed.modelHypotheses ?? []).length >= 6, String((parsed.modelHypotheses ?? []).length));
check("it carries Paige's two corrections", (parsed.patternStatements ?? []).length === 2);
check("every reaction is a real tried-or-saved outcome", Object.values(parsed.feedbackByRecommendation).every((f) => ["loved-before", "liked-before", "tried-disliked", "bookmarked"].includes(f.detail)));

// A visitor's own saved profile.
const KEY = "tastemake:test-state:v1";
const mine = JSON.stringify({ version: 1, state: { displayName: "Visitor" } });
stored.set(KEY, mine);
check("no banner before the example loads", exampleBannerHtml() === "");

const requested = [];
await loadExampleProfile({ fetchImpl: async (url) => { requested.push(url); return { ok: true, text: async () => text }; } });
eq("it is fetched from the static data file", requested[0], EXAMPLE_URL);
check("the state is flagged as the example", isViewingExample());
eq("it opens on the Taste Profile", state.screen, "model");
check("the banner shows while viewing", exampleBannerHtml().includes("Paige's Example Profile") && exampleBannerHtml().includes('data-action="exit-example"'));

persistState(state);
eq("viewing the example never overwrites the visitor's saved profile", stored.get(KEY), mine);

const realFetch = globalThis.fetch;
let modelCalls = 0;
globalThis.fetch = async () => { modelCalls += 1; throw new Error("must not call"); };
await refreshProfileHypotheses(state, { force: true });
globalThis.fetch = realFetch;
eq("a Taste Profile refresh makes no model call while viewing", modelCalls, 0);

state.viewingExample = false;
persistState(state);
check("outside the example, saving works as before", stored.get(KEY) !== mine);
finish();
