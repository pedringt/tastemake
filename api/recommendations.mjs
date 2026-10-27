import { Buffer } from "node:buffer";
import { buildContext } from "../src/ai/context.js";
import { acceptOrFallback, validatePicks } from "../src/ai/validate.js";
import { retrieveCatalogCandidates } from "../src/catalog/related.mjs";
import { applyTaglineFallback } from "../src/catalog/providers.mjs";
import { sanitizeRecommendationCopy } from "../src/lib/recommendation-copy.js";
import { aiOutcomeForError, recordAiCallInBackground } from "../src/server/ai-metrics.mjs";
import { AI_BUDGET_MESSAGE, callAnthropic, isAiBudgetExhausted, liveConfig } from "../src/server/anthropic.mjs";
import { PICKS_OUTPUT_SCHEMA } from "../src/server/output-schemas.mjs";
import { hydrateState } from "../src/server/request-state.mjs";
import { domainById } from "../src/data/domains.js";
import { isAdultTagged, triedAdultTagged } from "../src/catalog/adult-content.mjs";
import { evidenceRecords } from "../src/model/evidence.js";
import { fallbackReason } from "../src/catalog/fallback-reasons.mjs";
import { contentThemesFor } from "../src/model/refinements.js";
import { excludedBy } from "../src/model/exclusions.js";
import { chooseCandidates, closestRatings } from "../src/ai/taste-score.js";

const MAX_BODY_BYTES = 160_000;
const DEFAULT_VISITOR_LIMIT = 6;
const DEFAULT_WINDOW_MS = 60_000;
const MAX_PROMPT_EVIDENCE = 18;
const rateBuckets = globalThis.__tastemakeAiRateBuckets ??= new Map();

function parseBody(body) {
  if (body && typeof body === "object") return body;
  if (typeof body === "string") return JSON.parse(body);
  return {};
}

function clientIp(req) {
  const forwarded = req.headers?.["x-forwarded-for"] ?? req.headers?.get?.("x-forwarded-for");
  return String(forwarded || "unknown").split(",")[0].trim();
}

function underBestEffortRateLimit(ip, now = Date.now()) {
  const limit = Number(process.env.TASTEMAKE_AI_VISITOR_LIMIT || DEFAULT_VISITOR_LIMIT);
  const windowMs = Number(process.env.TASTEMAKE_AI_RATE_WINDOW_MS || DEFAULT_WINDOW_MS);
  const bucket = rateBuckets.get(ip);
  if (!bucket || now - bucket.started >= windowMs) {
    rateBuckets.set(ip, { started: now, count: 1 });
    return true;
  }
  if (bucket.count >= limit) return false;
  bucket.count += 1;
  return true;
}

function compactEvidenceRecord(record) {
  return {
    ref: record.ref,
    title: record.title,
    type: record.type ?? null,
    domains: record.domains ?? [],
    kind: record.kind,
    polarity: record.polarity,
    // #250 PR 2: the label alone ("Pacing: too slow", "Romance took over the story") carries dimension and
    // direction; ids and the structured fields stay server-side for validation.
    refinements: (record.refinements ?? []).map((entry) => (typeof entry === "string" ? entry : entry.label ?? entry.id)).filter(Boolean)
  };
}

const hasReasons = (record) => ((record.refinements ?? []).length > 0 ? 1 : 0);

function promptEvidencePriority(record) {
  if (record.kind === "experienced-favorite" || record.kind === "starter-favorite") return 4;
  if (record.kind === "experienced-strong-positive") return 3;
  if (record.kind === "experienced-negative") return 2;
  if (record.kind === "experienced-positive") return 1;
  return 0;
}

