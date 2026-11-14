// Why-line check (src/ai/why-lines.js, Nov 14): after validation, a live pick whose why is generic, repeats
// another pick's wording, or names no cited item keeps its place with a plain software line. Free: no network,
// no model (the live path runs against a stubbed Anthropic response).
import { createSuite } from "./lib/assert.mjs";
import { checkWhyLines, namesTitle, shortTitle } from "../../src/ai/why-lines.js";
import { setRepetition } from "../evals/stress/metrics.mjs";
import { produceRecommendations } from "../../api/recommendations.mjs";

const { check, eq, finish } = createSuite("why-lines");

const quietly = async (fn, logs = null) => {
  const { info, warn, error } = console;
  console.info = (...args) => logs?.push(args.join(" "));
  console.warn = console.error = () => {};
  try { return await fn(); } finally { Object.assign(console, { info, warn, error }); }
};

// ---- fixtures ------------------------------------------------------------------------------------------
const ev = (ref, title, polarity = 1) => ({ ref, title, polarity, class: "experienced" });
const evidence = [
  ev("ev:circe", "Circe"),
  ev("ev:arrival", "Arrival"),
  ev("ev:mistborn", "Mistborn: The Final Empire"),
  ev("ev:eeaao", "Everything Everywhere All at Once"),
  ev("ev:prada", "The Devil Wears Prada"),
  ev("ev:twilight", "Twilight", -1)
];
const pick = (itemId, why, cites, item = {}) => ({ itemId, why, cites, kind: "pick", item: { id: itemId, title: itemId, type: "book", ...item } });
const run = (picks) => checkWhyLines(picks, evidence);

// ---- good lines are left alone ---------------------------------------------------------------------------
{
  const good = [
    pick("Song of Achilles", "Gods seen up close and humbled, the way Circe tells it.", ["ev:circe"]),
    pick("Story of Your Life", "Language bending time, the idea under Arrival.", ["ev:arrival"], { type: "book" }),
    pick("The Lies of Locke Lamora", "You liked Mistborn's heist plot; this whole book is one long con.", ["ev:mistborn"]),
    pick("Swiss Army Man", "Grief played as absurd comedy, as Everything does at its best.", ["ev:eeaao"], { type: "movie" }),
    pick("The Bear", "Kitchen pressure that lands like Prada's office terror.", ["ev:prada"], { type: "tv" }),
    // #261 anchor line shapes (the prompt's own examples).
    pick("Piranesi", "A drowned house of statues and tides, as patient as Circe's island.", ["ev:circe"])
  ];
  const out = run(good);
  eq("good lines: none replaced", out.replaced, 0);
  check("good lines: text and order unchanged", out.picks.every((p, i) => p === good[i]));
  eq("good lines: the count of checked lines", out.checked, 6);
  check("good lines: no reason counted", Object.values(out.reasons).every((n) => n === 0), JSON.stringify(out.reasons));
}

// ---- the bridge pick line (#313) passes when it's fine ------------------------------------------------------
{
  const bridge = pick("Exhalation", "A book test: the quiet dread of Arrival, on the page.", ["ev:arrival"], { type: "book", bridge: { sharedGenres: ["sci-fi"] }, relatedToId: "arrival", relatedTo: "Arrival" });
  const out = run([pick("Moon", "A lonely astronaut and a patient mystery, as in Arrival.", ["ev:arrival"], { type: "movie" }), bridge]);
  eq("bridge: a good test line is kept", out.picks[1].why, bridge.why);
  eq("bridge: nothing replaced", out.replaced, 0);
}

// ---- 1. generic ----------------------------------------------------------------------------------------------
{
  const out = run([
    pick("A", "Since you loved Circe, you'll love this one too.", ["ev:circe"]),
    pick("B", "Another literary fantasy pick like Circe.", ["ev:circe"]),
    pick("C", "Matches your taste, much like Arrival.", ["ev:arrival"])
  ]);
  check("generic: a line with nothing specific left is replaced", out.picks[0].whyReplaced?.includes("generic"), JSON.stringify(out.picks[0]));
  check("generic: a genre-only line is replaced", out.picks[1].whyReplaced?.includes("generic"), out.picks[1].why);
  check("generic: circular phrasing is replaced", out.picks[2].whyReplaced?.includes("generic"), out.picks[2].why);
  eq("generic: the plain line names the cited item", out.picks[0].why, "Because you liked Circe.");
  eq("generic: counted by reason", out.reasons.generic, 3);
  eq("generic: picks are never dropped", out.picks.length, 3);
}

