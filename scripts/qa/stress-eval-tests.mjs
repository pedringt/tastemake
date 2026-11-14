// #28 stress eval harness (scripts/evals/stress/): metrics, committed profiles, and the run pipeline with
// a FAKE model. No network and no model call: every fetch here is a local function, and the harness's
// own fetch wrapper refuses any host but api.anthropic.com, which this suite never reaches.
import { createSuite } from "./lib/assert.mjs";
import {
  maskTitles, maskedTokens, distinctN, longNgramShare, topPhrases, repeatedOpeningShare, themeConcentration,
  patternConcentration, traceability, genreKeys, genericPhrasing, genreCollapse, crossDomain, recencyAndDislikes, metricsFor,
  setRepetition, perSetSummary, SET_GATE, MIN_EXPLANATIONS_PER_VARIANT, bridgeMetrics
} from "../evals/stress/metrics.mjs";
import { SIZES, SHAPES, ALL_SHAPES, BRIDGE_SHAPES, buildAllProfileSpecs, candidateItems, loadProfileSpecs, loadSnapshot, profileState, itemsIndex } from "../evals/stress/profiles.mjs";
import { makeFetch, planTasks, runTask, validateOptions, parseArgs, costTable } from "../evals/stress/run-stress.mjs";
import { buildReport, reviewSample, reviewMarkdown, pickRecords } from "../evals/stress/report.mjs";
import { evidenceRecords } from "../../src/model/evidence.js";
import { percentile, suggestGate, draftReference } from "../evals/stress/calibrate.mjs";

const { check, eq, finish } = createSuite("stress-eval");

// ---- metrics on hand-made explanations -----------------------------------------------------------
const ev = (title, extra = {}) => ({ ref: `ev:${title}`, title, kind: "experienced-strong-positive", polarity: 1, domains: ["movies"], genres: ["878"], recency: 0.5, inPrompt: true, ...extra });
const pick = (title, why, extra = {}) => ({ title, why, domains: ["movies"], genres: ["878", "53"], cites: (extra.citedEvidence ?? [ev("Alien")]).map((e) => e.ref), citedEvidence: [ev("Alien")], profileFacts: { triedDomains: ["movies"] }, ...extra });

eq("titles are masked, longest first", maskTitles("Because you loved Star Wars: Andor, try Andor.", ["Andor", "Star Wars: Andor"]), "Because you loved  <title> , try  <title> .");
const templated = [
  pick("Dune", "Because you loved Alien, its slow dread and isolation should carry over here."),
  pick("Arrival", "Because you loved Alien, its slow dread and isolation should carry over here."),
  pick("Moon", "A lonely astronaut story with the quiet grief you rated highly in Solaris.", { citedEvidence: [ev("Solaris")] })
];
eq("masked tokens put a placeholder where a cited title was", maskedTokens(templated[0]).slice(0, 4).join(" "), "because you loved <title>");
check("distinct-3 drops when two explanations are the same template", distinctN(templated, 3) < 0.7, String(distinctN(templated, 3)));
eq("distinct-2 is 1 for one sentence with no repeats", distinctN([templated[2]], 2), 1);
eq("shared 5-gram share counts the two templated explanations", longNgramShare(templated, 5), 0.667);
eq("shared 4-gram share is 0 for unrelated sentences", longNgramShare([templated[0], templated[2]], 4), 0);
check("top phrases list the repeated template", topPhrases(templated).some((p) => p.phrase.includes("slow dread and isolation") && p.count === 2), JSON.stringify(topPhrases(templated)));
eq("top phrases never list a phrase found once", topPhrases([templated[2]]).length, 0);
eq("repeated opening counts both 'Because you loved' explanations", repeatedOpeningShare(templated), 0.667);
const themes = themeConcentration(templated);
eq("theme top-3 share: every explanation uses a top term", themes.top3Share, 0.667);
check("theme terms include content-word pairs", themes.top.some((t) => t.term.includes(" ")), JSON.stringify(themes.top));
check("theme terms leave out reaction verbs", !themes.top.some((t) => /\bloved\b/.test(t.term)), JSON.stringify(themes.top));

