// #341 step 4 (Design A): record one retrieval run for a bundled evaluation profile, on a protected
// preview only. Lives on the eval/step4-capture branch and is never merged; using it needs Paige's
// approval of the preview, the request cap and the capture window. See scripts/evals/capture/.
// Guards: refuses outside a Vercel preview; accepts only approved, bundled profiles (no state from the
// request); needs an explicit maxRequests (no default, at most 200); one capture at a time (Math.random
// is captured globally); refuses to return anything that looks like a credential.
import { captureRetrieval } from "../scripts/evals/capture/recorder.mjs";
import { usableProfile } from "../scripts/evals/capture/profiles.mjs";
import { findSecrets } from "../scripts/evals/capture/redact.mjs";
import { query as storeQuery } from "../src/server/db.mjs";

const MAX_REQUESTS_CEILING = 200;

export function createHandler({ env = process.env, capture = captureRetrieval, realQuery = (text, params) => storeQuery(text, params, { env }) } = {}) {
  let busy = false;
  return async function handler(req, res) {
    res.setHeader("cache-control", "no-store");
    if (env.VERCEL_ENV !== "preview") return res.status(404).json({ error: "not found" });
    if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
    let body;
    try { body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body ?? {}; } catch { return res.status(400).json({ error: "invalid JSON" }); }
    const profile = usableProfile(String(body.profileId ?? ""));
    if (!profile) return res.status(400).json({ error: "profileId must be an approved, bundled evaluation profile" });
    const round = Number(body.round);
    const maxRequests = Number(body.maxRequests);
    if (!Number.isInteger(round) || round < 1 || round > 10) return res.status(400).json({ error: "round must be 1-10" });
    if (!Number.isInteger(maxRequests) || maxRequests < 1 || maxRequests > MAX_REQUESTS_CEILING) return res.status(400).json({ error: `maxRequests is required (1-${MAX_REQUESTS_CEILING}); there is no default` });
    if (busy) return res.status(409).json({ error: "a capture is already running" });
    busy = true;
    try {
      const recording = await capture({ profile, round, maxRequests, env, realQuery: env.TASTEMAKE_DATABASE_URL ? realQuery : null, commit: env.VERCEL_GIT_COMMIT_SHA ?? null });
      const text = JSON.stringify(recording);
      const secrets = findSecrets(text, env);
      if (secrets.length) return res.status(500).json({ error: "the recording contained credential-like content, so it wasn't returned", count: secrets.length });
      res.setHeader("content-type", "application/json");
      return res.status(200).send(text);
    } catch (error) {
      const detail = String(error?.message ?? error).slice(0, 200);
      return res.status(500).json({ error: "capture failed", ...(findSecrets(detail, env).length ? {} : { detail }) });
    } finally {
      busy = false;
    }
  };
}

export default createHandler();
