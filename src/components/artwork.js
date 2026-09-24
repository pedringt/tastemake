import { esc } from "../lib/html.js";

export function renderArtwork(item, className = "item-artwork") {
  if (!item?.artwork) return `<span class="${className} artwork-fallback" aria-hidden="true"><span>${esc((item?.title || "?").slice(0, 1).toUpperCase())}</span></span>`;
  return `<span class="${className}"><img src="${esc(item.artwork)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" /></span>`;
}