// #120: the full product history remains in state and in the validator context. The model does not need
// every historical row on every ranking call, only a small working set.
//
// Oct 27 (whole-profile recommendations): the working set is chosen per candidate. Each offered candidate
// brings the rated items most like it (Liked ones included), so whatever the model cites is the closest
// real reason, and over rounds the whole history gets its turn instead of the same oldest favorites. Then
// one dislike per type as contrast (the one most like this round's candidates), then the strongest
// remaining positives, rotated between rounds, until the cap.
// Oct 27: the six offered are the best fits for everything the person has rated (src/ai/taste-score.js),
// not the first six retrieval returned. With a surprise slot, it goes to a candidate found from a Liked item.
// Exported so the stress eval offers exactly what production does.
export function offeredCandidates(ctx, count = 6) {
  return chooseCandidates(ctx.candidates, ctx.evidence, { count, mode: ctx.recommendationFilter, curveball: ctx.curveball });
}

export function selectPromptEvidence(ctx, limit = MAX_PROMPT_EVIDENCE) {
  const all = (ctx.evidence ?? []).filter((record) => record?.class === "experienced");
  const candidates = ctx.candidates ?? [];
  const candidateDomains = [...new Set(candidates.flatMap((item) => item.domains ?? []))];
  const relevant = candidateDomains.length
    ? all.filter((record) => (record.domains ?? []).some((domain) => candidateDomains.includes(domain)))
    : all;
  const pool = relevant.length ? relevant : all;

  const selected = [];
  const seen = new Set();
  const add = (record) => {
    if (!record || seen.has(record.ref) || selected.length >= limit) return;
    seen.add(record.ref);
    selected.push(record);
  };
  const rotation = Number(ctx.evidenceRotation ?? 0);
  const rotate = (records, offset = 0) => {
    if (!records.length) return records;
    const at = Math.abs(offset) % records.length;
    return records.slice(at).concat(records.slice(0, at));
  };
  const ranked = (records) => records
    .map((record, index) => ({ record, index }))
    // #250 PR 2: among equals, items the person gave reasons for go first.
    .sort((a, b) => promptEvidencePriority(b.record) - promptEvidencePriority(a.record) || b.record.weight - a.record.weight || hasReasons(b.record) - hasReasons(a.record) || b.index - a.index)
    .map(({ record }) => record);
  const cache = new Map();

  // 1. For each candidate: the item it was found from, then its closest liked/loved ratings.
  for (const candidate of candidates) {
    const anchor = pool.find((record) => record.itemId === candidate.relatedToId && record.polarity > 0);
    add(anchor);
    const room = anchor ? 1 : 2;
    closestRatings(candidate, pool, { polarity: 1, limit: room + 1, cache })
      .map(({ record }) => record)
      .filter((record) => !seen.has(record.ref))
      .slice(0, room)
      .forEach(add);
  }

  // 2. One dislike per type, as contrast: the one most like this round's candidates of that type.
  for (const domain of candidateDomains) {
    const negatives = pool.filter((record) => record.polarity < 0 && (record.domains ?? []).includes(domain));
    if (!negatives.length) continue;
    const near = candidates
      .filter((item) => (item.domains ?? []).includes(domain))
      .flatMap((item) => closestRatings(item, negatives, { polarity: -1, limit: 1, cache }))
      .sort((a, b) => b.similarity - a.similarity)[0]?.record;
    add(near ?? rotate(ranked(negatives), rotation)[0]);
  }

  // 3. Fill with positives, strongest first but rotated between rounds so the same few don't always win.
  rotate(ranked(pool.filter((record) => record.polarity > 0)), rotation * 3).forEach(add);
  return selected.slice(0, limit);
}

function pickPromptPayload(ctx) {
  return {
    evidence: selectPromptEvidence(ctx).map(compactEvidenceRecord),
    // The model ranks candidates; it does not need provider ids or validation-only hypothesis fields.
    // Keep synopsis copy short so input processing stays bounded without removing the useful premise.
    candidates: ctx.candidates.map((item) => {
      const { id, title, type, domains, about, year, genres } = item;
      const themes = contentThemesFor(item);
      return {
        id, title, type, domains,
        about: typeof about === "string" ? about.slice(0, 220) : about,
        year,
        genres: (genres ?? []).slice(0, 8),
        ...(themes.length ? { themes } : {}),
        ...(item.edge ? { edge: true } : {})
      };
    }),
    curveball: ctx.curveball,
    statements: ctx.statements,
    contexts: ctx.contexts
  };
}

