import { state } from "../state.js";
import { AREAS } from "../model/taste.js";
import { toldItems } from "../model/mine.js";
import { reasonLabel } from "../model/blindspots.js";

// My Tastemake (#8, phase 1): what you've told Tastemake, which areas it may use, how picks are put together,
// and a way to start over. It is the deeper management layer behind Library, Bookmarks and the Taste Profile.
// Settings here are configuration, not taste evidence; the page says so.

function mediumOf(item) { return item.medium ?? ""; }

function actionButton(id, action, label, pressed = false, extra = "") {
  return `<button class="button button-secondary mine-action ${extra}" type="button" data-mine-item="${id}" data-mine-action="${action}" aria-pressed="${pressed}">${label}</button>`;
}

function row(entry) {
  const { id, item } = entry;
  const controls = entry.starter
    ? `<div class="mine-actions"><button class="button button-quiet mine-action" type="button" data-action="back-favorites">Change on the Favorites page</button></div>`
    : `<div class="mine-actions" role="group" aria-label="Change what you told Tastemake about ${item.title}">
        ${actionButton(id, "loved", "Loved it", Boolean(entry.loved))}
        ${actionButton(id, "liked", "Liked it", Boolean(entry.liked))}
        ${actionButton(id, "disliked", "Didn't like it", Boolean(entry.disliked))}
        ${actionButton(id, "remove", "Remove", false, "mine-remove")}
      </div>`;
  return `
    <li class="mine-row" data-mine-id="${id}">
      <div class="mine-row-main">
        <strong class="mine-title">${item.title}</strong>
        <span class="mine-medium">${mediumOf(item)}</span>
        <span class="mine-status">${entry.status}</span>
        <span class="mine-source">${entry.source}</span>
      </div>
      ${controls}
    </li>`;
}

// The starter favorites are one compact card, so they don't bury the things you told it since.
function startersRow(starters) {
  if (!starters.length) return "";
  return `
    <li class="mine-row mine-starters">
      <div class="mine-row-main">
        <strong class="mine-title">Starter favorites <span class="mine-count">${starters.length}</span></strong>
        <span class="mine-source">Picked on Favorites</span>
        <ul class="mine-chips">${starters.map((entry) => `<li>${entry.item.title}</li>`).join("")}</ul>
      </div>
      <div class="mine-actions"><button class="button button-quiet mine-action" type="button" data-action="back-favorites">Change on the Favorites page</button></div>
    </li>`;
}

function group(title, blurb, entries, emptyText) {
  const starters = entries.filter((entry) => entry.starter);
  const rest = entries.filter((entry) => !entry.starter);
  const id = `mine-${title.replace(/\W+/g, "-").toLowerCase()}`;
  return `
    <section class="mine-group" aria-labelledby="${id}">
      <h3 id="${id}">${title} <span class="mine-count">${entries.length}</span></h3>
      <p class="mine-blurb">${blurb}</p>
      ${entries.length ? `<ul class="mine-list">${startersRow(starters)}${rest.map(row).join("")}</ul>` : `<p class="mine-empty">${emptyText}</p>`}
    </section>`;
}

function blindSpotList(spots) {
  if (!spots.length) return "";
  return `
    <section class="mine-group" aria-labelledby="mine-blind">
      <h3 id="mine-blind">Things you told it it got wrong <span class="mine-count">${spots.length}</span></h3>
      <p class="mine-blurb">Removing one puts the patterns it set aside back in play for that pick.</p>
      <ul class="mine-list">
        ${spots.map((spot) => `
          <li class="mine-row" data-mine-blind="${spot.itemId}">
            <div class="mine-row-main">
              <strong class="mine-title">${spot.item.title}</strong>
              <span class="mine-status">${spot.none ? "None of the patterns held up" : `${spot.hypotheses.length} pattern${spot.hypotheses.length === 1 ? "" : "s"} set aside`}</span>
              <span class="mine-source">${(spot.reasons ?? []).map(reasonLabel).join(", ") || "No reason chosen"}</span>
            </div>
            <div class="mine-actions"><button class="button button-secondary mine-action mine-remove" type="button" data-mine-blind-remove="${spot.itemId}">Remove</button></div>
          </li>`).join("")}
      </ul>
    </section>`;
}

