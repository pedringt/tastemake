// PAID (eval branches only, Nov 13): the #311 quality-floor before/after. One arm per run: the checked-out
// code's /api/recommendations path (produceRecommendations, in process) over the 4 profiles in
// scripts/evals/quality-floor-profiles.json, 3 sets in a row each, adding the ids just offered to
// state.seenItemIds between sets like the app does. Then free TMDb lookups give each offered TMDb pick's
// vote average and count, since the client payload leaves them out on purpose.
//
//   node scripts/evals/quality-floor-run.mjs --dry-run                                     # free: plan only
//   node scripts/evals/quality-floor-run.mjs --yes --max-calls 12 --max-usd 0.025 --tag after   # PAID
//
// Caps are enforced in code: globalThis.fetch is wrapped (so the code's own `fetchImpl !== fetch` checks
// still see production's fetch), and every request to api.anthropic.com is refused before it is sent when
// it would go past --max-calls, when its worst case (scripts/evals/pricing.mjs) could take recorded spend
// past --max-usd, or when its model is not claude-haiku-5-5. Key values are never read here except by the
// production code that sends them.
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { usageCostUsd, worstCaseUsd } from "./pricing.mjs";

const MODEL = "claude-haiku-5-5";
const SETS = 3;
const args = process.argv.slice(2);
const flag = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const dryRun = args.includes("--dry-run");
const maxCalls = Number(flag("--max-calls", NaN));
const maxUsd = Number(flag("--max-usd", NaN));
const tag = flag("--tag", "arm");
const outDir = flag("--out", "quality-floor-results");
const refuse = (why) => { console.error(`refused: ${why}`); process.exit(1); };

const { profiles } = JSON.parse(readFileSync(new URL("./quality-floor-profiles.json", import.meta.url), "utf8"));
const planned = profiles.length * SETS;
console.log(`Plan: ${planned} recommendation call(s) at most (${profiles.length} profiles x ${SETS} sets), model ${MODEL}, tag ${tag}.`);
console.log(`Keys present (values not read): ANTHROPIC_API_KEY ${process.env.ANTHROPIC_API_KEY ? "yes" : "no"}, TASTEMAKE_TMDB_TOKEN ${process.env.TASTEMAKE_TMDB_TOKEN ? "yes" : "no"}.`);
if (dryRun) { console.log("DRY RUN: no call made."); process.exit(0); }
if (!args.includes("--yes")) refuse("a paid run needs --yes");
if (!(Number.isInteger(maxCalls) && maxCalls > 0)) refuse("a paid run needs --max-calls <n>");
if (!(Number.isFinite(maxUsd) && maxUsd > 0)) refuse("a paid run needs --max-usd <dollars>");
if (planned > maxCalls) refuse(`the plan needs up to ${planned} call(s), more than --max-calls ${maxCalls}`);
if (!process.env.ANTHROPIC_API_KEY) refuse("ANTHROPIC_API_KEY is not set");
if (!process.env.TASTEMAKE_TMDB_TOKEN) refuse("TASTEMAKE_TMDB_TOKEN is not set (without it TMDb related rows are empty and the floor can't be measured)");

// ---- the spend guard ----------------------------------------------------------------------------------
const spend = { calls: 0, usd: 0 };
const realFetch = globalThis.fetch;
globalThis.fetch = async function guardedFetch(input, init = {}) {
  const url = String(input?.url ?? input);
  if (!url.startsWith("https://api.anthropic.com/")) return realFetch(input, init);
  const body = typeof init.body === "string" ? JSON.parse(init.body) : {};
  if (body.model !== MODEL) throw new Error(`spend guard: model ${body.model} is not ${MODEL}`);
  const worst = worstCaseUsd(body.model, init.body.length, body.max_tokens ?? 0);
  if (spend.calls >= maxCalls) throw new Error(`spend guard: --max-calls ${maxCalls} reached`);
  if (spend.usd + worst > maxUsd) throw new Error(`spend guard: worst case $${worst.toFixed(4)} on top of $${spend.usd.toFixed(4)} could pass --max-usd ${maxUsd}`);
  spend.calls += 1;
  const response = await realFetch(input, init);
  try { spend.usd += usageCostUsd(body.model, (await response.clone().json()).usage ?? {}); } catch { spend.usd += worst; }
  return response;
};

const { produceRecommendations } = await import("../../api/recommendations.mjs");
const { retrieveCatalogCandidates } = await import("../../src/catalog/related.mjs");
const env = {
  ...process.env,
  TASTEMAKE_AI_ENABLED: "1",
  TASTEMAKE_AI_MODEL: MODEL,
  TASTEMAKE_RECOMMENDATIONS_MODEL: MODEL,
  TASTEMAKE_AI_RATE_LIMIT_CONFIRMED: "1",
  TASTEMAKE_AI_SPEND_CAP_CONFIRMED: "1"
};

// ---- free TMDb lookups (vote data is kept off the client payload on purpose) ----------------------------
const votes = new Map();
async function tmdbVotes(item) {
  if (item?.provider !== "tmdb") return null;
  const key = `${item.type}:${item.providerId}`;
  if (!votes.has(key)) {
    votes.set(key, (async () => {
      try {
        const response = await realFetch(`https://api.themoviedb.org/3/${item.type === "tv" ? "tv" : "movie"}/${item.providerId}?language=en-US`, {
          headers: { authorization: `Bearer ${process.env.TASTEMAKE_TMDB_TOKEN}`, accept: "application/json" }
        });
        if (!response.ok) return null;
        const row = await response.json();
        return { average: Number(row.vote_average) || 0, count: Number(row.vote_count) || 0 };
      } catch { return null; }
    })());
  }
  return votes.get(key);
}
const lowRated = (v) => v && v.average < 5.8;
const flooredOut = (v) => v && v.count >= 50 && v.average < 5.8;
const medium = (item) => (item.domains ?? [])[0] ?? item.type ?? "?";