function pickPromptInstructions(count, { recommendationFilter = "all" } = {}) {
  return [
    "You are the recommendation interpreter inside Tastemake.",
    "The product, not you, decides what is evidence, which candidates are eligible, and what state may change.",
    `Choose exactly ${count} items from candidates and return JSON only in this compact shape: {"picks":[{"itemId":"...","why":"...","cites":["ev:..."]}],"curveballItemId":null}. If you choose one exploratory pick, replace null with that candidate itemId string. Software adds validation-only fields after you respond.`,
    // Real report (2026-09-28): with the domain filter set to "All", one real request returned 5/6
    // picks from a single domain (games), and the very next returned 6/6 from a different single
    // domain (movies) -- candidate retrieval already interleaves a mixed pool across domains, but
    // nothing told the model to keep its own final selection spread out, so it could freely cluster
    // in whichever domain its strongest evidence happened to favor. A soft nudge, not a hard quota
    // (Paige's call): prefer spread when it's a reasonably close call, but a real, strongly-evidenced
    // cluster in one domain is still allowed to stand rather than be forced apart artificially.
    ...(recommendationFilter === "all" ? [
      "The domain filter is \"All\": each candidate's domains field shows movies/tv/read/play. Prefer a spread across the domains actually represented in candidates rather than clustering most or all picks in a single domain, unless the evidence genuinely and specifically favors that domain over the others -- do not force in a weaker candidate from another domain just to manufacture variety."
    ] : []),
    // #120: live-call latency is proportional to output tokens (~11ms/token, measured directly from
    // real production timing across requests with very different prompt sizes -- see #120). "why"
    // had no length limit before this, and real output ran 150-260+ tokens per pick. A hard word cap
    // is the one lever that reduces output tokens without touching evidence/validation rules.
    // #120 follow-up: real production logs showed every single pick rejected, every time, for
    // "tests a pattern that is not attached to this candidate" -- traced to candidate.hypotheses
    // never being populated for real catalog candidates (searched the whole codebase: it is read in
    // several places but assigned nowhere), so any non-null `tests` the model chose was guaranteed to
    // fail validation. The instruction below now says that plainly instead of implying a real
    // per-candidate hypothesis id usually exists to test.
    "Across the final set, vary the concrete reason for each pick and avoid repeating the same opening phrase or sentence template. Treat dislikes as useful counterexamples, not the user's defining taste: prefer positive evidence as the main anchor, use a negative only when it adds specific contrast, and never center more than one pick on the same disliked item.",
    // Oct 19 (stress eval #28): explanations reused the same openings and stock phrases across picks
    // ("in the vein of", "your love of", "you enjoyed in"); about 75% shared a 4-word phrase with another.
    "Make each why distinct from the others in this response: start each one differently, and name the specific thing that connects the pick to the cited item (for example its tone, setting, structure, theme or craft). Avoid stock phrases such as 'in the vein of', 'your love of', 'you enjoyed in', 'similar to' and 'fans of'.",
    "User-facing explanations must say why the pick may fit the person, not how retrieval found it. Never mention providers, catalog branches/paths/neighbors/signals, metadata, similarity scores, embeddings, retrieval provenance, or raw overlap counts. A disliked item may only appear as explicit contrast, never as the positive reason a pick fits.",
    "An evidence row may include refinements: explicit reasons the user said that specific item worked or did not work. Use them as item-local context, not as standalone evidence or a global preference unless multiple independent experienced items support that broader pattern.",
    "A refinement may name a direction (\"Pacing: too slow\", \"Pacing: slow burn paid off\"): keep the direction, since opposite directions are opposite signals. A candidate's themes mean the theme is present, not that it dominates the book; one item's reason about a theme (\"Romance took over the story\") must not rule out every candidate with that theme.",
    "Rules: itemId must come from candidates; every why must cite at least one experienced evidence ref; the evidence list has already been limited by software to relevant experienced signals; never cite intent-only evidence as support; never contradict a user-confirmed pattern statement; treat says=partial as narrow/conditional and honor its context or excludedDomains; says=unsure is not a confirmed preference; never describe one global identity/aesthetic; never use circular reasons like 'matches your taste'; explain why the pick may fit in specific plain English, in one sentence of 14 words or fewer; internal refs such as ev:... belong only in cites and must never appear in why; never expose provider ids or other internal identifiers in why; if curveball is true you may choose at most one exploratory pick by putting only its itemId in curveballItemId, otherwise use null; if curveball is false curveballItemId must be null; a candidate with edge:true was found from something the user liked but did not love, so when you choose an exploratory pick prefer it and ground its why in a liked item; do not write the word curveball in why.",
    "Respond with the JSON object only — the very first character of your reply must be { and the very last must be }. No markdown fences, no preamble like \"Looking at...\", no commentary before or after the JSON."
  ].join("\n\n");
}