const patternPicks = [
  { ...pick("A", "x"), cites: ["ev:1"], profile: "p", profileKey: "m|p" },
  { ...pick("B", "x"), cites: ["ev:1", "ev:2"], profile: "p", profileKey: "m|p" },
  { ...pick("C", "x"), cites: ["ev:9"], profile: "p", profileKey: "m|p" }
];
const pc = patternConcentration(patternPicks, { "m|p": [{ label: "Dread", evidence: ["ev:1"] }, { label: "Wit", evidence: ["ev:2"] }, { label: "Unused", evidence: ["ev:5"] }] });
eq("pattern top-3 share counts picks citing a top pattern's evidence", pc.top3Share, 0.667);
eq("pattern 'no pattern' share counts picks citing no pattern", pc.noPatternShare, 0.333);
eq("patterns used vs available", `${pc.patternsUsed}/${pc.patternsAvailable}`, "2/3");
eq("no profile step -> no pattern metric", patternConcentration(patternPicks, {}), null);

check("TMDb ids and Open Library subjects map to the same genre key", genreKeys(["878"]).has("sci-fi") && genreKeys(["Fiction, science fiction, general"]).has("sci-fi"));
check("IGDB RPG maps to rpg", genreKeys(["Role-playing (RPG)"]).has("rpg"));
const book = ev("Dune (novel)", { domains: ["read"], genres: ["Science fiction"] });
const tr = traceability([
  pick("Interstellar", "Shares the hard-science awe of Dune (novel).", { citedEvidence: [book], cites: [book.ref] }),
  pick("Paddington", "Gentle family warmth.", { genres: ["10751", "35"], citedEvidence: [ev("Heat", { domains: ["tv"], genres: ["80"] })], cites: ["ev:Heat"] })
]);
eq("genre match across domains via genre keys", tr.genreMatch, 0.5);
eq("relevant = domain or genre match", tr.relevant, 0.5);
eq("names evidence when the explanation includes a cited title", tr.namesEvidence, 0.5);
const notInPrompt = traceability([pick("X", "y", { citedEvidence: [ev("Q", { inPrompt: false })] })]);
eq("cites-in-prompt catches a ref the prompt never showed", notInPrompt.citesInPrompt, 0);

const gen = genericPhrasing([pick("X", "You'll love this one."), pick("Y", "It matches your taste."), pick("Z", "The same cold, procedural tension as Alien.")]);
eq("generic phrasing share", gen.share, 0.667);
check("generic templates are reported by name", gen.byTemplate["you'll love/like/enjoy"] === 1, JSON.stringify(gen.byTemplate));
const gc = genreCollapse([pick("X", "A dark fantasy RPG adventure game."), pick("Y", "Its grief-stricken narrator and unreliable memory echo what you loved in Alien.")]);
eq("genre collapse flags the genre-label sentence only", gc.collapsedShare, 0.5);

const cross = crossDomain([
  pick("Film", "x", { citedEvidence: [book], profileFacts: { triedDomains: ["movies"] } }),
  pick("Film2", "x", { citedEvidence: [book], profileFacts: { triedDomains: ["movies", "read"] } }),
  pick("Film3", "x", { citedEvidence: [ev("Alien")], profileFacts: { triedDomains: ["movies"] } })
]);
eq("cross-domain share", cross.crossShare, 0.667);
eq("cross-domain unsupported when the cited domain has no tried evidence", cross.unsupportedShareOfCross, 0.5);
eq("cites-only-another-domain share", cross.onlyOtherDomainShare, 0.667);
const rec = recencyAndDislikes([pick("A", "a b", { citedEvidence: [ev("N", { recency: 0.9 }), ev("O", { recency: 0.1, polarity: -1 })] })]);
eq("recent share of reaction cites", rec.recentShareOfReactionCites, 0.5);
eq("cites-a-dislike share", rec.citesDislikeShare, 1);
eq("metricsFor on no picks does not throw", metricsFor([]).picks, 0);