// ---- run --------------------------------------------------------------------------------------------
mkdirSync(outDir, { recursive: true });
const jsonl = `${outDir}/quality-floor-${tag}.jsonl`;
writeFileSync(jsonl, "");
const records = [];
for (const profile of profiles) {
  const state = structuredClone(profile.state);
  for (let set = 1; set <= SETS; set += 1) {
    let pool = [];
    const retrieve = async (...a) => (pool = await retrieveCatalogCandidates(...a));
    const started = Date.now();
    let result;
    try { result = await produceRecommendations({ rawState: state, env, retrieve }); }
    catch (error) { result = { source: "error", reason: String(error?.message ?? error), picks: [], meta: {} }; }
    const ms = Date.now() - started;
    const picks = await Promise.all((result.picks ?? []).map(async (p) => ({ id: p.id, title: p.title, provider: p.provider, medium: medium(p), votes: await tmdbVotes(p) })));
    const poolTmdb = await Promise.all(pool.filter((p) => p.provider === "tmdb").map(tmdbVotes));
    const record = {
      tag, profile: profile.id, set, ms, source: result.source, reason: result.source === "model" ? null : result.reason ?? null,
      paidCallMade: Boolean(result.meta?.paidCallMade), rejected: result.meta?.rejected ?? 0, picks,
      pool: { size: pool.length, tmdb: poolTmdb.length, low: poolTmdb.filter(lowRated).length, floored: poolTmdb.filter(flooredOut).length,
        mix: pool.reduce((m, p) => ({ ...m, [medium(p)]: (m[medium(p)] ?? 0) + 1 }), {}) }
    };
    records.push(record);
    appendFileSync(jsonl, JSON.stringify(record) + "\n");
    console.log(`${profile.id} set ${set}: ${record.source}, ${picks.length} picks, ${ms} ms, pool ${pool.length} (${record.pool.tmdb} TMDb, ${record.pool.floored} 50+ votes under 5.8)`);
    state.seenItemIds = [...new Set([...(state.seenItemIds ?? []), ...picks.map((p) => p.id)])];
  }
}

// ---- summary ----------------------------------------------------------------------------------------
const all = records.flatMap((r) => r.picks);
const tmdb = all.filter((p) => p.provider === "tmdb");
const looked = tmdb.filter((p) => p.votes);
const share = (n, d) => (d ? `${n}/${d} (${Math.round((n / d) * 100)}%)` : "0/0");
const ms = records.map((r) => r.ms).sort((a, b) => a - b);
const pct = (q) => ms[Math.min(ms.length - 1, Math.floor(q * ms.length))];
const mixOf = (picks) => picks.reduce((m, p) => ({ ...m, [p.medium]: (m[p.medium] ?? 0) + 1 }), {});
const poolSum = (k) => records.reduce((n, r) => n + r.pool[k], 0);
const lines = [
  `## Quality floor eval: ${tag}`,
  "",
  `${records.length} set(s); paid calls ${spend.calls}; estimated cost $${spend.usd.toFixed(4)} (cap ${maxCalls} calls / $${maxUsd}).`,
  "",
  "| Measure | Value |",
  "|---|---|",
  `| Offered TMDb picks with average under 5.8 | ${share(looked.filter((p) => lowRated(p.votes)).length, looked.length)} |`,
  `| Offered TMDb picks with 50+ votes and under 5.8 | ${share(looked.filter((p) => flooredOut(p.votes)).length, looked.length)} |`,
  `| Candidate pool TMDb rows with average under 5.8 | ${share(poolSum("low"), poolSum("tmdb"))} |`,
  `| Candidate pool TMDb rows with 50+ votes and under 5.8 | ${share(poolSum("floored"), poolSum("tmdb"))} |`,
  `| Pick mix (all sets) | ${JSON.stringify(mixOf(all))} |`,
  `| Sets with no TV / no movies / no books / no games | ${["tv", "movies", "read", "play"].map((d) => records.filter((r) => !r.picks.some((p) => p.medium === d)).length).join(" / ")} |`,
  `| Fallback sets (source not model) | ${share(records.filter((r) => r.source !== "model").length, records.length)} |`,
  `| Picks rejected by the validator | ${records.reduce((n, r) => n + r.rejected, 0)} |`,
  `| Latency median / p90 ms | ${pct(0.5)} / ${pct(0.9)} |`,
  "",
  "Per set (profile, set: source, mix, TMDb picks under 5.8 / looked up):",
  "",
  ...records.map((r) => `- ${r.profile} ${r.set}: ${r.source}${r.reason ? ` (${r.reason})` : ""}, ${JSON.stringify(mixOf(r.picks))}, ${r.picks.filter((p) => lowRated(p.votes)).length}/${r.picks.filter((p) => p.votes).length}: ${r.picks.map((p) => `${p.title}${p.votes ? ` [${p.votes.average.toFixed(1)}/${p.votes.count}]` : ""}`).join("; ")}`)
];
writeFileSync(`${outDir}/quality-floor-${tag}.md`, lines.join("\n") + "\n");
console.log("\n" + lines.join("\n"));