export function buildPickPrompt(ctx, count) {
  return [pickPromptInstructions(count, { recommendationFilter: ctx.recommendationFilter }), `CONTEXT\n${JSON.stringify(pickPromptPayload(ctx))}`].join("\n\n");
}

// The model answers in a compact shape (no per-pick kind/tests). Fill them in before validation;
// shared with scripts/evals/run.mjs so the live eval validates exactly what production validates.
export function normalizeModelPicks(compact) {
  return compact && Array.isArray(compact.picks)
    ? {
        ...compact,
        picks: compact.picks.map((pick) => ({
          ...pick,
          tests: pick.tests ?? null,
          kind: pick.kind ?? (compact.curveballItemId && pick.itemId === compact.curveballItemId ? "curveball" : "pick")
        }))
      }
    : compact;
}

// QA sweep real bug: rank used to be the raw array index + 1, so a curveball anywhere but last (the
// model's picks array order is whatever it returned -- nothing sorts curveballs to the end first)
// left a gap in the visible rank sequence for the real (non-curveball) picks, e.g. 1, [curveball], 3
// instead of 1, [curveball], 2. rank is now a running counter over non-curveball picks only, so it
// always reads as a dense 1..N regardless of where the curveball lands in the array.
function clientPicks(validated) {
  let rank = 0;
  return validated.map((pick) => ({
    ...pick.item,
    rank: pick.kind === "curveball" ? null : (rank += 1),
    fit: pick.kind === "curveball" ? "Exploratory fit" : "Promising fit",
    prediction: "Worth testing",
    surprise: pick.kind === "curveball",
    reason: sanitizeRecommendationCopy(pick.why) || "Tastemake is testing this against things you've liked before.",
    ai: { cites: pick.cites, tests: pick.tests, kind: pick.kind, contract: pick.contract }
  }));
}

// When live AI is unavailable or its output fails validation, fall back to the same real catalog
// candidates. There is no hand-written recommendation inventory in the product.
// Oct 20: reasons name what the pick shares with the item it was found through (src/catalog/fallback-reasons.mjs).
function anchorFor(item, state) {
  const id = item.relatedToId;
  return id ? (state.customItems?.[id] ?? state.feedbackByRecommendation?.[id]?.item ?? null) : null;
}

// #257: the fallback's curveball slot follows the same rule as the model's (src/catalog/adult-content.mjs):
// an explicitly adult-tagged item only when the user has tried that kind of thing. Otherwise the next
// eligible candidate takes the slot, or the set has no curveball.
function catalogPicks(candidates, state, evidence = [], pool = candidates) {
  const chosen = candidates.slice(0, 6);
  let curveballAllowed = state.curveball !== false && chosen.length >= 6;
  if (curveballAllowed && isAdultTagged(chosen[5]) && !triedAdultTagged(evidence)) {
    const replacement = pool.find((item) => !isAdultTagged(item) && !chosen.some((picked) => picked.id === item.id));
    if (replacement) chosen[5] = replacement;
    else curveballAllowed = false;
  }
  return chosen.map((item, index) => {
    const curveball = curveballAllowed && index === chosen.length - 1;
    const basis = fallbackReason(item, anchorFor(item, state), { index, curveball });
    return {
      ...item,
      rank: curveball ? null : index + 1,
      fit: curveball ? "Exploratory fit" : "Promising fit",
      prediction: "Worth testing",
      surprise: curveball,
      reason: basis,
      ai: null
    };
  });
}