// ---- committed profiles --------------------------------------------------------------------------
const snapshot = loadSnapshot();
const committed = loadProfileSpecs();
eq("profiles.json rebuilds exactly from the snapshot and seeds", JSON.stringify(buildAllProfileSpecs(snapshot)), JSON.stringify(committed));
eq("one profile per shape and size", committed.length, ALL_SHAPES.length * Object.keys(SIZES).length);
eq("--profiles all still means the original four shapes", parseArgs(["--profiles", "all"]).shapes.join(","), SHAPES.join(","));
eq("the bridge shapes can be asked for by name", validateOptions(parseArgs(["--profiles", BRIDGE_SHAPES.join(",")])).length, 0);
const index = itemsIndex(snapshot);
for (const spec of committed) {
  const state = profileState(spec, { itemsById: index });
  const experienced = evidenceRecords(state).filter((r) => r.class === "experienced").length;
  eq(`${spec.id}: experienced items = size`, experienced, SIZES[spec.size]);
  check(`${spec.id}: has intent that is not taste`, evidenceRecords(state).some((r) => r.class === "intent"));
  const known = new Set([...spec.favorites, ...spec.reactions.map((r) => r.id), ...spec.intent.map((r) => r.id)]);
  check(`${spec.id}: 36 unseen candidates`, spec.candidates.length === 36 && spec.candidates.every((id) => !known.has(id)));
}
const narrow = committed.find((p) => p.id === "narrow-100");
check("narrow: every experienced item is a film", [...narrow.favorites, ...narrow.reactions.map((r) => r.id)].every((id) => index.get(id).domains[0] === "movies"));
check("narrow: some candidates are outside films (cross-domain bait)", narrow.candidates.some((id) => index.get(id).domains[0] !== "movies"));
const split = committed.find((p) => p.id === "split-50");
const splitCounts = split.reactions.reduce((m, r) => ({ ...m, [r.how]: (m[r.how] ?? 0) + 1 }), {});
check("split: about as many dislikes as loves", Math.abs((splitCounts.loved ?? 0) - (splitCounts.disliked ?? 0)) <= 4, JSON.stringify(splitCounts));
// #252 part 2: movie/TV-heavy profiles whose pools hold marked bridge books.
for (const spec of committed.filter((p) => BRIDGE_SHAPES.includes(p.shape))) {
  const tried = [...spec.favorites, ...spec.reactions.map((r) => r.id)].map((id) => index.get(id));
  const books = tried.filter((item) => item.domains[0] === "read").length;
  check(`${spec.id}: movies and TV heavy, with ${spec.shape === "screen" ? "no" : "two"} books`, books === (spec.shape === "screen" ? 0 : 2) && tried.filter((i) => ["movies", "tv"].includes(i.domains[0])).length === tried.length - books, String(books));
  const pool = candidateItems(spec, { itemsById: index });
  const marked = pool.filter((item) => item.bridge);
  eq(`${spec.id}: six marked bridge books in the pool`, marked.length, 6);
  check(`${spec.id}: each found from the first favorite, a film or show`, marked.every((item) => item.type === "book" && item.relatedToId === spec.favorites[0] && item.bridge.fromId === spec.favorites[0] && ["movies", "tv"].includes(item.bridge.fromDomain) && item.relatedTo === index.get(spec.favorites[0]).title));
  check(`${spec.id}: one in every 6-item window, so every round can offer one`, [0, 1, 2, 3, 4, 5].every((w) => spec.candidates.slice(w * 6, w * 6 + 6).some((id) => marked.some((m) => m.id === id))));
}
const round2 = profileState(committed[0], { round: 2, itemsById: index });
eq("round 2 has two earlier windows shown", round2.recommendationSets.length, 2);
eq("round 6 cycles back to the first window", profileState(committed[0], { round: 6, itemsById: index }).recommendationSets.length, 0);