// ---- 2. repeats: keep the first, replace later ones -------------------------------------------------------------
{
  const opening = run([
    pick("A", "Quiet dread and a slow reveal, like Arrival.", ["ev:arrival"]),
    pick("B", "Quiet dread in a drowned house, as in Circe.", ["ev:circe"])
  ]);
  eq("repeat: the first line with an opening is kept", opening.picks[0].why, "Quiet dread and a slow reveal, like Arrival.");
  eq("repeat: a later line with the same two-word opening is replaced", opening.picks[1].whyReplaced?.join(), "repeat");
  eq("repeat: …with a plain line naming its own cited item", opening.picks[1].why, "Because you liked Circe.");

  const phrase = [
    pick("A", "Gods and grudges told with the slow burn of Circe.", ["ev:circe"]),
    pick("B", "Aliens, grief and the slow burn of Arrival.", ["ev:arrival"]),
    pick("C", "Heists, ash and the slow burn of Mistborn.", ["ev:mistborn"])
  ];
  const shared = run(phrase);
  eq("repeat: two lines sharing a phrase are fine (the stress gate is three)", [shared.picks[0].whyReplaced, shared.picks[1].whyReplaced].filter(Boolean).length, 0);
  eq("repeat: the third line with the phrase is replaced", shared.picks[2].whyReplaced?.join(), "repeat");
  eq("repeat: its plain line names Mistborn by its short title", shared.picks[2].why, "Because you liked Mistborn.");

  const stock = run([
    pick("A", "A harbor town that echoes Circe's island.", ["ev:circe"]),
    pick("B", "Mirrors Arrival's patience with strangers.", ["ev:arrival"]),
    pick("C", "Its ash-covered city recalls Mistborn's Luthadel.", ["ev:mistborn"])
  ]);
  eq("repeat: a third callback verb (echo/mirror/recall) is replaced", stock.picks.map((p) => p.whyReplaced?.join() ?? "-").join("|"), "-|-|repeat");

  // Two replaced lines in one set don't repeat each other either.
  const many = run([
    pick("A", "Witches, gods and exile, as Circe tells it.", ["ev:circe"]),
    pick("B", "Witches, gods and exile, as Circe tells it.", ["ev:circe"]),
    pick("C", "Witches, gods and exile, as Circe tells it.", ["ev:circe"]),
    pick("D", "Witches, gods and exile, as Circe tells it.", ["ev:circe"])
  ]);
  eq("repeat: identical lines after the first are all replaced", many.replaced, 3);
  const whys = many.picks.map((p) => p.why);
  eq("repeat: replaced lines differ from each other", new Set(whys).size, 4);
  const asRecords = many.picks.map((p) => ({ title: p.itemId, why: p.why, citedEvidence: [{ title: "Circe" }] }));
  eq("repeat: the checked set no longer trips the stress eval's gate", setRepetition(asRecords).wouldTrigger, false);
}

// ---- 3. names no cited item -------------------------------------------------------------------------------------
{
  const out = run([
    pick("A", "Derelict space station dread, like the tense exploration Alien fans prize.", ["ev:arrival"]),
    pick("B", "Grief and absurdity as one, like Everything.", ["ev:eeaao"]),
    pick("C", "The bleak charm you enjoyed in Twilight, despite Circe.", ["ev:twilight", "ev:circe"]),
    pick("D", "ev:circe", ["ev:circe"])
  ]);
  eq("no title: a line naming another title instead is replaced", out.picks[0].whyReplaced?.join(), "no-cited-title");
  eq("no title: its plain line names the cited item", out.picks[0].why, "Because you liked Arrival.");
  eq("no title: 'Everything' counts for Everything Everywhere All at Once", out.picks[1].whyReplaced, undefined);
  eq("a line naming a cited item kept as is", out.picks[2].whyReplaced, undefined);
  eq("no title: a line that is only an internal ref is replaced", out.picks[3].whyReplaced?.join(), "no-cited-title");
  check("no title: …and its plain line never shows the ref", !/ev:/.test(out.picks[3].why), out.picks[3].why);

  const disliked = run([pick("E", "A moody small town and vampires.", ["ev:twilight", "ev:circe"])]);
  eq("the plain line names a liked cited item, never the disliked one", disliked.picks[0].why, "Because you liked Circe.");

  const bridge = run([pick("Exhalation", "A book test of patient alien contact.", ["ev:arrival"], { type: "book", bridge: { sharedGenres: ["sci-fi"] }, relatedToId: "arrival" })]);
  eq("a failed bridge line still says it's a test and names its source", bridge.picks[0].why, "A book test, found from Arrival.");
}

