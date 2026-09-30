import { esc } from "../lib/html.js";

export function renderArtwork(item, className = "item-artwork") {
  if (!item?.artwork) {
    const type = ["book", "movie", "tv", "game"].includes(item?.type) ? item.type : "item";
    const meta = [item?.year, item?.by].filter(Boolean).join(" · ");
    return `<span class="${className} artwork-fallback artwork-fallback-${type}" aria-hidden="true">
      <span class="artwork-fallback-type">${esc(type === "tv" ? "TV" : type.toUpperCase())}</span>
      <strong class="artwork-fallback-title">${esc(item?.title || "Cover unavailable")}</strong>
      ${meta ? `<span class="artwork-fallback-meta">${esc(meta)}</span>` : ""}
    </span>`;
  }
  return `<span class="${className}"><img src="${esc(item.artwork)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" /></span>`;
}
