import { liveConfig } from "./recommendations.mjs";

export default function handler(req, res) {
  const config = liveConfig(process.env);
  return res.status(200).json({
    enabled: config.enabled,
    reasons: config.reasons,
    hasKey: Boolean(process.env.ANTHROPIC_API_KEY),
    hasModel: Boolean(process.env.TASTEMAKE_AI_MODEL),
    vercelEnv: process.env.VERCEL_ENV ?? null
  });
}