// ---- run pipeline, with a fake model ----------------------------------------------------------------
eq("options: bad model id refused", validateOptions(parseArgs(["--models", "gpt-4"])).length, 1);
eq("options: unknown size refused", validateOptions(parseArgs(["--sizes", "500"])).length, 1);
const opts = parseArgs(["--models", "claude-haiku-5-5,claude-sonnet-5-5", "--sizes", "10,100", "--profiles", "narrow,split", "--repeats", "3", "--with-profile"]);
eq("plan: models x sizes x profiles x (repeats + profile)", planTasks(opts).length, 2 * 2 * 2 * (3 + 1));

let realCalls = 0;
const neverCalled = async () => { realCalls += 1; throw new Error("network must not be used"); };
let refused = null;
try { await makeFetch({ dryRun: true, budget: { used: 0, max: 5 }, realFetch: neverCalled })("https://api.themoviedb.org/3/x", { body: "{}" }); } catch (e) { refused = e.message; }
check("the harness fetch refuses any host but Anthropic", /refuses a request to api.themoviedb.org/.test(refused ?? ""), refused);

const dryOpts = { ...parseArgs(["--models", "claude-haiku-5-5"]), dryRun: true };
const dryFetch = makeFetch({ dryRun: true, budget: { used: 0, max: 0 }, realFetch: neverCalled });
const tasks = planTasks({ ...dryOpts, sizes: ["10", "100"], shapes: ["narrow"], repeats: 1, withProfile: true });
const dryRecords = [];
for (const t of tasks) dryRecords.push(await runTask(t, dryOpts, { fetchImpl: dryFetch, snapshotIndex: index }));
eq("dry run makes no real fetch", realCalls, 0);
check("dry run measures the real production prompt", dryRecords.every((r) => r.request?.estInputTokens > 500), JSON.stringify(dryRecords.map((r) => r.request)));
eq("dry run uses production's picks output cap", dryRecords.find((r) => r.kind === "picks").request.maxTokens, 1000);
eq("dry run: Haiku 5.5 gets thinking disabled", dryRecords.find((r) => r.kind === "picks").request.thinking, "disabled");
eq("100+ profile: wire keeps 96 reactions + 6 favorites", dryRecords.find((r) => r.size === "100" && r.kind === "picks").profileFacts.experiencedOnWire, 102);
eq("pick prompt shows at most 18 evidence rows", dryRecords.find((r) => r.size === "100" && r.kind === "picks").promptEvidence.count, 18);
const table = costTable(dryRecords);
check("cost table has a floor and ceiling per model x size x kind", table.length === 4 && table.every((r) => r.ceilingUsd > r.floorUsd && r.floorUsd > 0), JSON.stringify(table));

// Fake Anthropic: reads the CONTEXT production sent and answers like a model would, including one bad pick.
let fakeCalls = 0;
const fakeAnthropic = async (url, init) => {
  fakeCalls += 1;
  const body = JSON.parse(init.body);
  const content = body.messages[0].content;
  const context = JSON.parse(content.slice(content.indexOf("{")));
  const positive = context.evidence.find((e) => e.polarity > 0);
  const picks = context.candidates.slice(0, 5).map((c, i) => ({ itemId: c.id, why: i === 4 ? "It matches your taste." : `Because you loved ${positive.title}, the slow dread here should land.`, cites: [positive.ref] }));
  const text = JSON.stringify({ picks, curveballItemId: null });
  return new Response(JSON.stringify({ model: body.model, content: [{ type: "text", text }], usage: { input_tokens: 2000, output_tokens: 300 } }), { status: 200 });
};
const liveOpts = { ...parseArgs(["--models", "claude-haiku-5-5"]), apiKey: "test-key-not-real" };
const budget = { used: 0, max: 3 };
const liveFetch = makeFetch({ dryRun: false, budget, realFetch: fakeAnthropic });
const liveTasks = planTasks({ ...liveOpts, sizes: ["10", "50"], shapes: ["narrow", "split"], repeats: 1, withProfile: false });
const liveRecords = [];
for (const t of liveTasks) liveRecords.push(await runTask(t, liveOpts, { fetchImpl: liveFetch, snapshotIndex: index }));
eq("budget stops paid calls at --max-calls", fakeCalls, 3);
check("a call over budget falls back without calling", liveRecords[3].source !== "model" && liveRecords[3].picks.length === 0, JSON.stringify(liveRecords[3].reason));
const first = liveRecords[0];
eq("model picks went through production validation (4 kept)", first.picks.length, 4);
check("the circular pick is recorded as rejected with the validator's reason", first.rejected.some((r) => r.reasons.includes("circular reasoning")), JSON.stringify(first.rejected));
eq("recomputed validation agrees with production", first.consistency.recomputedKept, first.consistency.productionKept);
check("each kept pick records cited evidence with its reaction", first.picks.every((p) => p.citedEvidence.length === 1 && p.citedEvidence[0].polarity > 0 && p.citedEvidence[0].title));
check("cost is recorded from usage", first.costUsd > 0);