function areasBlock() {
  const onCount = AREAS.filter((area) => state.areas[area.id] !== false).length;
  return `
    <section class="mine-block" aria-labelledby="mine-areas">
      <h2 id="mine-areas">Areas</h2>
      <p class="mine-blurb">Which kinds of things Tastemake may suggest in <em>new</em> sets. This says nothing about what you like; it only shows or hides a kind of thing. Search always finds everything.</p>
      <div class="mine-toggles">
        ${AREAS.map((area) => {
          const on = state.areas[area.id] !== false;
          const last = on && onCount === 1;
          return `
            <label class="mine-toggle ${on ? "is-on" : ""}">
              <input type="checkbox" data-mine-area="${area.id}" ${on ? "checked" : ""} ${last ? "disabled" : ""} />
              <span class="mine-toggle-name">${area.label}</span>
              <span class="mine-toggle-about">${area.about}${last ? " (keep at least one on)" : ""}</span>
            </label>`;
        }).join("")}
      </div>
    </section>`;
}

function picksBlock() {
  return `
    <section class="mine-block" aria-labelledby="mine-picks">
      <h2 id="mine-picks">How new sets are put together</h2>
      <label class="mine-toggle mine-toggle-wide ${state.curveball ? "is-on" : ""}">
        <input type="checkbox" data-mine-curveball ${state.curveball ? "checked" : ""} />
        <span class="mine-toggle-name">Include a curveball</span>
        <span class="mine-toggle-about">One less-obvious pick (Surprise Me) in each new set. Off means the five best fits. This changes how a set is chosen, not what Tastemake thinks you like.</span>
      </label>
    </section>`;
}

function resetBlock() {
  return `
    <section class="mine-block" aria-labelledby="mine-reset">
      <h2 id="mine-reset">Start over</h2>
      <p class="mine-blurb">Clears everything you told Tastemake in this visit: favorites, reactions, bookmarks, things you added, corrections and these settings. Your look stays.</p>
      ${state.resetArmed
        ? `<div class="mine-actions"><button class="button button-primary" type="button" data-mine-reset="confirm">Yes, clear everything</button><button class="button button-quiet" type="button" data-mine-reset="cancel">Cancel</button></div>`
        : `<div class="mine-actions"><button class="button button-secondary" type="button" data-mine-reset="arm">Start over</button></div>`}
    </section>`;
}

export function renderMine() {
  const told = toldItems(state);
  return `
    <section class="mine-screen">
      <p class="mine-eyebrow">My Tastemake</p>
      <h1>What you've told Tastemake.</h1>
      <p class="mine-lede">Everything here comes from something you did. Nothing was guessed. The lists below are the same items you see in the Library, Bookmarks and Taste Profile, so a change here changes them too.</p>

      <div class="mine-columns">
        <div class="mine-main">
          <h2>Your evidence</h2>
          ${told.total === 0 ? `<p class="mine-empty">Nothing yet. As you pick favorites and react to things, they show up here.</p>` : ""}
          ${group("Counts as taste", "Starter favorites and things you have tried. These shape the Taste Profile.", told.counts, "Nothing here yet.")}
          ${group("Only steers what comes next", "Reactions to things you haven't tried, and bookmarks. These nudge which picks appear, but they are not taste.", told.steers, "Nothing here yet.")}
          ${blindSpotList(told.blindSpots)}
        </div>
        <aside class="mine-side">
          ${areasBlock()}
          ${picksBlock()}
          ${resetBlock()}
        </aside>
      </div>

      <div class="mine-back"><button class="button button-primary" type="button" data-action="mine-back">Back</button></div>
    </section>`;
}
