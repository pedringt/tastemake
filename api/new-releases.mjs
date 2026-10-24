import { Buffer } from "node:buffer";
import { newReleasesFor } from "../src/catalog/new-releases.mjs";
import { hydrateState } from "../src/server/request-state.mjs";

// #6: "New this week for you" (src/catalog/new-releases.mjs). No model call: release lists come from TMDb
// and IGDB (cached per area, country and day) and are matched to the visitor's own evidence here.
const MAX_BODY_BYTES = 160_000;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("allow", "POST");
    return res.status(405).json({ error: "POST required" });
  }
  if (Number(req.headers?.["content-length"] || 0) > MAX_BODY_BYTES) return res.status(413).json({ error: "request too large" });
  if (typeof req.body === "string" && Buffer.byteLength(req.body, "utf8") > MAX_BODY_BYTES) return res.status(413).json({ error: "request too large" });
  let body;
  try {
    body = req.body && typeof req.body === "object" ? req.body : JSON.parse(req.body || "{}");
  } catch {
    return res.status(400).json({ error: "invalid request" });
  }
  if (!body?.state || typeof body.state !== "object") return res.status(400).json({ error: "state is required" });

  res.setHeader("cache-control", "no-store");
  try {
    const result = await newReleasesFor(hydrateState(body.state), { region: String(body.region ?? "US").toUpperCase() });
    return res.status(200).json(result);
  } catch {
    return res.status(200).json({ items: [] });
  }
}
