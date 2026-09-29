import { aggregateAiMetrics } from "../src/server/ai-metrics.mjs";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("allow", "GET");
    return res.status(405).json({ error: "GET required" });
  }
  try {
    const metrics = await aggregateAiMetrics({ days: 30 });
    res.setHeader("Cache-Control", "s-maxage=120, stale-while-revalidate=600");
    return res.status(200).json(metrics);
  } catch (error) {
    console.info("[tastemake-ai-metrics]", JSON.stringify({ error: error?.message || "aggregate failed" }));
    return res.status(200).json({ configured: true, available: false, reason: "AI telemetry temporarily unavailable", privacy: { content_included: false } });
  }
}
