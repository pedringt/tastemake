import { favorites, hypotheses } from "../data/catalog.js";
import { state } from "../state.js";
import { untriedReactionLean } from "../model/taste.js";
import { confidenceOf } from "../model/tastemap.js";
import { FIT, WEIGHT, statementFor } from "../model/statements.js";
import { renderStickerField } from "../components/stickers.js";
import { renderBlindSpotPanel } from "../components/blindspot.js";
import { renderTasteMap } from "./tastemap.js";
import { activeBlindSpots, blindSpotsFor, isRecurring, recurringThemes } from "../model/blindspots.js";
import { displayLabel } from "../data/domains.js";
import { esc } from "../lib/html.js";

function sayButton(item, field, value, label, said) {
  const pressed = said?.[field] === value;
  return `<button type="button" class="button button-secondary signal-say-button" data-statement-pattern="${item.id}" data-statement-field="${field}" data-statement-value="${value}" aria-pressed="${pressed}">${label}</button>`;
}

// Pattern corrections: what the user says here is user-confirmed and outranks inference, but it is not taste
// evidence, so it never changes the confidence level (see src/model/statements.js).
function sayControls(item, said) {
  return `
    <div class="signal-say">
      <div class="signal-say-group" role="group" aria-label="Is \u201c${esc(item.title)}\u201d you?">
        <span class="signal-say-label">Is this you?</span>
        ${sayButton(item, "says", "accurate", "Yes, accurate", said)}
        ${sayButton(item, "says", "not-me", "Not really me", said)}
      </div>
      <div class="signal-say-group" role="group" aria-label="How much does \u201c${esc(item.title)}\u201d matter to you?">
        <span class="signal-say-label">How much does it matter?</span>
        ${sayButton(item, "weight", "lot", "A lot", said)}
        ${sayButton(item, "weight", "little", "A little", said)}
      </div>
    </div>`;
}

function hypothesisCard(item, index) {
  const update = confidenceOf(state, item);
  const said = statementFor(state, item.id);
  const spots = blindSpotsFor(state, item.id);
  const blindLine = spots.length
    ? `<div class="signal-blind">Blind spot: ${spots.map((spot) => `\u201c${esc(spot.item.title)}\u201d`).join(", ")} didn't hold up here.${spots.length === 1 ? " It takes more than one to change what Tastemake thinks." : ""}</div>`
    : "";
  const lean = untriedReactionLean(state, item);
  const leanLine = lean.direction
    ? `<div class="signal-lean is-${lean.direction}" title="Not counted as taste until you have tried them.">
          <span aria-hidden="true">${lean.direction === "toward" ? "&nearr;" : "&searr;"}</span>
          Your reactions lean ${lean.direction === "toward" ? "toward" : "away from"} this
          <em>(from ${lean.count} ${lean.count === 1 ? "pick" : "picks"} you haven't tried)</em>
        </div>`
    : "";
  return `
    <article class="signal-row signal-row-${index + 1}${said?.says === "not-me" ? " is-excluded" : ""}">
      <div class="signal-index">${String(index + 1).padStart(2, "0")}</div>
      <div class="signal-main">
        <div class="signal-title-row">
          <h3>${esc(item.title)}</h3>
          <span class="signal-badges">
            ${item.status === "conditional" ? `<span class="signal-flag" title="This pattern holds in some picks and not others.">Conditional</span>` : ""}
            ${said?.says === "accurate" ? `<span class="signal-flag signal-confirmed">${FIT.accurate}</span>` : ""}
            <span class="signal-status ${update.status}">${esc(update.level)}</span>
          </span>
        </div>
        <p class="signal-claim">${esc(item.claim)}</p>
        <div class="signal-evidence"><span>starting evidence</span> ${esc(item.evidence)}</div>
        <div class="signal-provenance">${esc(update.provenance)}</div>
        ${said?.says === "not-me" ? `<div class="signal-said"><strong>${FIT["not-me"]}.</strong> Tastemake leaves it out of what it picks for you. The pattern stays here so you can change your mind.</div>` : ""}
        ${said?.weight ? `<div class="signal-said">${WEIGHT[said.weight]}. That changes how much it counts when picking, not how sure Tastemake is.</div>` : ""}
        ${sayControls(item, said)}
        ${leanLine}
        ${blindLine}
      </div>
    </article>`;
}

