import { searchCatalog } from "../src/catalog/providers.mjs";
import { typeById } from "../src/data/domains.js";

const normalize = (value) => String(value ?? "")
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, " ")
  .trim();

export function bestExactMatch(items, title, type, creator = "") {
  const wantedTitle = normalize(title);
  const wantedCreator = normalize(creator);
  const exact = (items ?? []).filter((item) => item?.type === type && normalize(item.title) === wantedTitle);
  if (!exact.length) return { status: "not_found", item: null };
  if (exact.length === 1) {
    if (!wantedCreator) return { status: "resolved", item: exact[0] };
    const candidateCreator = normalize(exact[0].by);
    if (!candidateCreator) return { status: "ambiguous", item: null };
    if (candidateCreator.includes(wantedCreator) || wantedCreator.includes(candidateCreator)) {
      return { status: "resolved", item: exact[0] };
    }
    return { status: "not_found", item: null };
  }

  if (wantedCreator) {
    const creatorMatches = exact.filter((item) => {
      const candidateCreator = normalize(item.by);
      return candidateCreator && (candidateCreator.includes(wantedCreator) || wantedCreator.includes(candidateCreator));
    });
    if (creatorMatches.length === 1) return { status: "resolved", item: creatorMatches[0] };
  }
  return { status: "ambiguous", item: null };
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("allow", "GET");
    return res.status(405).json({ error: "GET required" });
  }

  const title = String(req.query?.title ?? "").trim().slice(0, 120);
  const type = String(req.query?.type ?? "").trim();
  const creator = String(req.query?.creator ?? "").trim().slice(0, 120);
  const typeInfo = typeById(type);
  if (title.length < 2 || !typeInfo?.domain) return res.status(400).json({ error: "title and supported type are required" });

  try {
    const payload = await searchCatalog(title, { domain: typeInfo.domain });
    const match = bestExactMatch(payload.items, title, type, creator);
    res.setHeader("cache-control", "private, max-age=0, no-store");
    return res.status(200).json({
      status: match.status,
      item: match.item,
      degraded: Boolean(payload.degraded)
    });
  } catch {
    res.setHeader("cache-control", "private, max-age=0, no-store");
    return res.status(200).json({ status: "unavailable", item: null, degraded: true });
  }
}
