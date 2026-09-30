import { Buffer } from "node:buffer";
import { buildContext } from "../src/ai/context.js";
import { acceptOrFallback, validatePicks } from "../src/ai/validate.js";
import { retrieveCatalogCandidates } from "../src/catalog/related.mjs";
import { sanitizeRecommendationCopy } from "../src/lib/recommendation-copy.js";
import { aiOutcomeForError, recordAiCallInBackground } from "../src/server/ai-metrics.mjs";
import { domainById } from "../src/data/domains.js";

const MAX_BODY_BYTES = 160_000;
const MAX_OUTPUT_TOKENS = 2000;   // the cap has to cover any thinking tokens as well as the JSON itself
const REQUEST_TIMEOUT_MS = 25_000;   // 12s was tripping on every real call; the function allows 30s
const DEFAULT_VISITOR_LIMIT = 6;
const DEFAULT_WINDOW_MS = 60_000;
const MAX_PROMPT_EVIDENCE = 18;
const rateBuckets = globalThis.__tastemakeAiRateBuckets ??= new Map();

function parseBody(req) {
  const body = req.body;
  if (body && typeof body === "object") return body;
  if (typeof body === "string") return JSON.parse(body);
  return {};
}

// Exported so api/hypotheses.mjs can share this instead of maintaining its own hand-copied version
// (QA sweep finding: the two had already drifted -- hypotheses.mjs's copy was missing blindSpots,
// blindSpotDrafts, and recommendationFilter, silently defaulting them wherever a reader happened to
// tolerate a missing field instead of visibly breaking).
export function hydrateState(raw = {}) {
  return {
    ...raw,
    selectedFavorites: new Set(raw.selectedFavorites ?? []),
    libraryFavorites: new Set(raw.libraryFavorites ?? []),
    blindSpotDismissed: new Set(raw.blindSpotDismissed ?? []),
    feedbackByRecommendation: raw.feedbackByRecommendation ?? {},
    recommendationSets: Array.isArray(raw.recommendationSets) ? raw.recommendationSets : [],
    seenItemIds: Array.isArray(raw.seenItemIds) ? raw.seenItemIds : [],
    customItems: raw.customItems ?? {},
    blindSpots: raw.blindSpots ?? {},
    blindSpotDrafts: raw.blindSpotDrafts ?? {},
    patternStatements: raw.patternStatements ?? [],
    areas: raw.areas ?? {},
    curveball: raw.curveball !== false,
    recommendationFilter: raw.recommendationFilter ?? "all"
  };
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

export function liveConfig(env = process.env) {
  const reasons = [];
  if (env.TASTEMAKE_AI_ENABLED !== "1") reasons.push("off-switch");
  if (!env.ANTHROPIC_API_KEY) reasons.push("missing-key");
  if (!env.TASTEMAKE_AI_MODEL) reasons.push("missing-model");
  if (env.TASTEMAKE_AI_RATE_LIMIT_CONFIRMED !== "1") reasons.push("rate-limit-not-confirmed");
  if (env.TASTEMAKE_AI_SPEND_CAP_CONFIRMED !== "1") reasons.push("spend-cap-not-confirmed");
  // Main auto-deploys publicly. A production deployment needs its own explicit gate so merely
  // having the API key and test flags present cannot turn on paid calls for public traffic.
  if (env.VERCEL_ENV === "production" && env.TASTEMAKE_AI_PRODUCTION_APPROVED !== "1") reasons.push("production-live-not-approved");
  return { enabled: reasons.length === 0, reasons, model: env.TASTEMAKE_AI_MODEL || null };
}

function compactEvidenceRecord(record) {
  return {
    ref: record.ref,
    title: record.title,
    type: record.type ?? null,
    domains: record.domains ?? [],
    kind: record.kind,
    polarity: record.polarity,
    refinements: record.refinements ?? []
  };
}

function promptEvidencePriority(record) {
  if (record.kind === "experienced-favorite" || record.kind === "starter-favorite") return 4;
  if (record.kind === "experienced-strong-positive") return 3;
  if (record.kind === "experienced-negative") return 2;
  if (record.kind === "experienced-positive") return 1;
  return 0;
}

// #120: the full product history remains in state and in the validator context. The model does not need
// every historical row on every ranking call. Curate a small experienced-evidence working set by the
// domains represented in the current candidate pool, keeping strong anchors and counterexamples.
export function selectPromptEvidence(ctx, limit = MAX_PROMPT_EVIDENCE) {
  const all = (ctx.evidence ?? []).filter((record) => record?.class === "experienced");
  const candidateDomains = [...new Set((ctx.candidates ?? []).flatMap((item) => item.domains ?? []))];
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
  const ranked = (records) => records
    .map((record, index) => ({ record, index }))
    .sort((a, b) => promptEvidencePriority(b.record) - promptEvidencePriority(a.record) || b.record.weight - a.record.weight || a.index - b.index)
    .map(({ record }) => record);
  const rotate = (records, offset = 0) => {
    if (!records.length) return records;
    const at = Math.abs(offset) % records.length;
    return records.slice(at).concat(records.slice(0, at));
  };
  const rotation = Number(ctx.evidenceRotation ?? 0);

  // Positive evidence should do most of the explanatory work. Keep one negative counterexample per
  // represented domain, and rotate which one is shown as the user moves through recommendation rounds
  // so one memorable dislike does not become a permanent center of gravity.
  for (const domain of candidateDomains) {
    const rows = pool.filter((record) => (record.domains ?? []).includes(domain));
    ranked(rows.filter((record) => record.polarity > 0)).slice(0, 4).forEach(add);
    const negatives = rotate(ranked(rows.filter((record) => record.polarity < 0)), rotation);
    add(negatives[0]);
  }

  // Fill remaining room with positives first. Negatives stay useful as contrast, but are not used
  // simply to fill prompt capacity.
  ranked(pool.filter((record) => record.polarity > 0)).forEach(add);
  return selected.slice(0, limit);
}

function pickPromptPayload(ctx) {
  return {
    evidence: selectPromptEvidence(ctx).map(compactEvidenceRecord),
    candidates: ctx.candidates.map(({ id, title, type, domains, about, hypotheses, provider, providerId, year, genres }) => ({ id, title, type, domains, about, hypotheses, provider, providerId, year, genres })),
    curveball: ctx.curveball,
    statements: ctx.statements,
    contexts: ctx.contexts
  };
}

function pickPromptInstructions(count, { recommendationFilter = "all" } = {}) {
  return [
    "You are the recommendation interpreter inside Tastemake.",
    "The product, not you, decides what is evidence, which candidates are eligible, and what state may change.",
    `Choose exactly ${count} items from candidates and return JSON only in this shape: {"picks":[{"itemId":"...","why":"...","cites":["ev:..."],"tests":null,"kind":"pick"}]}.`,
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
    "User-facing explanations must say why the pick may fit the person, not how retrieval found it. Never mention providers, catalog branches/paths/neighbors/signals, metadata, similarity scores, embeddings, retrieval provenance, or raw overlap counts. A disliked item may only appear as explicit contrast, never as the positive reason a pick fits.",
    "An evidence row may include refinements: explicit reasons the user said that specific item worked or did not work. Use them as item-local context, not as standalone evidence or a global preference unless multiple independent experienced items support that broader pattern.",
    "Rules: itemId must come from candidates; every why must cite at least one experienced evidence ref; the evidence list has already been limited by software to relevant experienced signals; today's real catalog candidates carry no attached hypothesis ids at all, so tests must always be null -- never invent or reuse a hypothesis id from elsewhere in this context, since it will not be attached to the candidate and will fail; never use a tests pattern the user marked not-me; never contradict a user-confirmed pattern statement; treat says=partial as narrow/conditional and honor its context or excludedDomains; says=unsure is not a confirmed preference; never describe one global identity/aesthetic; never use circular reasons like 'matches your taste'; at most one curveball, and none when curveball is false; explain what the pick tests in specific plain English, in one sentence of 25 words or fewer; internal refs such as ev:... belong only in cites and must never appear in why; never expose provider ids or other internal identifiers in why; call a pick a curveball, in kind or in why, only for that one exploratory pick, and set kind to \"curveball\" whenever why calls it one — every other pick keeps kind \"pick\" and its why should not describe itself as a curveball.",
    "Respond with the JSON object only — the very first character of your reply must be { and the very last must be }. No markdown fences, no preamble like \"Looking at...\", no commentary before or after the JSON."
  ].join("\n\n");
}

export function buildPickPrompt(ctx, count) {
  return [pickPromptInstructions(count, { recommendationFilter: ctx.recommendationFilter }), `CONTEXT\n${JSON.stringify(pickPromptPayload(ctx))}`].join("\n\n");
}

// #28: about 60% of live calls were falling back to deterministic not because the model's answer was
// bad, but because it prefixed the JSON with prose ("Looking at your evidence...") despite the prompt's
// instruction, and this only stripped markdown fences. Tightened the prompt above; this also extracts
// the first {...} object as a fallback, so a model that still adds stray text isn't discarded outright.
function repairMissingArrayCommas(text) {
  let out = "";
  let inString = false;
  let escaped = false;
  const stack = [];
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    out += ch;
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === "{" || ch === "[") { stack.push(ch); continue; }
    if (ch !== "}" && ch !== "]") continue;
    stack.pop();
    if (stack[stack.length - 1] !== "[") continue;
    let j = i + 1;
    while (j < text.length && /\s/.test(text[j])) j += 1;
    if (text[j] === "{" || text[j] === "[") out += ",";
  }
  return out;
}