const { markdown, metrics } = buildReport({ calls: liveRecords, headers: [] });
check("report has a quality-vs-size table", markdown.includes("## Quality vs size: claude-haiku-5-5"));
check("report lists what needs human review", markdown.includes("## Needs human review"));
check("report flags the template the fake model repeated", metrics["claude-haiku-5-5"].bySize["10"].wording.sharedLong4 === 1);
eq("pick records flatten every kept pick", pickRecords(liveRecords).length, liveRecords.reduce((a, r) => a + r.picks.length, 0));
const sample = reviewSample(liveRecords, { perProfile: 2 });
check("review sample has picks per profile", sample.length === 3 && sample.every((g) => g.picks.length <= 2), JSON.stringify(sample.map((g) => g.profile)));
check("review markdown renders", reviewMarkdown(sample).includes("cites:"));
check("report has the per-set repetition table", markdown.includes("## Per-set repetition") && markdown.includes("| Model | Size | Sets |"));
check("pick records carry their call, so picks group into sets", pickRecords(liveRecords).every((p) => p.callKey));
check("a small run is marked indicative", markdown.includes("(indicative)"));
check("no bridge section without bridge candidates", !markdown.includes("## Cross-media bridge"));

// #252 part 2: bridge metrics over pick calls.
{
  const call = (over) => ({ type: "call", kind: "picks", model: "m", size: "10", shape: "screen", source: "model", ms: 1000, offered: [{ id: "b1", bridge: true }, { id: "x" }], picks: [], rejected: [], ...over });
  const calls = [
    call({ key: "1", picks: [{ itemId: "b1", bridge: true, bridgeFrom: "Arrival", kind: "curveball", why: "A book test: the quiet dread of Arrival, on the page." }] }),
    call({ key: "2", ms: 3000, picks: [{ itemId: "x", why: "Something else." }], rejected: [{ itemId: "b1", bridge: true, reasons: ["cross-medium test is not labeled as a test"] }] }),
    call({ key: "3", source: "catalog", fallbackPicks: [{ itemId: "b1", bridge: true }] }),
    call({ key: "4", offered: [{ id: "x" }] })
  ];
  const b = bridgeMetrics(calls);
  eq("bridge offered share", b.bridgeOfferedShare, 0.75);
  eq("bridge pick rate is per call offering one", b.bridgePickRate, 0.333);
  eq("why names the source", b.bridgeWhyNamesSource, 1);
  eq("why says it's a test", b.bridgeWhySaysTest, 1);
  eq("bridge rejections are counted with their reasons", `${b.bridgeRejected}:${b.bridgeRejectionReasons["cross-medium test is not labeled as a test"]}`, "1:1");
  eq("fallback share and fallbacks that used the bridge", `${b.fallbackShare}:${b.fallbackUsingBridge}`, "0.25:1");
  eq("latency median", b.msMedian, 1000);
  const report = buildReport({ calls, headers: [] }).markdown;
  check("the report adds a bridge table when a bridge was offered", report.includes("## Cross-media bridge") && report.includes("| m | 10 | 4 |"), report.slice(report.indexOf("## Cross-media"), report.indexOf("## Cross-media") + 600));
}

