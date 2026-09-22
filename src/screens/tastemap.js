import { state } from "../state.js";
import { hypotheses } from "../data/catalog.js";
import { itemMatchesDomain, renderDomainFilter } from "../components/domain-filter.js";
import { blindSpotsFor } from "../model/blindspots.js";
import { confidenceOf, evidenceCount, lean, nodeLayout, patternEvidence, patternLinks, patternsOfItem, tensions, thinAreas } from "../model/tastemap.js";
import { visibleDomains } from "../data/domains.js";
import { statementFor } from "../model/statements.js";
import { esc } from "../lib/html.js";

// Taste Map (#21): the Taste Profile as a picture you can poke at. Cards are Tastemake's guesses; the rows
// under "What you've told it" are yours. Confidence and link strength come in coarse steps, never numbers.
// A text version of every connection sits under the picture, so nothing depends on seeing the lines.

const LEVEL_TEXT = { strong: "strong link", some: "some link", weak: "weak link" };
const GROUPS = [
  ["supports", "Supports it", "counts toward this pattern"],
  ["against", "Counts against it", "counts against this pattern"],
  ["heldUp", "Didn't land, but this pattern held up", "not counted against this pattern"],
  ["steers", "Only steers what comes next", "shapes what comes next, not your taste"]
];

function evidenceRows(pattern) {
  const evidence = patternEvidence(state, pattern);
  const visible = (rows) => rows.filter((row) => itemMatchesDomain(row.item, state.mapFilter));
  const total = evidenceCount(evidence);
  if (!total) {
    return `<p class="map-empty">Nothing yet. This pattern rests only on your earlier ratings, so it's a thin spot.</p>`;
  }
  const groups = GROUPS.map(([key, title, effect]) => {
    const rows = visible(evidence[key]);
    if (!rows.length) return "";
    return `
      <div class="map-group">
        <h5>${title}</h5>
        <ul>
          ${rows.map((row) => `
            <li>
              <button type="button" class="map-evidence" data-map-item="${row.item.id}" aria-pressed="${state.mapItem === row.item.id}">
                <b>${esc(row.item.title)}</b>
                <span>${esc(row.label)} &middot; ${effect}</span>
                <em>Told by you</em>
              </button>
            </li>`).join("")}
        </ul>
      </div>`;
  }).join("");
  return groups || `<p class="map-empty">Nothing in this type. Try All.</p>`;
}