export function parseModelJson(text) {
  const cleaned = String(text || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  const objectStart = cleaned.indexOf("{");
  const objectEnd = cleaned.lastIndexOf("}");
  const candidates = [cleaned];
  if (objectStart !== -1 && objectEnd !== -1 && objectEnd > objectStart && (objectStart > 0 || objectEnd < cleaned.length - 1)) {
    candidates.push(cleaned.slice(objectStart, objectEnd + 1));
  }

  let firstError = null;
  for (const candidate of candidates) {
    try { return JSON.parse(candidate); }
    catch (error) {
      firstError ??= error;
      const repaired = repairMissingArrayCommas(candidate);
      if (repaired !== candidate) {
        try { return JSON.parse(repaired); } catch { /* keep the original parse failure */ }
      }
    }
  }
  throw firstError ?? new SyntaxError("model response was not JSON");
}

export async function callAnthropic({ prompt, env = process.env, fetchImpl = fetch, maxTokens = null }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number(env.TASTEMAKE_AI_TIMEOUT_MS || REQUEST_TIMEOUT_MS));
  try {
    const response = await fetchImpl("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: env.TASTEMAKE_AI_MODEL,
        // This is a short, strict JSON job. With thinking on by default, the model spent the whole budget
        // thinking and returned no text at all (stop_reason=max_tokens, blocks=thinking).
        // Set TASTEMAKE_AI_THINKING=enabled to turn it back on, with a much larger cap.
        ...(env.TASTEMAKE_AI_THINKING === "enabled" ? {} : { thinking: { type: "disabled" } }),
        max_tokens: Number(maxTokens ?? env.TASTEMAKE_AI_MAX_TOKENS ?? MAX_OUTPUT_TOKENS),
        // No `temperature`: newer models reject it ("temperature is deprecated for this model"), which
        // failed every live call with 400 invalid_request_error. Runs are therefore not bit-identical;
        // eval comparisons allow for that (docs/ai-evals.md).
        messages: [{ role: "user", content: prompt }]
      }),
      signal: controller.signal
    });
    if (!response.ok) {
      // Surface why, without ever echoing the key or the full body: status plus Anthropic's own error type.
      let type = "unknown";
      let detail = "";
      try { const body = await response.json(); type = body?.error?.type ?? "unknown"; detail = body?.error?.message ?? ""; } catch { /* body was not JSON */ }
      const err = new Error(`Anthropic returned ${response.status} (${type})`);
      err.status = response.status;
      err.anthropicType = type;
      err.anthropicDetail = detail;
      throw err;
    }
    let data;
    try {
      data = await response.json();
    } catch (err) {
      err.paidCallMade = true;
      err.model = env.TASTEMAKE_AI_MODEL;
      err.anthropicType = "malformed-response";
      throw err;
    }
    const text = data.content?.find((block) => block.type === "text")?.text;
    if (!text) {
      // Seen when the cap is spent before any text is produced: content holds no text block.
      const err = new Error(`Anthropic returned no text block (stop_reason ${data.stop_reason ?? "?"}, blocks: ${(data.content ?? []).map((b) => b.type).join(",") || "none"})`);
      err.anthropicType = "no-text-block";
      err.anthropicDetail = `stop_reason=${data.stop_reason ?? "?"} blocks=${(data.content ?? []).map((b) => b.type).join(",") || "none"} out_tokens=${data.usage?.output_tokens ?? "?"}`;
      err.paidCallMade = true;
      err.model = data.model ?? env.TASTEMAKE_AI_MODEL;
      err.usage = data.usage ?? null;
      throw err;
    }
    try {
      return { json: parseModelJson(text), usage: data.usage ?? null, model: data.model ?? env.TASTEMAKE_AI_MODEL };
    } catch (err) {
      // The provider already returned a successful model response, so this was a paid call even if
      // Tastemake cannot parse the model's text into valid JSON.
      err.paidCallMade = true;
      err.model = data.model ?? env.TASTEMAKE_AI_MODEL;
      err.usage = data.usage ?? null;
      err.anthropicType = "malformed-response";
      throw err;
    }
  } finally {
    clearTimeout(timer);
  }
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
function catalogFallbackReason(item, index) {
  const source = item.relatedTo || null;
  const genre = (item.genres ?? []).find((value) => typeof value === "string" && value.trim() && !/^\d+$/.test(value));
  const sourceCopy = source ? ` because you liked ${source}` : "";
  const reasons = [
    () => genre ? `${item.title} may be worth trying${sourceCopy}; it also shares some ${genre.toLowerCase()} territory.` : `${item.title} may be worth trying${sourceCopy}.`,
    () => source ? `Because ${source} worked for you, Tastemake is testing ${item.title} as another possible fit.` : `${item.title} is a related pick Tastemake thinks is worth testing.`,
    () => genre ? `This is a ${genre.toLowerCase()}-leaning pick that may connect with things you've liked.` : `This is a related pick based on things you've liked before.`,
    () => `${item.title} is a slightly more exploratory pick, but it still connects back to things you've liked.`,
    () => source ? `If some of what you liked about ${source} carries over, ${item.title} could be a good next try.` : `${item.title} is a cautious test outside your strongest patterns.`,
    () => source ? `Tastemake is trying ${item.title} as another possibility because you liked ${source}.` : `Tastemake is trying ${item.title} as another plausible fit.`
  ];
  return reasons[index % reasons.length]();
}