// Dry run on a bridge profile records which offered candidate was the bridge.
{
  const bridgeTasks = planTasks({ ...dryOpts, sizes: ["10"], shapes: ["screen"], repeats: 1, withProfile: false });
  const rec = await runTask(bridgeTasks[0], dryOpts, { fetchImpl: dryFetch, snapshotIndex: index });
  check("a bridge profile dry-runs through production", rec.source !== "error" && rec.request?.estInputTokens > 500, JSON.stringify(rec.reason));
  check("and the record marks bridge candidates in what was offered", (rec.offered ?? []).some((o) => o.bridge), JSON.stringify(rec.offered));
}

// ---- #28 Stage 0: per-set repetition, on explanations seen in the Oct 20 paid eval ----------------
const set = (whys) => whys.map(([title, why, cited]) => pick(title, why, { citedEvidence: [ev(cited)] }));
const frameSet = set([
  ["Piranesi", "Its hushed, dreamlike wandering through an enormous house suits the immersive worldbuilding you loved in Circe.", "Circe"],
  ["The Lighthouse", "Its isolated, surreal descent into madness echoes the slow unraveling you responded to in The Fall.", "The Fall"],
  ["Control", "A bureaucratic building full of unexplained phenomena offers the eerie weirdness you enjoyed in Alan Wake 2.", "Alan Wake 2"],
  ["Golden Idol", "Reconstructing frozen crime scenes rewards the same puzzle-solving curiosity Portal 2 fed.", "Portal 2"]
]);
const framed = setRepetition(frameSet);
eq("the 'you … in <title>' frame is counted per explanation, titles masked", framed.frame, 3);
check("three framed explanations in one set would trigger", framed.wouldTrigger && framed.triggers.some((t) => t.includes("frame")), JSON.stringify(framed.triggers));

const familySet = set([
  ["The Menu", "Its sharp satirical bite and escalating dread echo the unsettling tension of The Fall.", "The Fall"],
  ["Piranesi", "A hushed, labyrinthine dreamscape that mirrors the quiet wonder of Middle-earth.", "LOTR"],
  ["Outer Wilds", "Curiosity-driven discovery with no guiding hand, built like Portal 2's puzzle logic.", "Portal 2"]
]);
const family = setRepetition(familySet);
eq("a swapped synonym still counts as the same stock family (echo, mirrors)", family.stock["callback verb"], 2);
check("one family in two explanations is not enough (calibrated: Paige's kept sets had up to 2)", !family.wouldTrigger, JSON.stringify(family.triggers));
const family3 = setRepetition([...familySet, ...set([["Control", "Its corridors recall the dread of Alan Wake 2.", "Alan Wake 2"]])]);
check("one family in three explanations would trigger", family3.wouldTrigger && family3.triggers.some((t) => t.startsWith("callback verb")), JSON.stringify(family3.triggers));

const clean = setRepetition(set([
  ["Fargo", "Moral messiness and eccentric small-town characters, like the crime drama in The Fall.", "The Fall"],
  ["Control", "A building full of unexplained phenomena, for the atmosphere Alan Wake 2 built.", "Alan Wake 2"],
  ["The Spear Cuts Through Water", "A layered, mythic quest across a violent land, at Lord of the Rings scale.", "LOTR"]
]));
check("a varied set does not trigger", !clean.wouldTrigger && clean.frame === 0 && clean.opening < SET_GATE.openingWhys, JSON.stringify(clean));

const openings = setRepetition(set([
  ["A", "Its layered deceptions reward close attention like The Fall.", "The Fall"],
  ["B", "Its layered magic system builds on what Mistborn set up.", "Mistborn"],
  ["C", "Its layered city politics recall Locke Lamora's schemes.", "Locke Lamora"]
]));
eq("the same two-word opening is counted per set", openings.opening, 3);
check("three shared openings would trigger", openings.triggers.some((t) => t.startsWith("same opening")), JSON.stringify(openings.triggers));
const phraseSet = setRepetition(set([
  ["A", "A hushed story with the quiet wonder of Piranesi.", "Piranesi"],
  ["B", "Slow, strange and full of the quiet wonder Circe had.", "Circe"],
  ["C", "Its coastal town holds the quiet wonder of Middle-earth.", "LOTR"]
]));
check("a 3-word phrase in three explanations would trigger, and is named", phraseSet.sharedPhrase === 3 && phraseSet.triggers.some((t) => t.includes("the quiet wonder")), JSON.stringify(phraseSet.triggers));

