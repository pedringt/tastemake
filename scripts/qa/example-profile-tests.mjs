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
const { esc } = await import("../../src/lib/html.js");
const { loadExampleProfile, exampleBannerHtml, isViewingExample, EXAMPLE_URL, EXAMPLE_SESSION_KEY, exampleRequestedAtBoot, exampleScreenFromPath, forgetViewingExample } = await import("../../src/example-profile.js");
const { refreshProfileHypotheses } = await import("../../src/ai/hypothesis-profile.js");
const { renderMine } = await import("../../src/screens/mine.js");
const { renderProfile } = await import("../../src/screens/profile.js");
const { featuredCorrection } = await import("../../src/model/featured-correction.js");

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
check("someone with a profile is offered Back to my profile", exampleBannerHtml().includes("Back to my profile") && !exampleBannerHtml().includes("Start my own"));
await loadExampleProfile({ fetchImpl });
check("...still, after opening the example again from inside it", exampleBannerHtml().includes("Back to my profile"));
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
// #320: a direct link or a refresh opens the page its address names; "/" and anything else land on the
// Taste Profile. Unknown paths never resolve to some other screen.
for (const [path, screen] of [
  ["/recommendations", "recommendations"], ["/browse", "browse"], ["/library", "library"], ["/taste-profile", "model"],
  ["/recommendations/", "recommendations"], ["/bookmarks", "library"], ["/try-next", "library"],
  ["/look", "look"], ["/my-tastemake", "mine"],
  ["/", "model"], ["", "model"], ["/setup", "model"], ["/favorites", "model"], ["/nope", "model"], ["/recommendations/extra", "model"]
]) eq(`example route ${path || "(empty)"} opens ${screen}`, exampleScreenFromPath(path), screen);
for (const screen of ["recommendations", "browse", "library", "model", "look", "mine"]) {
  await loadExampleProfile({ fetchImpl, screen });
  check(`refreshing on ${screen} stays on ${screen} in the example`, isViewingExample() && state.screen === screen);
  if (screen === "library") eq("Library opens on Saved, as at boot", state.libraryView, "saved");
}
await loadExampleProfile({ fetchImpl, screen: "setup" });
eq("a screen the example doesn't use falls back to the Taste Profile", state.screen, "model");
// Nov 3: opened directly on Look or My Tastemake, Done and Back return to the example's Taste Profile.
await loadExampleProfile({ fetchImpl, screen: "look" });
eq("a direct Look link returns to the Taste Profile", state.lookReturn, "model");
await loadExampleProfile({ fetchImpl, screen: "mine" });
eq("a direct My Tastemake link returns to the Taste Profile", state.mineReturn, "model");
eq("the visitor's saved profile is untouched by every route", stored.get(KEY), mine);
// #319: the example Overview features one real correction apart from the strongest six.
await loadExampleProfile({ fetchImpl });
const featured = featuredCorrection(state);
eq("the featured correction is the recorded partly-accurate answer", featured?.pattern.id, "ai-quirky-character-comedy");
eq("its before-state is the model revision the answer superseded", featured?.inferred?.id, featured?.answer.supersedes);
eq("no model change is recorded after the answer", featured?.later.length, 0);
state.profileView = "list";
const overview = renderProfile();
const panel = overview.match(/<section class="profile-featured-correction"[\s\S]*?<\/section>/)?.[0] ?? "";
check("the Overview shows the featured correction", panel.includes('data-featured-correction="ai-quirky-character-comedy"'));
check("it quotes the inferred claim from the saved history", panel.includes(esc(featured.inferred.claim)));
check("it shows Paige's actual answer", panel.includes("Partly accurate.") && panel.includes("No further detail was recorded with it."));
check("it says the example makes no AI calls and nothing was measured", panel.includes("no effect on recommendations has been measured"));
check("it never claims recommendations improved", !/improv|better|more accurate/i.test(panel));
check("it links to the full profile", panel.includes('data-profile-view="full"'));
// Nov 7: it says whose answers these are, and describes the shortlist and live AI separately, as shipped.
check("it introduces whose answer it is", panel.includes("You’re viewing Paige’s Example Profile, so this is her own answer"));
check("Partly matches the shipped wording", panel.includes("Tastemake builds its shortlist without using her answer") && panel.includes("treat this pattern more cautiously") && !/narrow/i.test(panel));
for (const says of ["partial", "not-me", "unsure"]) {
  const saved = state.patternStatements;
  state.patternStatements = saved.map((x) => (x.hypothesisId === "ai-quirky-character-comedy" ? { ...x, says } : x));
  const copy = renderProfile().match(/<section class="profile-featured-correction"[\s\S]*?<\/section>/)?.[0] ?? "";
  check(`${says}: the panel never says the ranking uses her answer`, copy.length > 0 && !/ranking/i.test(copy));
  if (says === "not-me") check("not me: no claim that picks using it are rejected", copy.includes("keeps it out of her Taste Profile") && !/reject/i.test(copy));
  state.patternStatements = saved;
}
const sixIds = [...overview.matchAll(/class="signal-row signal-row-\d+" data-profile-pattern="([^"]+)"/g)].map((m) => m[1]);
eq("the strongest six are unchanged", sixIds.join(","), state.modelHypotheses.slice(0, 6).map((p) => p.id).join(","));
check("the corrected pattern is not forced into the six", !sixIds.includes("ai-quirky-character-comedy"));
state.profileView = "full";
const full = renderProfile();
check("Full profile has no featured panel but still lists the pattern", !full.includes("profile-featured-correction") && full.includes('data-profile-pattern="ai-quirky-character-comedy"') && full.includes("<span>Partly</span>"));
state.profileView = "list";
// Missing before-state: say so rather than invent one.
const savedHistory = state.hypothesisHistory;
state.hypothesisHistory = savedHistory.filter((r) => !(r.hypothesisId === "ai-quirky-character-comedy" && r.origin === "model"));
check("with no saved before-state it says so", renderProfile().includes("before her answer wasn't saved"));
// No correction recorded at all: no panel, nothing else changes.
state.hypothesisHistory = savedHistory;
const savedStatements = state.patternStatements;
state.patternStatements = savedStatements.filter((s) => s.says === "accurate");
check("a confirmation alone is not featured as a correction", featuredCorrection(state) === null && !renderProfile().includes("profile-featured-correction"));
state.patternStatements = savedStatements;
// Not the example: a visitor's own profile never gets the sample panel.
state.viewingExample = false;
check("a visitor's own Overview never shows the panel", !renderProfile().includes("profile-featured-correction"));
state.viewingExample = true;
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
// Nov 12: a first-time visitor with nothing of their own is offered Start my own.
state.viewingExample = false;
resetState();
await loadExampleProfile({ fetchImpl });
check("a new visitor is offered Start my own", exampleBannerHtml().includes("Start my own"));

finish();
