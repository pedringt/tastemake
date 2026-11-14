// PAID, eval only (#311, approved by Paige: about 24 calls). Runs the four quality-floor profiles through
// production's own produceRecommendations twice, once with main's code ("before") and once with the
// related-quality-floor branch ("after"), 3 sets per profile, adding each set's picks to seenItemIds like
// the app does. Runs from .github/workflows/floor-eval-311.yml on its own branch, never on main.
//
// Caps are enforced here, before every Anthropic request: --max-calls per arm and --max-usd per arm
// (recorded spend from each response's usage, priced by src/server/ai-metrics.mjs). No database is
// configured, so nothing reaches the AI metrics table. TMDb vote lookups for the picks are free.
//
//   node scripts/evals/floor-eval-311.mjs --before <dir> --after <dir> --max-calls 12 --max-usd 0.025 --yes

import { readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { estimateCostUsd } from "../../src/server/ai-metrics.mjs";

const args = process.argv.slice(2);
const arg = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const refuse = (message) => { console.error(`refused: ${message}`); process.exit(2); };
const maxCalls = Number(arg("--max-calls"));
const maxUsd = Number(arg("--max-usd"));
const arms = { before: arg("--before"), after: arg("--after") };
const SETS = 3;
const MODEL = "claude-haiku-5-5";
// --dry-run turns live AI off (catalog fallback only): no Anthropic calls, for checking the wiring.
const dryRun = args.includes("--dry-run");
if (!dryRun && !args.includes("--yes")) refuse("paid run: pass --yes");
if (!(Number.isInteger(maxCalls) && maxCalls > 0 && maxCalls <= 12)) refuse("--max-calls must be 1-12 (approved: 12 per arm)");
if (!(Number.isFinite(maxUsd) && maxUsd > 0 && maxUsd <= 0.025)) refuse("--max-usd must be above 0 and at most 0.025 per arm");
if (!arms.before || !arms.after) refuse("--before and --after checkout folders are required");
if (!dryRun && (!process.env.ANTHROPIC_API_KEY || !process.env.TASTEMAKE_TMDB_TOKEN)) refuse("ANTHROPIC_API_KEY and TASTEMAKE_TMDB_TOKEN are required");

const profiles = JSON.parse(readFileSync(join(arms.after, "scripts/evals/quality-floor-profiles.json"), "utf8")).profiles;
const planned = profiles.length * SETS;
if (planned > maxCalls) refuse(`${planned} planned calls per arm is above --max-calls ${maxCalls}`);

const env = {
  ...process.env,
  TASTEMAKE_AI_ENABLED: dryRun ? "0" : "1",
  TASTEMAKE_AI_MODEL: MODEL,
  TASTEMAKE_RECOMMENDATIONS_MODEL: MODEL,
  TASTEMAKE_AI_RATE_LIMIT_CONFIRMED: "1",
  TASTEMAKE_AI_SPEND_CAP_CONFIRMED: "1",
  TASTEMAKE_DATABASE_URL: ""
};

function guardedFetch(spend) {
  return async (url, init) => {
    if (!String(url).startsWith("https://api.anthropic.com/")) return fetch(url, init);
    if (spend.calls >= maxCalls) throw new Error(`call cap reached (${maxCalls})`);
    if (spend.usd >= maxUsd) throw new Error(`spend cap reached ($${maxUsd})`);
    spend.calls += 1;
    const response = await fetch(url, init);
    try {
      const usage = (await response.clone().json())?.usage;
      if (usage) {
        spend.usd += estimateCostUsd({ model: MODEL, inputTokens: usage.input_tokens, outputTokens: usage.output_tokens, cacheReadTokens: usage.cache_read_input_tokens, cacheWriteTokens: usage.cache_creation_input_tokens, perCall: true }) ?? 0;
      }
    } catch { /* not JSON; the call is still counted */ }
    return response;
  };
}

const votes = new Map();
async function tmdbVotes(pick) {
  if (pick.provider !== "tmdb" || !pick.providerId) return null;
  const kind = pick.type === "tv" || (pick.domains ?? []).includes("tv") ? "tv" : "movie";
  const key = `${kind}/${pick.providerId}`;
  if (!votes.has(key)) {
    const res = await fetch(`https://api.themoviedb.org/3/${key}`, { headers: { authorization: `Bearer ${process.env.TASTEMAKE_TMDB_TOKEN}` } });
    const body = res.ok ? await res.json() : {};
    votes.set(key, { average: body.vote_average ?? null, count: body.vote_count ?? null });
  }
  return votes.get(key);
}

const results = {};
for (const [arm, dir] of Object.entries(arms)) {
  const { produceRecommendations } = await import(pathToFileURL(resolve(dir, "api/recommendations.mjs")).href);
  const spend = { calls: 0, usd: 0 };
  const fetchImpl = guardedFetch(spend);
  results[arm] = { spend, sets: [] };
  for (const profile of profiles) {
    const state = structuredClone(profile.state);
    state.seenItemIds = [...(state.seenItemIds ?? [])];
    for (let set = 1; set <= SETS; set += 1) {
      if (spend.calls >= maxCalls || spend.usd >= maxUsd) break;
      const started = Date.now();
      const out = await produceRecommendations({ rawState: state, env, fetchImpl });
      const ms = Date.now() - started;
      const picks = [];
      for (const pick of out.picks ?? []) {
        picks.push({ id: pick.id, title: pick.title, provider: pick.provider, domains: pick.domains ?? [], votes: await tmdbVotes(pick) });
        state.seenItemIds.push(pick.id);
      }
      results[arm].sets.push({ profile: profile.id, set, source: out.source, reason: out.reason ?? null, ms, picks });
      console.log(`${arm} ${profile.id} set ${set}: ${out.source}, ${picks.length} picks, ${ms} ms, calls ${spend.calls}, $${spend.usd.toFixed(4)}`);
    }
  }
}

const low = (v) => v && v.average != null && v.average < 5.8;
const lowVoted = (v) => low(v) && v.count >= 50;
function summarize(arm) {
  const { sets, spend } = results[arm];
  const picks = sets.flatMap((s) => s.picks);
  const tmdb = picks.filter((p) => p.provider === "tmdb");
  const mix = {};
  for (const p of picks) for (const d of p.domains) mix[d] = (mix[d] ?? 0) + 1;
  const ms = sets.map((s) => s.ms).sort((a, b) => a - b);
  return {
    sets: sets.length,
    modelSets: sets.filter((s) => s.source === "model").length,
    picks: picks.length,
    tmdbPicks: tmdb.length,
    under58: tmdb.filter((p) => low(p.votes)).length,
    under58With50Votes: tmdb.filter((p) => lowVoted(p.votes)).length,
    mix,
    medianMs: ms[Math.floor(ms.length / 2)] ?? null,
    calls: spend.calls,
    usd: Number(spend.usd.toFixed(4))
  };
}

const summary = { before: summarize("before"), after: summarize("after") };
const row = (label, f) => `| ${label} | ${f(summary.before)} | ${f(summary.after)} |`;
const lines = [
  "## #311 quality floor: main (before) vs main + #311 (after)",
  "",
  `Model ${MODEL}, ${profiles.length} profiles x ${SETS} sets per arm. Caps: ${maxCalls} calls and $${maxUsd} per arm.`,
  "",
  "| | before | after |",
  "|---|---|---|",
  row("Sets answered by the model", (s) => `${s.modelSets}/${s.sets}`),
  row("Picks (TMDb)", (s) => `${s.picks} (${s.tmdbPicks})`),
  row("TMDb picks under 5.8", (s) => `${s.under58}/${s.tmdbPicks}`),
  row("…of those with 50+ votes", (s) => `${s.under58With50Votes}/${s.tmdbPicks}`),
  row("Mix", (s) => Object.entries(s.mix).map(([d, n]) => `${d} ${n}`).join(", ")),
  row("Median ms", (s) => s.medianMs),
  row("Calls / spend", (s) => `${s.calls} / $${s.usd}`),
  "",
  "### Picks",
  ""
];
for (const arm of ["before", "after"]) {
  lines.push(`**${arm}**`, "");
  for (const s of results[arm].sets) {
    const titles = s.picks.map((p) => `${p.title}${p.votes ? ` (${p.votes.average?.toFixed?.(1) ?? "?"}/${p.votes.count ?? "?"})` : ""}${lowVoted(p.votes) ? " ⚠" : ""}`).join("; ");
    lines.push(`- ${s.profile} set ${s.set} [${s.source}]: ${titles || s.reason}`);
  }
  lines.push("");
}
const markdown = lines.join("\n");
writeFileSync("floor-eval-311.json", JSON.stringify({ summary, results }, null, 2));
writeFileSync("floor-eval-311.md", markdown);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown);
console.log(markdown);