function catalogPicks(candidates, state) {
  const chosen = candidates.slice(0, 6);
  return chosen.map((item, index) => {
    const curveball = state.curveball !== false && chosen.length >= 6 && index === chosen.length - 1;
    const basis = catalogFallbackReason(item, index);
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

function fallbackPayload(candidates, state, reason, meta = {}) {
  return {
    source: "catalog",
    reason,
    picks: catalogPicks(candidates, state),
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

export async function produceRecommendations({ rawState, env = process.env, fetchImpl = fetch } = {}) {
  const state = hydrateState(rawState);

  let started = Date.now();
  const retrieved = await retrieveCatalogCandidates(state, { env, fetchImpl });
  logStage("candidateRetrieval", Date.now() - started, { candidates: retrieved.length });

  started = Date.now();
  const ctx = buildContext(state, retrieved);
  logStage("buildContext", Date.now() - started);

  const candidates = ctx.candidates.slice(0, 6);
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

  const config = liveConfig(env);
  if (!config.enabled) return fallbackPayload(candidates, state, "live AI is not enabled", { catalogCandidates: retrieved.length });

  try {
    const prompt = buildPickPrompt(promptCtx, candidates.length);
    // #120 follow-up: known even if the call below errors/times out, so a large prompt isn't ruled
    // out as a cause just because we never got a usage.input_tokens back for a failed call.
    console.info("[tastemake-recommendations-timing]", JSON.stringify({
      stage: "promptSize",
      ...promptSizeBreakdown(promptCtx, candidates.length, prompt)
    }));
    started = Date.now();
    const model = await callAnthropic({ prompt, env, fetchImpl });
    const liveAiMs = Date.now() - started;
    const aiMetric = {
      operation: "recommendations",
      model: model.model,
      durationMs: liveAiMs,
      inputTokens: model.usage?.input_tokens ?? null,
      outputTokens: model.usage?.output_tokens ?? null,
      cacheReadTokens: model.usage?.cache_read_input_tokens ?? null
    };
    // The live-AI call itself is the dominant cost in every measured production request (~85-95% of
    // total time). Logging real token counts (not just wall-clock ms) so a large prompt/context can
    // be told apart from "that's just how long this call takes" without guessing.
    logStage("liveAiCall", liveAiMs, {
      model: aiMetric.model,
      inputTokens: aiMetric.inputTokens,
      outputTokens: aiMetric.outputTokens,
      cacheReadTokens: aiMetric.cacheReadTokens
    });

    started = Date.now();
    const validated = validatePicks(model.json, promptCtx);
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
      });
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
    const reason = timedOut ? "model request timed out" : "model unavailable";
    const durationMs = Math.max(1, Date.now() - started);
    recordAiCallInBackground({
      operation: "recommendations",
      outcome: aiOutcomeForError(error),
      model: error?.model ?? config.model,
      durationMs,
      inputTokens: error?.usage?.input_tokens ?? null,
      outputTokens: error?.usage?.output_tokens ?? null,
      cacheReadTokens: error?.usage?.cache_read_input_tokens ?? null
    }, { env });
    console.error("[tastemake-ai]", reason, error?.status ?? "", error?.anthropicType ?? "", error?.anthropicDetail ?? error?.message ?? "");
    return fallbackPayload(candidates, state, reason, {
      paidCallMade: Boolean(error?.paidCallMade),
      errorStatus: error?.status ?? null,
      errorType: error?.anthropicType ?? (timedOut ? "timeout" : "transport"),
      catalogCandidates: retrieved.length
    });
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
  if (typeof req.body === "string" && Buffer.byteLength(req.body, "utf8") > MAX_BODY_BYTES) return res.status(413).json({ error: "request too large" });
  if (!underBestEffortRateLimit(clientIp(req))) return res.status(429).json({ error: "too many requests" });

  try {
    const body = parseBody(req);
    if (Buffer.byteLength(JSON.stringify(body), "utf8") > MAX_BODY_BYTES) return res.status(413).json({ error: "request too large" });
    if (!body.state || typeof body.state !== "object") return res.status(400).json({ error: "state is required" });
    const started = Date.now();
    const payload = await produceRecommendations({ rawState: body.state });
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
