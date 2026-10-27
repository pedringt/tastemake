// Paige's Example Profile (Oct 21): loads into memory only, is never saved over a visitor's own profile,
// and never makes a model call. No network: the data file is read from disk and fetch is stubbed.
// Oct 27: reachable after setup (My Tastemake, empty Taste Profile) and kept across a refresh by a
// sessionStorage flag. The visitor's saved profile stays byte-identical through open, refresh and exit.
import { readFileSync } from "node:fs";
import { createSuite } from "./lib/assert.mjs";

const stored = new Map();
const removed = [];
globalThis.localStorage = { getItem: (k) => stored.get(k) ?? null, setItem: (k, v) => stored.set(k, String(v)), removeItem: (k) => { removed.push(k); stored.delete(k); } };
const session = new Map();
const sessionStub = { getItem: (k) => session.get(k) ?? null, setItem: (k, v) => session.set(k, String(v)), removeItem: (k) => session.delete(k) };
globalThis.sessionStorage = sessionStub;
globalThis.document = { documentElement: { dataset: {} }, querySelector: () => null };

const { check, eq, finish } = createSuite("example profile tests");
const { state, resetState } = await import("../../src/state.js");
const { persistState } = await import("../../src/persistence.js");
const { parseBackupText } = await import("../../src/model/export.js");
const { loadExampleProfile, exampleBannerHtml, isViewingExample, EXAMPLE_URL, EXAMPLE_SESSION_KEY, exampleRequestedAtBoot, forgetViewingExample } = await import("../../src/example-profile.js");
const { refreshProfileHypotheses } = await import("../../src/ai/hypothesis-profile.js");
const { renderMine } = await import("../../src/screens/mine.js");
const { renderProfile } = await import("../../src/screens/profile.js");

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

// Oct 27: entry points after setup. A finished setup with no patterns yet shows the empty Taste Profile.
state.displayName = "Visitor";
state.setupComplete = true;
state.onboarded = true;
const LINK = 'data-action="view-example"';
check("My Tastemake links to the example after setup", renderMine().includes(LINK) && renderMine().includes("See Paige's Example Profile →"));
const emptyProfile = renderProfile();
check("the empty Taste Profile links to the example", emptyProfile.includes("profile-empty") && emptyProfile.includes(LINK) && emptyProfile.includes("Want to see one with lots of data?"));
check("no flag before the example is opened", !exampleRequestedAtBoot(""));
check("?example=paige still opens it at boot", exampleRequestedAtBoot("?example=paige"));

const requested = [];
const fetchImpl = async (url) => { requested.push(url); return { ok: true, text: async () => text }; };
await loadExampleProfile({ fetchImpl });
eq("it is fetched from the static data file", requested[0], EXAMPLE_URL);
check("the state is flagged as the example", isViewingExample());
eq("it opens on the Taste Profile", state.screen, "model");
check("the banner shows while viewing", exampleBannerHtml().includes("Paige's Example Profile") && exampleBannerHtml().includes('data-action="exit-example"'));
eq("opening it sets the session flag", session.get(EXAMPLE_SESSION_KEY), "paige");
check("the link hides while viewing the example", !renderMine().includes(LINK));

persistState(state);
eq("viewing the example never overwrites the visitor's saved profile", stored.get(KEY), mine);

const realFetch = globalThis.fetch;
let modelCalls = 0;
globalThis.fetch = async () => { modelCalls += 1; throw new Error("must not call"); };
await refreshProfileHypotheses(state, { force: true });
globalThis.fetch = realFetch;
eq("a Taste Profile refresh makes no model call while viewing", modelCalls, 0);

// A refresh: boot sees the flag (the query string is long gone) and loads the example again.
check("boot with the flag set asks for the example", exampleRequestedAtBoot(""));
await loadExampleProfile({ fetchImpl });
check("after the refresh it is still the example", isViewingExample() && state.screen === "model");
persistState(state);
// "Start over" inside the example clears the example, not the visitor's saved profile.
resetState();
persistState(state);
check("Start over while viewing never removes the visitor's saved profile", !removed.includes(KEY));

// Exit ("Start my own"): app.js drops the flag before navigating to /.
forgetViewingExample();
check("exit clears the session flag", !session.has(EXAMPLE_SESSION_KEY) && !exampleRequestedAtBoot(""));
eq("the visitor's saved profile is byte-identical after open, refresh and exit", stored.get(KEY), mine);

// Storage that throws (private mode, blocked site data) never breaks opening, booting or exiting.
const throwing = () => { throw new Error("SecurityError"); };
globalThis.sessionStorage = { getItem: throwing, setItem: throwing, removeItem: throwing };
let threw = false;
try {
  await loadExampleProfile({ fetchImpl });
  check("a throwing sessionStorage: boot check is just false", exampleRequestedAtBoot("") === false);
  check("a throwing sessionStorage: ?example=paige still works", exampleRequestedAtBoot("?example=paige"));
  forgetViewingExample();
} catch { threw = true; }
check("a throwing sessionStorage breaks nothing", !threw && isViewingExample());
Object.defineProperty(globalThis, "sessionStorage", { configurable: true, get: throwing });
threw = false;
try { await loadExampleProfile({ fetchImpl }); exampleRequestedAtBoot(""); forgetViewingExample(); } catch { threw = true; }
check("even reading sessionStorage throwing breaks nothing", !threw);
Object.defineProperty(globalThis, "sessionStorage", { configurable: true, writable: true, value: sessionStub });

state.viewingExample = false;
persistState(state);
check("outside the example, saving works as before", stored.get(KEY) !== mine);
finish();