function fallbackPayload(candidates, state, reason, meta = {}, pool = candidates) {
  return {
    source: "catalog",
    reason,
    picks: catalogPicks(candidates, state, evidenceRecords(state), pool),
    meta: { ...meta, paidCallMade: meta.paidCallMade ?? false }
  };
}

// #120: stage-boundary timing, logged server-side only (never returned to the client) in the same
// sanitized style as [tastemake-catalog]/[tastemake-related]: stage name and ms, nothing about
// prompt/candidate contents or credentials.
function logStage(stage, ms, extra = {}) {
  console.info("[tastemake-recommendations-timing]", JSON.stringify({ stage, ms, ...extra }));
}

// #120 diagnosis only: count characters by prompt section without logging any prompt/user/catalog text.
// These component sizes plus framingChars equal promptChars.
function promptSizeBreakdown(ctx, count, prompt) {
  const payload = pickPromptPayload(ctx);
  const fixedChars = pickPromptInstructions(count, { recommendationFilter: ctx.recommendationFilter }).length;
  const evidenceChars = JSON.stringify(payload.evidence).length;
  const candidateChars = JSON.stringify(payload.candidates).length;
  const statementsChars = JSON.stringify(payload.statements).length;
  const contextsChars = JSON.stringify(payload.contexts).length;
  const controlChars = JSON.stringify(payload.curveball).length;
  const measuredChars = fixedChars + evidenceChars + candidateChars + statementsChars + contextsChars + controlChars;
  return {
    promptChars: prompt.length,
    fixedChars,
    evidenceChars,
    candidateChars,
    statementsChars,
    contextsChars,
    controlChars,
    framingChars: prompt.length - measuredChars,
    candidateCount: payload.candidates.length,
    evidenceCount: payload.evidence.length,
    totalEvidenceCount: Array.isArray(ctx.evidence) ? ctx.evidence.length : 0
  };
}

// #120: candidate prefetch ("warm"). Production timing shows candidate retrieval (TMDb / Open Library
// / IGDB fan-out) can take as long as the model call, and its results already go through the shared
// runtime cache per anchor item (related.mjs, 15 min). The client sends the same serialized state
// with `warm: true` while the user is still choosing favorites, so the provider calls happen then
// and the real request a few seconds later finds them cached. This runs retrieval only: it never
// calls the model, never builds a prompt, never returns candidates, and changes no ranking,
// eligibility, validation or novelty rule -- the real request still does all of that itself.
export async function warmRecommendationCandidates({ rawState, env = process.env, fetchImpl = fetch } = {}) {
  const state = hydrateState(rawState);
  const started = Date.now();
  const retrieved = await retrieveCatalogCandidates(state, { env, fetchImpl });
  const ms = Date.now() - started;
  logStage("warmRetrieval", ms, { candidates: retrieved.length });
  return { warmed: true, candidates: retrieved.length, ms, meta: { paidCallMade: false } };
}