function detailHTML(pattern) {
  const update = confidenceOf(state, pattern);
  const links = patternLinks().filter((link) => link.a === pattern.id || link.b === pattern.id);
  const spots = blindSpotsFor(state, pattern.id);
  const leaning = lean(state, pattern);
  const others = (link) => hypotheses.find((p) => p.id === (link.a === pattern.id ? link.b : link.a));

  return `
    <div class="map-detail" aria-label="${esc(pattern.title)}">
      <h3 tabindex="-1" data-map-focus>${esc(pattern.title)}</h3>
      <p class="map-claim">${esc(pattern.claim)}</p>
      <p class="map-confidence"><strong>${esc(update.label)}.</strong> ${esc(update.note ?? "Your reactions haven't changed how sure Tastemake is about this yet.")}</p>
      <div class="map-detail-grid">
        <div>
          <h4>Where it came from</h4>
          <p class="map-came-from">Shows up in ${esc(pattern.evidence)}. <em>A starting pattern; it is fixed in this prototype.</em></p>
          ${leaning.direction ? `<p class="map-lean">Your reactions to picks you haven't tried lean ${leaning.direction === "toward" ? "toward" : "away from"} this. That's a lean, not taste.</p>` : ""}
          ${spots.length ? `<p class="map-lean">Blind spot: ${spots.map((spot) => `“${esc(spot.item.title)}”`).join(", ")} didn't hold up here.</p>` : ""}
        </div>
        <div>
          <h4>What you've told it</h4>
          <div class="filter-band map-filter">${renderDomainFilter({ selected: state.mapFilter, scope: "map", label: "Filter this evidence by type" })}</div>
          ${evidenceRows(pattern)}
        </div>
      </div>
      ${links.length ? `
        <h4>Connected patterns</h4>
        <ul class="map-related">
          ${links.map((link) => `<li><button type="button" class="map-chip" data-map-pattern="${others(link).id}">${esc(others(link).title)}</button> <span>${LEVEL_TEXT[link.level]}</span></li>`).join("")}
        </ul>` : ""}
      ${itemBlock()}
    </div>`;
}

function itemBlock() {
  const feedback = state.feedbackByRecommendation[state.mapItem];
  if (!feedback) return "";
  const patterns = patternsOfItem(feedback.item);
  return `
    <div class="map-item-detail">
      <h4>${esc(feedback.item.title)}</h4>
      <p>${patterns.length
        ? `It leans on: ${patterns.map((p) => `<button type="button" class="map-chip" data-map-pattern="${p.id}">${esc(p.title)}</button>`).join(" ")}`
        : "This one isn't tagged to any pattern, so it can't move the map."}</p>
    </div>`;
}

export function renderTasteMap() {
  const layout = nodeLayout(hypotheses.length);
  const links = patternLinks();
  const centre = (id) => layout[hypotheses.findIndex((p) => p.id === id)];
  const selected = hypotheses.find((p) => p.id === state.mapPattern) ?? null;
  const itemPatterns = new Set(patternsOfItem(state.feedbackByRecommendation[state.mapItem]?.item ?? {}).map((p) => p.id));
  const tension = tensions(state);
  const thin = thinAreas(state);

  const nodes = hypotheses.map((pattern, index) => {
    const update = confidenceOf(state, pattern);
    const evidence = patternEvidence(state, pattern);
    const notes = [
      tension.some((t) => t.patternId === pattern.id && t.kind === "mixed") ? "Mixed evidence" : "",
      blindSpotsFor(state, pattern.id).length ? "Blind spot" : "",
      evidenceCount(evidence) === 0 ? "No reactions yet" : "",
      statementFor(state, pattern.id)?.says === "not-me" ? "You said: not you" : statementFor(state, pattern.id)?.says === "accurate" ? "You confirmed this" : ""
    ].filter(Boolean);
    return `
      <button type="button" class="taste-map-node look-${update.look} ${state.mapPattern === pattern.id ? "is-selected" : ""} ${itemPatterns.has(pattern.id) ? "is-linked" : ""}"
        style="left:${layout[index].x}%;top:${layout[index].y}%"
        data-map-pattern="${pattern.id}" aria-pressed="${state.mapPattern === pattern.id}">
        <b>${esc(pattern.title)}</b>
        <span class="map-node-conf">${esc(update.label)}</span>
        ${notes.length ? `<span class="map-node-notes">${notes.map(esc).join(" &middot; ")}</span>` : ""}
      </button>`;
  }).join("");

  const lines = links.map((link) => {
    const a = centre(link.a);
    const b = centre(link.b);
    const active = selected && (link.a === selected.id || link.b === selected.id);
    return `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" class="map-link is-${link.level} ${active ? "is-active" : ""}" vector-effect="non-scaling-stroke"/>`;
  }).join("");

  return `
    <section class="taste-map-section" aria-labelledby="map-heading">
      <div class="map-intro">
        <h2 id="map-heading">Your taste, as a map</h2>
        <p>Each card is a pattern Tastemake thinks it sees in you. Lines join patterns that show up together in picks it knows about. It's a sketch, not a personality score: how sure it is comes in steps, and thin spots are marked.</p>
      </div>

      <ul class="map-key" aria-label="How to read the map">
        <li><span class="key-swatch look-firm"></span> Solid: Strong. Several things you've tried back it</li>
        <li><span class="key-swatch look-tentative"></span> Dashed: Emerging, Supported or Still learning</li>
        <li><span class="key-swatch look-shaky"></span> Dotted: less certain, after more than one pick didn't land</li>
        <li class="map-key-lines"><span class="key-line"></span> Thicker line: more picks lean on both</li>
      </ul>

      <div class="taste-map" role="group" aria-label="Map of the ${hypotheses.length} patterns in your taste. A written list of the same connections follows.">
        <svg class="taste-map-lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" focusable="false">${lines}</svg>
        <div class="taste-map-centre" aria-hidden="true"><span>you</span><em>still learning</em></div>
        ${nodes}
      </div>

      ${selected ? detailHTML(selected) : `<div class="map-detail is-empty"><p>Tap a pattern to see what it rests on, what you've told Tastemake about it, and how it connects to the others.</p></div>`}

      <div class="map-columns">
        <section class="map-panel" aria-labelledby="map-tensions">
          <h3 id="map-tensions">Tensions and open questions</h3>
          ${tension.length
            ? `<ul>${tension.map((t) => `<li class="is-${t.kind}">${esc(t.text)}</li>`).join("")}</ul>`
            : `<p class="map-empty">Nothing is pulling against anything yet.</p>`}
        </section>
        <section class="map-panel" aria-labelledby="map-thin">
          <h3 id="map-thin">Where Tastemake has little to go on</h3>
          <ul>
            ${thin.quietPatterns.length ? `<li>No reactions from you yet on: ${thin.quietPatterns.map((p) => esc(p.title)).join("; ")}. They rest only on your earlier ratings.</li>` : ""}
            <li>Things you've told it about, by type: ${visibleDomains().map((d) => `${d.label} ${thin.coverage[d.id]}`).join(", ")}.${thin.thinDomains.length ? ` Thin: ${thin.thinDomains.map((d) => d.domain).join(", ")}.` : ""}</li>
          </ul>
        </section>
        <section class="map-panel" aria-labelledby="map-connections">
          <h3 id="map-connections">Why these patterns connect</h3>
          <ul>
            ${links.map((link) => {
              const a = hypotheses.find((p) => p.id === link.a);
              const b = hypotheses.find((p) => p.id === link.b);
              return `<li><b>${esc(a.title)}</b> and <b>${esc(b.title)}</b> (${LEVEL_TEXT[link.level]}): ${link.items.map((item) => esc(item.title)).join(", ")}.</li>`;
            }).join("")}
          </ul>
        </section>
      </div>
    </section>`;
}