function blindSpotSection() {
  const spots = activeBlindSpots(state);
  if (!spots.length) return "";
  const themes = recurringThemes(state);
  const lines = [
    ...themes.patterns.map((theme) => `\u201c${esc(theme.title)}\u201d (${theme.n} times)`),
    ...themes.reasons.map((theme) => `${esc(theme.label.toLowerCase())} (${theme.n} times)`)
  ];
  return `
    <section class="blind-section" aria-labelledby="blind-heading">
      <h2 id="blind-heading">Things Tastemake keeps getting wrong about you</h2>
      <p class="blind-intro">When Tastemake was confident you'd like something and you tried it and didn't, that is evidence about the model, not just a thumbs-down. These stay on record so it can see where it overreaches. Nothing here rewrites your patterns until the same thing keeps happening.</p>
      ${lines.length ? `<p class="blind-themes"><strong>Keeps coming up:</strong> ${lines.join("; ")}.</p>` : ""}
      <ul class="blind-list">
        ${spots.map((spot) => `
          <li class="blind-card">
            <div class="blind-card-head">
              <h3>${esc(spot.item.title)} <em>${esc(displayLabel(spot.item))}</em></h3>
              <span class="blind-status ${isRecurring(state, spot) ? "is-recurring" : ""}">${isRecurring(state, spot) ? "Recurring" : "Noted once"}</span>
            </div>
            ${renderBlindSpotPanel(spot.itemId)}
          </li>`).join("")}
      </ul>
    </section>`;
}

export function renderProfile() {
  const selectedTitles = favorites.filter((item) => state.selectedFavorites.has(item.id)).map((item) => item.title);

  return `
    <section class="profile-screen">
      ${renderStickerField("profile")}
      <div class="profile-hero">
        <div class="profile-title-block">
          <p class="kicker">Taste Profile</p>
          <h1><span class="profile-headline-lead">Less "you like fantasy."</span><br class="profile-headline-break" /><span class="profile-headline-highlight">More "this is what tends to click."</span></h1>
          <p class="lede">These are working patterns, not one fixed aesthetic. They can overlap, disagree, get stronger, or become more specific as you react.</p>
          <p class="lede profile-evidence-note">Your taste updates from things you have actually tried. Reactions to picks you have not tried only shape what comes next; they show up below as a lean, not as taste. The patterns themselves are a fixed starting set in this prototype (they do not change with your favorites); what changes is how much your own reactions back each one.</p>
          <details class="profile-legend">
            <summary>What do the confidence labels mean?</summary>
            <ul>
              <li><strong>Emerging:</strong> a starting pattern. Nothing you've tried has tested it yet.</li>
              <li><strong>Supported:</strong> at least one thing you've tried backs it, and more back it than count against it.</li>
              <li><strong>Strong:</strong> three or more things you've tried back it, and misses don't outweigh them.</li>
              <li><strong>Still learning:</strong> something you tried didn't land. One miss never weakens a pattern.</li>
              <li><strong>Less certain:</strong> more than one thing you tried didn't land.</li>
            </ul>
            <p>Reactions to things you haven't tried never count here. They show up as a separate "lean".</p>
          </details>
          <div class="profile-view-toggle" role="group" aria-label="How to see your Taste Profile">
            <button type="button" class="button button-secondary profile-view-button" data-profile-view="list" aria-pressed="${state.profileView !== "map"}">List</button>
            <button type="button" class="button button-secondary profile-view-button" data-profile-view="map" aria-pressed="${state.profileView === "map"}">Map</button>
          </div>
        </div>
        <div class="profile-stamp" aria-hidden="true">
          <strong>WORKING</strong>
          <span>PROFILE</span>
        </div>
      </div>

      ${state.profileView === "map" ? renderTasteMap() : `
      <div class="profile-evidence-strip">
        <span class="profile-evidence-label">Your starting favorites</span>
        <div class="profile-evidence-track">
          ${selectedTitles.map((title, index) => `<span class="profile-evidence-item evidence-${(index % 4) + 1}">${esc(title)}</span>`).join("")}
        </div>
      </div>

      <h2 class="visually-hidden">Patterns Tastemake is working with</h2>
      <div class="profile-map">
        <aside class="profile-map-aside">
          <span class="profile-aside-number">${hypotheses.length}</span>
          <p>patterns currently shaping your recommendations</p>
          <div class="profile-aside-note">patterns, not one aesthetic &nearr;</div>
        </aside>

        <div class="signal-stack">
          ${hypotheses.map(hypothesisCard).join("")}
        </div>
      </div>
      `}

      ${blindSpotSection()}

      <div class="profile-footer">
        <span class="footer-note">useful if you are curious. invisible if you are not.</span>
        <div class="action-group">
          <button class="button button-secondary" type="button" data-action="back-favorites">Edit favorites</button>
          <button class="button button-primary" type="button" data-action="show-recs">Back to recommendations <span aria-hidden="true">&rarr;</span></button>
        </div>
      </div>
    </section>`;
}