const twoOpenings = setRepetition(set([
  ["A", "Its layered deceptions reward close attention like The Fall.", "The Fall"],
  ["B", "Its layered magic system builds on what Mistborn set up.", "Mistborn"],
  ["C", "A quiet coastal mystery with the patience of Piranesi.", "Piranesi"]
]));
check("two shared openings trigger (calibrated: Paige's kept sets never repeated an opening)", twoOpenings.triggers.some((t) => t.startsWith("same opening")), JSON.stringify(twoOpenings.triggers));

const summary = perSetSummary([
  ...frameSet.map((p) => ({ ...p, callKey: "call-1" })),
  ...familySet.map((p) => ({ ...p, callKey: "call-2" })),
  ...set([["Fargo", "Moral messiness and eccentric small-town characters, like the crime drama in The Fall.", "The Fall"]]).map((p) => ({ ...p, callKey: "call-3" }))
]);
eq("picks group into one set per call", summary.sets, 3);
eq("would-trigger rate is per set", summary.wouldTriggerRate, 0.333);
check("a summary under the sample minimum says so", summary.enoughSample === false && MIN_EXPLANATIONS_PER_VARIANT === 200);
check("trigger kinds are counted", summary.triggerCounts.frame === 1, JSON.stringify(summary.triggerCounts));
check("vague hedges are measured per explanation", perSetSummary(set([["A", "Could appeal if you like eerie stories.", "X"], ["B", "A drowned house of statues, as patient as Piranesi.", "Piranesi"]]).map((p) => ({ ...p, callKey: "h" }))).hedgeWhyShare === 0.5);
eq("frame share is per explanation across sets", summary.frameWhyShare, 0.375);
check("metricsFor includes the per-set summary", metricsFor(frameSet.map((p) => ({ ...p, callKey: "x" }))).perSet.sets === 1);


// ---- #28 Stage 0: calibrating SET_GATE from a reference set ----------------------------------------
eq("nearest-rank 90th percentile", percentile([0, 0, 0, 0, 0, 0, 0, 0, 1, 2], 90), 1);
eq("95th percentile of one value", percentile([3], 95), 3);
eq("no values, no percentile", percentile([], 90), null);
const goodSets = [familySet, set([["Fargo", "Moral messiness and eccentric small-town characters, like the crime drama in The Fall.", "The Fall"], ["Control", "A building full of unexplained phenomena, for the atmosphere Alan Wake 2 built.", "Alan Wake 2"]])].map((picks) => ({ picks }));
const gate = suggestGate(goodSets);
check("a suggested gate is one above what good sets do, and never below 2", Object.values(gate).every((g) => g.suggested >= 2 && g.suggested >= g.p95 + 1), JSON.stringify(gate));
const draftCalls = ["narrow-10", "narrow-10", "narrow-10", "broad-50"].map((profile, n) => ({ type: "call", kind: "picks", source: "model", model: "claude-haiku-5-5", key: `claude-haiku-5-5|${profile}|r${n}`, shape: profile.split("-")[0], size: profile.split("-")[1], run: "run-a", picks: frameSet }));
const draftA = draftReference(draftCalls, { perCell: 2 });
eq("a draft takes up to N sets per shape and size", draftA.length, 3);
check("a draft is reproducible and starts unmarked", JSON.stringify(draftA) === JSON.stringify(draftReference(draftCalls, { perCell: 2 })) && draftA.every((d) => d.keep === null));
check("draft ids say which run they came from", draftA.every((d) => d.id.startsWith("run-a:")));

finish();