// `retrieve` defaults to production's catalog retrieval. Only the #28 stress eval
// (scripts/evals/stress/) passes its own, to hold the candidate pool fixed while measuring reasoning.
export async function produceRecommendations({ rawState, env = process.env, fetchImpl = fetch, retrieve = retrieveCatalogCandidates } = {}) {
  const state = hydrateState(rawState);

  let started = Date.now();
  // #48: "never recommend" boundaries come off before anything is picked, for live AI and fallback alike.
  const pool = await retrieve(state, { env, fetchImpl });
  const retrieved = state.exclusions.length ? pool.filter((item) => !excludedBy(item, state.exclusions)) : pool;
  logStage("candidateRetrieval", Date.now() - started, { candidates: retrieved.length, excluded: pool.length - retrieved.length });

  started = Date.now();
  const ctx = buildContext(state, retrieved);
  logStage("buildContext", Date.now() - started);

  const candidates = offeredCandidates(ctx);
  if (!candidates.length) {
    // Real bug (2026-09-29): retrieveCatalogCandidates narrows anchor selection to only evidence
    // already tagged with the active domain filter (related.mjs's `evidenceItems` filter) before it
    // ever looks for candidates -- a real, common dead end now that Movies/TV are split, since most
    // people have far more movie reactions than TV ones. With zero anchors in that domain it silently
    // returns [] every time, which used to read as a generic, identical "no eligible picks" message
    // whether the cause was genuine exhaustion or simply "you've never reacted to a TV show." Naming
    // the actual cause when it's a domain-specific evidence gap (rather than real exhaustion) gives
    // the user something actionable instead of a dead end that looks like a bug.
    const filter = state.recommendationFilter ?? "all";
    const hasDomainEvidence = filter === "all" || (ctx.evidence ?? []).some((record) => record.countsAsTaste && (record.domains ?? []).includes(filter));
    const filterLabel = domainById(filter)?.label ?? filter;
    const reason = hasDomainEvidence
      ? "Tastemake could not find another eligible catalog match from your current evidence."
      : `You haven't rated any ${filterLabel} yet, so Tastemake has nothing to base ${filterLabel} picks on. Try Browse or Search to react to a few first.`;
    return { source: "catalog", reason, picks: [], meta: { paidCallMade: false, exhausted: true, catalogCandidates: retrieved.length } };
  }
  // QA sweep real bug: every downstream use of ctx (the prompt payload, the prompt-size log, and
  // validatePicks' "itemId must come from candidates" check) read ctx.candidates directly -- the full,
  // unsliced eligible pool (up to retrieveCatalogCandidates' limit of 30) -- not the 6 the product
  // actually intends to offer. The model was shown and could validly pick from all 30+, which would
  // then pass validation (candidates.has(p.itemId) checked the same unsliced ctx.candidates) even
  // though every other part of this function (fallbackPayload, the exhaustion check above,
  // clientPicks' rank/fit) only ever expects the first 6 to have been offered. promptCtx is the same
  // context with candidates capped to the actual offered set, used everywhere the model's answer is
  // built or checked.
  const promptCtx = { ...ctx, candidates };
  const offeredDomains = {};
  for (const candidate of candidates) {
    for (const domain of candidate.domains ?? []) offeredDomains[domain] = (offeredDomains[domain] ?? 0) + 1;
  }
  logStage("candidateDomains", 0, { domains: offeredDomains });

  const config = liveConfig(env);
  if (!config.enabled) return fallbackPayload(candidates, state, "live AI is not enabled", { catalogCandidates: retrieved.length }, ctx.candidates);
  const recommendationModel = env.TASTEMAKE_RECOMMENDATIONS_MODEL || "claude-sonnet-5-5";
  const recommendationEffort = env.TASTEMAKE_RECOMMENDATIONS_EFFORT || "low";

  try {
    const prompt = buildPickPrompt(promptCtx, candidates.length);
    // #120 follow-up: known even if the call below errors/times out, so a large prompt isn't ruled
    // out as a cause just because we never got a usage.input_tokens back for a failed call.
    console.info("[tastemake-recommendations-timing]", JSON.stringify({
      stage: "promptSize",
      ...promptSizeBreakdown(promptCtx, candidates.length, prompt)
    }));
    started = Date.now();
    const model = await callAnthropic({ prompt, env, fetchImpl, model: recommendationModel, effort: recommendationEffort, thinkingMode: "between_tools", outputSchema: PICKS_OUTPUT_SCHEMA });
    const liveAiMs = Date.now() - started;
    const aiMetric = {
      operation: "recommendations",
      model: model.model,
      durationMs: liveAiMs,
      inputTokens: model.usage?.input_tokens ?? null,
      outputTokens: model.usage?.output_tokens ?? null,
      cacheReadTokens: model.usage?.cache_read_input_tokens ?? null,
      cacheWriteTokens: model.usage?.cache_creation_input_tokens ?? null
    };
    // The live-AI call itself is the dominant cost in every measured production request (~85-95% of
    // total time). Logging real token counts (not just wall-clock ms) so a large prompt/context can
    // be told apart from "that's just how long this call takes" without guessing.
    logStage("liveAiCall", liveAiMs, {
      model: aiMetric.model,
      inputTokens: aiMetric.inputTokens,
      outputTokens: aiMetric.outputTokens,
      cacheReadTokens: aiMetric.cacheReadTokens,
      cacheWriteTokens: aiMetric.cacheWriteTokens
    });

    started = Date.now();
    const normalizedModel = normalizeModelPicks(model.json);
    const validated = validatePicks(normalizedModel, promptCtx);
    // #120/QA-sweep follow-up (Paige's explicit call, 2026-09-28): this used to require every
    // candidate offered (up to 6) to individually pass validation, or the whole batch fell back to
    // catalog picks -- one flawed pick discarded five good ones, and #148's logging confirmed this
    // was the dominant real cause of fallback. Accepting any valid subset (minAccepted: 1, the
    // acceptOrFallback default) means a user sees however many real, validated live-AI picks
    // actually passed -- sometimes fewer than 6 -- instead of silently losing all of them to one
    // bad pick. Logging the validator's own rule-violation strings (static rule descriptions from
    // validate.js, never the model's actual pick text or itemId) for whatever still gets rejected.
    const result = acceptOrFallback(validated, candidates);
    logStage("validation", Date.now() - started, {
      accepted: result.source === "model",
      acceptedCount: validated.accepted?.length ?? 0,
      rejectedCount: validated.rejected?.length ?? 0,
      rejectionReasons: (validated.rejected ?? []).flatMap((entry) => entry.reasons)
    });

    if (result.source !== "model") {
      // A paid provider call succeeded, but the model output did not meet Tastemake's product
      // contract. Count this separately from transport/model failures so Project Health can show
      // a true fallback rate.
      recordAiCallInBackground({ ...aiMetric, outcome: "validation_fallback" }, { env });
      return fallbackPayload(candidates, state, result.reason || "model output did not pass validation", {
        model: model.model,
        usage: model.usage,
        paidCallMade: true,
        catalogCandidates: retrieved.length
      }, ctx.candidates);
    }
    recordAiCallInBackground({ ...aiMetric, outcome: "success" }, { env });
    const picks = clientPicks(result.items);
    // Real report (2026-09-28): "after a few rounds I'm getting mostly books now" -- the domain-spread
    // nudge (#153) only shapes what the model is told to do; nothing has ever logged what it actually
    // picked. Sanitized domain counts only (never titles/ids), so a real skew is visible without
    // guessing, the same way rejectionReasons logging (#148) turned "tests a pattern..." from a guess
    // into a confirmed, fixable cause.
    logStage("picksDomains", 0, { domains: picks.reduce((counts, p) => { for (const d of p.domains ?? []) counts[d] = (counts[d] ?? 0) + 1; return counts; }, {}) });
    return {
      source: "model",
      reason: null,
      picks,
      meta: { model: model.model, usage: model.usage, rejected: result.rejected ?? 0, paidCallMade: true, catalogCandidates: retrieved.length }
    };
  } catch (error) {
    const timedOut = error?.name === "AbortError";
    const budgetPaused = isAiBudgetExhausted(error);
    const reason = budgetPaused ? AI_BUDGET_MESSAGE : timedOut ? "model request timed out" : "model unavailable";
    const durationMs = Math.max(1, Date.now() - started);
    recordAiCallInBackground({
      operation: "recommendations",
      outcome: aiOutcomeForError(error),
      model: error?.model ?? recommendationModel,
      durationMs,
      inputTokens: error?.usage?.input_tokens ?? null,
      outputTokens: error?.usage?.output_tokens ?? null,
      cacheReadTokens: error?.usage?.cache_read_input_tokens ?? null,
      cacheWriteTokens: error?.usage?.cache_creation_input_tokens ?? null
    }, { env });
    console.error("[tastemake-ai]", reason, error?.status ?? "", error?.anthropicType ?? "", error?.anthropicDetail ?? error?.message ?? "");
    return fallbackPayload(candidates, state, reason, {
      ...(budgetPaused ? { budgetPaused: true } : {}),
      paidCallMade: Boolean(error?.paidCallMade),
      errorStatus: error?.status ?? null,
      errorType: error?.anthropicType ?? (timedOut ? "timeout" : "transport"),
      catalogCandidates: retrieved.length
    }, ctx.candidates);
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("allow", "POST");
    return res.status(405).json({ error: "POST required" });
  }
  const contentLength = Number(req.headers?.["content-length"] || 0);
  // Real bug, recurred three times: the wire payload grew unbounded until it silently 413'd, and
  // every time this was only ever discovered from a live user report ("stuck on the same picks"),
  // never from the logs -- nothing logged the size until it was already failing. Logging it on every
  // request (rejected or not) means the next time trimming falls behind real usage again, it shows up
  // as a rising number in [tastemake-recommendations-payload] well before any user hits a 413.
  console.info("[tastemake-recommendations-payload]", JSON.stringify({ bytes: contentLength, capBytes: MAX_BODY_BYTES, pctOfCap: contentLength ? Math.round((contentLength / MAX_BODY_BYTES) * 100) : null }));
  if (contentLength > MAX_BODY_BYTES) return res.status(413).json({ error: "request too large" });
  // On Vercel, reading req.body throws when the JSON is invalid, so that read is inside the try too (Oct 24).
  let raw;
  try { raw = req.body; } catch { return res.status(400).json({ error: "invalid request" }); }
  if (typeof raw === "string" && Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) return res.status(413).json({ error: "request too large" });
  let body;
  try { body = parseBody(raw); } catch { return res.status(400).json({ error: "invalid request" }); }
  const warm = body?.warm === true;
  // A warm request makes no model call, so it has its own bucket and never uses up the visitor's
  // live-AI allowance; it still has one, since it does make provider calls.
  if (!underBestEffortRateLimit(`${warm ? "warm:" : ""}${clientIp(req)}`)) return res.status(429).json({ error: "too many requests" });

  try {
    if (Buffer.byteLength(JSON.stringify(body), "utf8") > MAX_BODY_BYTES) return res.status(413).json({ error: "request too large" });
    if (!body.state || typeof body.state !== "object") return res.status(400).json({ error: "state is required" });
    if (warm) {
      res.setHeader("cache-control", "no-store");
      return res.status(200).json(await warmRecommendationCandidates({ rawState: body.state }));
    }
    const started = Date.now();
    const payload = await produceRecommendations({ rawState: body.state });
    payload.picks = await applyTaglineFallback(payload.picks);
    console.info("[tastemake-recommendations]", JSON.stringify({
      ms: Date.now() - started,
      source: payload.source,
      picks: payload.picks?.length ?? 0,
      candidates: payload.meta?.catalogCandidates ?? null,
      paidCallMade: Boolean(payload.meta?.paidCallMade),
      errorType: payload.meta?.errorType ?? null,
      feedbackCount: Object.keys(body.state.feedbackByRecommendation ?? {}).length,
      seenItemCount: body.state.seenItemIds?.length ?? 0,
      customItemsCount: Object.keys(body.state.customItems ?? {}).length
    }));
    res.setHeader("cache-control", "no-store");
    return res.status(200).json(payload);
  } catch {
    return res.status(400).json({ error: "invalid request" });
  }
}