// ---- recognisable titles -----------------------------------------------------------------------------------------
eq("short title: the part before a subtitle", shortTitle("Terminator 2: Judgment Day"), "Terminator 2");
eq("short title: a year in brackets is dropped", shortTitle("Shōgun (2024)"), "Shōgun");
eq("short title: a bracketed note is dropped", shortTitle("The Adventures of Sherlock Holmes [12 stories]"), "The Adventures of Sherlock Holmes");
eq("short title: a long title with no subtitle is kept whole", shortTitle("Everything Everywhere All at Once"), "Everything Everywhere All at Once");
check("names: a possessive counts", namesTitle("Built with Piranesi's patience.", "Piranesi"));
check("names: a curly apostrophe in the title still matches", namesTitle("Ender's war games, grown up.", "Ender’s Game"));
check("names: the main title without its article", namesTitle("Grim like Last of Us.", "The Last of Us"));
check("names: a later distinctive word ('Prada')", namesTitle("Office terror like Prada.", "The Devil Wears Prada"));
check("names: a one-word title written in lower case is not a mention", !namesTitle("An arrival at a quiet house.", "Arrival"));
check("names: a two-letter title must be capitalised", !namesTitle("It builds up slowly.", "Up") && namesTitle("Like Up, it opens with grief.", "Up"));

// ---- the live path: counts in the log, reasons on the pick and the meta, no pick dropped -------------------------
{
  const movie = (id, title, relatedToId = null) => ({ id: `tmdb-movie-${id}`, provider: "tmdb", providerId: String(id), type: "movie", title, domains: ["movies"], genres: ["878"], ...(relatedToId ? { relatedToId } : {}) });
  const arrival = movie(1, "Arrival");
  const contact = movie(2, "Contact");
  const pool = [movie(11, "Moon", arrival.id), movie(12, "Solaris", arrival.id), movie(13, "Gravity", contact.id)];
  const rawState = {
    selectedFavorites: [], customItems: {}, libraryFavorites: [], recommendationSets: [], seenItemIds: [], exclusions: [],
    areas: { movies: true, tv: true, read: true, play: true }, curveball: false, recommendationFilter: "all",
    feedbackByRecommendation: Object.fromEntries([arrival, contact].map((item) => [item.id, { item, rating: "more", detail: "loved-before", refinements: [] }]))
  };
  const AI_ENV = { TASTEMAKE_AI_ENABLED: "1", ANTHROPIC_API_KEY: "fake-key", TASTEMAKE_AI_MODEL: "claude-test", TASTEMAKE_AI_RATE_LIMIT_CONFIRMED: "1", TASTEMAKE_AI_SPEND_CAP_CONFIRMED: "1", VERCEL_ENV: "preview" };
  const answer = { picks: [
    { itemId: pool[0].id, anchor: "setting", why: "A lonely base on the far side, as quiet as Arrival.", cites: [`ev:${arrival.id}`] },
    { itemId: pool[1].id, anchor: "tone", why: "A lonely base on the far side, as quiet as Arrival.", cites: [`ev:${arrival.id}`] },
    { itemId: pool[2].id, anchor: "theme", why: "You'll love this one if you loved it.", cites: [`ev:${contact.id}`] }
  ], curveballItemId: null };
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ content: [{ type: "text", text: JSON.stringify(answer) }], usage: { input_tokens: 1, output_tokens: 1 }, model: "claude-test" }) });
  const logs = [];
  const result = await quietly(() => produceRecommendations({ rawState, env: AI_ENV, fetchImpl, retrieve: async () => pool, trace: true }), logs);
  eq("live: the model's picks are used", result.source, "model");
  eq("live: all three picks kept", result.picks.length, 3);
  eq("live: the first line is shown as written", result.picks[0].reason, answer.picks[0].why);
  eq("live: the repeated second line is replaced", result.picks[1].reason, "Because you liked Arrival.");
  eq("live: …and marked on the pick", result.picks[1].ai?.whyReplaced?.join(), "repeat");
  eq("live: the generic third line names Contact, opening differently from the other plain line", result.picks[2].reason, "Picked with Contact in mind.");
  check("live: a kept line carries no whyReplaced field", !("whyReplaced" in result.picks[0].ai));
  eq("live: the meta counts replacements", result.meta.whyReplaced, 2);
  eq("live: the trace lists replaced picks with reasons", JSON.stringify(result.trace.model.whyReplaced), JSON.stringify([{ itemId: pool[1].id, reasons: ["repeat"] }, { itemId: pool[2].id, reasons: ["no-cited-title", "generic"] }]));
  const line = logs.find((l) => l.includes('"stage":"whyLines"'));
  check("live: a whyLines log line is written", Boolean(line), logs.join("\n"));
  const logged = line ? JSON.parse(line.slice(line.indexOf("{"))) : {};
  eq("live: the log has counts", `${logged.checked}/${logged.replacedCount}`, "3/2");
  eq("live: the log has reasons", JSON.stringify(logged.replacementReasons), JSON.stringify({ generic: 1, repeat: 1, "no-cited-title": 1 }));
  check("live: the log never carries pick text or titles", !/Arrival|Contact|lonely|love/i.test(line ?? ""), line);
}

finish();
