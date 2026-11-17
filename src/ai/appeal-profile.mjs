// #382 (Nov 17, Paige: "Build store, switch off"): appeal profiles for catalog titles -- what a title is
// like to experience and why people enjoy it, as short phrases. Server-side only (api/recommendations.mjs
// via src/server/appeal-store.mjs). Nothing reads the profiles yet: a later, separately approved change
// may score the shortlist with them (docs/proposals/recommendation-improvement-plan.md, U14).
//
// The prompt, schema and input shape are copied verbatim from the research run that ordered Paige's
// want-vs-no at 0.84 on the held-out set (K1 "P" arm). Changing any of them means a new
// APPEAL_PROMPT_VERSION and a new check, not an edit in place.
//
// Only catalog facts go into the prompt (title, medium, year, creator, genres, synopsis or subjects),
// never anything about a person. The model's answer is checked in code (validateAppealProfile); a profile
// that fails is never stored.

import { callAnthropic } from "../server/anthropic.mjs";
import { safeAbout } from "../catalog/synopsis.mjs";

export const APPEAL_PROMPT_VERSION = "ap-v1-2026-11-04";
export const DEFAULT_APPEAL_MODEL = "claude-haiku-5-5";

const str = { type: "string" };
const strs = { type: "array", items: str };
export const PROFILE_SCHEMA = {
  type: "object",
  properties: {
    summary: str,
    tone: strs,
    pleasures: strs,
    setting: strs,
    format: strs,
    audience: str,
    notFor: str,
    confidence: { type: "string", enum: ["high", "medium", "low"] }
  },
  required: ["summary", "tone", "pleasures", "setting", "format", "audience", "notFor", "confidence"],
  additionalProperties: false
};

export const APPEAL_INSTRUCTIONS = "You write appeal profiles for a recommendation system. Describe what experiencing this title is actually like and why people enjoy it, in short specific phrases (at most 8 words each, at most 5 per list; summary at most 35 words): tone and mood, the main pleasures it offers, setting, format and structure, who tends to love it, and who tends not to. Be concrete and distinguishing: say what sets it apart from other titles in its genre, not what every title in the genre has. Use the information given and your own knowledge of the title; if you don't recognize the title, rely only on the given information and set confidence to low. Never invent plot facts.";

const MEDIUM_BY_DOMAIN = { movies: "film", tv: "TV series", read: "book", play: "video game" };
const DOMAIN_BY_TYPE = { movie: "movies", tv: "tv", book: "read", game: "play" };

export function appealDomain(item) {
  const domain = item?.domains?.[0] ?? DOMAIN_BY_TYPE[item?.type] ?? null;
  return MEDIUM_BY_DOMAIN[domain] ? domain : null;
}

// A title the research input shape can describe: a catalog item (provider identity, not something the
// person added by hand) in one of the four media. Films, TV and games also need a synopsis -- the research
// profiles always had one, and rated items arrive without it (src/ai/live-client.js drops `about` from the
// wire), so a profile made from "(none)" would be a weaker input cached under the same prompt version.
export function canProfile(item) {
  if (!item?.id || !item.provider || !item.providerId || item.custom) return false;
  const domain = appealDomain(item);
  if (!domain) return false;
  if (domain === "read") return true;
  return Boolean(String(item.about ?? "").trim());
}

function description(item, domain) {
  if (domain === "read") {
    return `Subjects: ${(item.genres ?? []).filter((g) => !/^fiction$/i.test(g)).slice(0, 10).join("; ")}`;
  }
  return `Synopsis: ${String(item.about ?? "").trim() ? safeAbout(item) : "(none)"}`;
}

export function appealInput(item) {
  const domain = appealDomain(item);
  return {
    title: item.title,
    medium: MEDIUM_BY_DOMAIN[domain],
    year: item.year ?? null,
    creator: item.by ?? null,
    genres: domain === "read" ? [] : (item.genres ?? []).slice(0, 8),
    description: description(item, domain)
  };
}

export function buildAppealPrompt(item) {
  return `${APPEAL_INSTRUCTIONS}\n\nCONTEXT\n${JSON.stringify(appealInput(item))}`;
}

// ---- output check ---------------------------------------------------------------------------------------
const LIST_FIELDS = ["tone", "pleasures", "setting", "format"];
const TEXT_LIMITS = { summary: 400, audience: 200, notFor: 200 };
const ITEM_MAX = 80;
const CONFIDENCE = new Set(["high", "medium", "low"]);
// A profile describes a title in plain phrases. Links, markup or braces mean the model carried something
// over (for example from a synopsis) that has no place in it.
const UNSAFE = /https?:|www\.|<|\{/i;

function cleanText(value, max) {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text || text.length > max || UNSAFE.test(text)) return null;
  return text;
}

export function validateAppealProfile(json) {
  if (!json || typeof json !== "object" || Array.isArray(json)) return null;
  const profile = {};
  for (const [field, max] of Object.entries(TEXT_LIMITS)) {
    const text = cleanText(json[field], max);
    if (text == null) return null;
    profile[field] = text;
  }
  for (const field of LIST_FIELDS) {
    const list = json[field];
    if (!Array.isArray(list) || list.length < 1 || list.length > 5) return null;
    const cleaned = list.map((entry) => cleanText(entry, ITEM_MAX));
    if (cleaned.some((entry) => entry == null)) return null;
    profile[field] = cleaned;
  }
  if (!CONFIDENCE.has(json.confidence)) return null;
  profile.confidence = json.confidence;
  return {
    summary: profile.summary,
    tone: profile.tone,
    pleasures: profile.pleasures,
    setting: profile.setting,
    format: profile.format,
    audience: profile.audience,
    notFor: profile.notFor,
    confidence: profile.confidence
  };
}

// One paid call. Returns callAnthropic's { json, usage, model } plus `profile` (null when the answer failed
// the check). Throws what callAnthropic throws; the caller records the outcome.
export async function generateAppealProfile(item, { env = process.env, fetchImpl = fetch, timeoutMs = null } = {}) {
  const model = env.TASTEMAKE_APPEAL_MODEL || DEFAULT_APPEAL_MODEL;
  // callAnthropic reads its timeout from env; a background profile gets its own, shorter one.
  const callEnv = timeoutMs ? { ...env, TASTEMAKE_AI_TIMEOUT_MS: String(timeoutMs) } : env;
  const result = await callAnthropic({
    prompt: buildAppealPrompt(item),
    env: callEnv,
    fetchImpl,
    model,
    effort: "low",
    thinkingMode: "between_tools",
    outputSchema: PROFILE_SCHEMA,
    maxTokens: 900
  });
  return { ...result, profile: validateAppealProfile(result.json) };
}
