import { nodeLayout } from "../model/tastemap.js";
import { domainById } from "../data/domains.js";
import { esc } from "../lib/html.js";

function sharedEvidence(a, b) {
  const aRefs = new Set([...(a.supports ?? []), ...(a.counters ?? [])]);
  return [...(b.supports ?? []), ...(b.counters ?? [])].filter((ref) => aRefs.has(ref));
}

function sharedDomains(a, b) {
  const aDomains = new Set(a.domains ?? []);
  return (b.domains ?? []).filter((domain) => aDomains.has(domain));
}

function mapLinks(patterns) {
  const links = [];
  for (let i = 0; i < patterns.length; i += 1) {
    for (let j = i + 1; j < patterns.length; j += 1) {
      const evidence = sharedEvidence(patterns[i], patterns[j]);
      const domains = sharedDomains(patterns[i], patterns[j]);
      if (!evidence.length && !domains.length) continue;
      links.push({
        a: i,
        b: j,
        strength: evidence.length >= 2 ? "strong" : evidence.length === 1 ? "some" : "weak",
        score: evidence.length * 3 + domains.length
      });
    }
  }
  return links.sort((a, b) => b.score - a.score).slice(0, 18);
}

function domainLine(pattern) {
  const labels = (pattern.domains ?? []).map((id) => domainById(id)?.label ?? id);
  return labels.length ? labels.join(" · ") : "Still finding where this shows up";
}

export function renderTasteMap(patterns = []) {
  if (!patterns.length) return "";
  const visiblePatterns = patterns.slice(0, 8);

  const layout = nodeLayout(visiblePatterns.length);
  const links = mapLinks(visiblePatterns);
  const nodes = visiblePatterns.map((pattern, index) => {
    const status = String(pattern.strength ?? "Emerging");
    const note = pattern.status === "conditional" ? "Conditional" : "";
    return `
      <div class="taste-map-node look-${status.toLowerCase() === "strong" ? "firm" : "tentative"}"
        style="left:${layout[index].x}%;top:${layout[index].y}%">
        <b>${esc(pattern.title)}</b>
        <span class="map-node-conf">${esc(status)}</span>
        <span class="map-node-notes">${esc(domainLine(pattern))}${note ? ` · ${esc(note)}` : ""}</span>
      </div>`;
  }).join("");

  const lines = links.map((link) => {
    const a = layout[link.a];
    const b = layout[link.b];
    return `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" class="map-link is-${link.strength}" vector-effect="non-scaling-stroke"/>`;
  }).join("");

  const domainGroups = new Map();
  for (const pattern of visiblePatterns) {
    for (const domain of pattern.domains ?? []) {
      const list = domainGroups.get(domain) ?? [];
      list.push(pattern.title);
      domainGroups.set(domain, list);
    }
  }

  return `
    <section class="taste-map-section" aria-labelledby="taste-map-heading">
      <div class="map-intro">
        <p class="kicker">Taste Map</p>
        <h2 id="taste-map-heading">A visual sketch of how your taste connects.</h2>
        <p>This is the playful view, not a score or diagnosis. Lines show where patterns share evidence or show up in the same kinds of things. The layout is a visual sketch, not a measured distance.</p>
      </div>

      <ul class="map-key" aria-label="How to read the Taste Map">
        <li><span class="key-swatch look-firm"></span> Stronger working pattern</li>
        <li><span class="key-swatch look-tentative"></span> Still developing</li>
        <li class="map-key-lines"><span class="key-line"></span> A line means the patterns overlap somewhere</li>
      </ul>

      <div class="taste-map" role="img" aria-label="Visual map of ${visiblePatterns.length} working taste patterns">
        <svg class="taste-map-lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" focusable="false">${lines}</svg>
        <div class="taste-map-centre" aria-hidden="true"><span>you</span><em>still learning</em></div>
        ${nodes}
      </div>
      ${patterns.length > visiblePatterns.length ? `<p class="map-empty">Showing the 8 most prominent patterns here. The full profile includes ${patterns.length} active patterns.</p>` : ""}

      <div class="map-columns taste-map-summary">
        ${[...domainGroups.entries()].map(([domain, titles]) => `
          <section class="map-panel">
            <h3>${esc(domainById(domain)?.label ?? domain)}</h3>
            <p>${esc(titles.slice(0, 4).join(" · "))}${titles.length > 4 ? ` · +${titles.length - 4} more` : ""}</p>
          </section>`).join("")}
      </div>
    </section>`;
}
