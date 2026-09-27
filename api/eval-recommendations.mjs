import { liveConfig, produceRecommendations } from "./recommendations.mjs";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST required" });
  const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body ?? {});
  if (!body.state || typeof body.state !== "object") return res.status(400).json({ error: "state is required" });

  const env = {
    ...process.env,
    TASTEMAKE_AI_ENABLED: "1",
    TASTEMAKE_AI_RATE_LIMIT_CONFIRMED: "1",
    TASTEMAKE_AI_SPEND_CAP_CONFIRMED: "1",
    TASTEMAKE_AI_MODEL: process.env.TASTEMAKE_AI_MODEL || "claude-sonnet-5"
  };
  const config = liveConfig(env);
  const payload = await produceRecommendations({ rawState: body.state, env });
  return res.status(200).json({
    ...payload,
    _eval: {
      enabled: config.enabled,
      reasons: config.reasons,
      hasKey: Boolean(env.ANTHROPIC_API_KEY),
      model: env.TASTEMAKE_AI_MODEL
    }
  });
}
