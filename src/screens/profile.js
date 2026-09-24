import { state } from "../state.js";
import { canKeepDiscovering, untriedReactionLean } from "../model/taste.js";
import { confidenceOf } from "../model/tastemap.js";
import { CONTEXT, FIT, WEIGHT, statementFor } from "../model/statements.js";
import { renderStickerField } from "../components/stickers.js";
import { renderBlindSpotPanel } from "../components/blindspot.js";
import { activeBlindSpots, blindSpotsFor, isRecurring, recurringThemes } from "../model/blindspots.js";
import { hypothesisRecord } from "../model/interpretations.js";
import { displayLabel, domainById } from "../data/domains.js";
import { esc } from "../lib/html.js";
import { starterItems } from "../model/starters.js";

function sayButton(item, field, value, label, said) {
  const pressed = said?.[field] === value;
  return `<button type="button" class="button button-secondary signal-say-button" data-statement-pattern="${item.id}" data-statement-field="${field}" data-statement-value="${value}" aria-pressed="${pressed}">${label}</button>`;
}

// #36: a lighter correction than "Not really me" — scope a pattern out of one domain without
// rejecting it everywhere. Only shown when the pattern has been backed in more than one domain,
// since a single-domain pattern has nothing to scope down from.
function domainScopeControls(item, record) {
  const domains = [...new Set([...record.scope.supported, ...record.scope.excluded])];
  if (domains.length < 2) return "";
  const excluded = record.scope.excluded;
  return `
    <div class="signal-say signal-scope" role="group" aria-label="Where does “${esc(item.title)}” apply?">
      <span class="signal-say-label">Where does this apply?</span>
      <div class="detail-chip-row">
        ${domains.map((domainId) => {
          const label = domainById(domainId)?.label ?? domainId;
          const isExcluded = excluded.includes(domainId);
          return `<button type="button" class="detail-chip" data-scope-pattern="${item.id}" data-scope-domain="${domainId}" aria-pressed="${!isExcluded}">${isExcluded ? "Not in" : "In"} ${esc(label)}</button>`;
        }).join("")}
      </div>
    </div>`;
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
      <div class="signal-say-group" role="group" aria-label="Does \u201c${esc(item.title)}\u201d hold everywhere for you?">
        <span class="signal-say-label">Does this hold everywhere?</span>
        ${sayButton(item, "context", "some", "Only in some contexts", said)}
      </div>
    </div>`;
}

function hypothesisCard(item, index) {
  const update = item.aiGenerated
    ? { level: item.strength ?? "Emerging", status: item.status ?? "emerging", provenance: item.provenance ?? "Live AI interpretation." }
    : confidenceOf(state, item);
  const said = statementFor(state, item.id);
  const record = item.aiGenerated
    ? { scope: { supported: item.domains ?? [], excluded: said?.excludedDomains ?? [] } }
    : hypothesisRecord(state, item);
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
        ${said?.context === "some" ? `<div class="signal-said">${CONTEXT.some}. Tastemake can't claim this is Strong until it's specific about which context.</div>` : ""}
        ${sayControls(item, said)}
        ${said?.says === "not-me" ? "" : domainScopeControls(item, record)}
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
  const selectedTitles = starterItems(state).map((item) => item.title);
  const workingHypotheses = state.modelHypotheses ?? [];
  const liveProfile = workingHypotheses.length > 0;

  return `
    <section class="profile-screen">
      ${renderStickerField("profile")}
      <div class="profile-hero">
        <div class="profile-title-block">
          <p class="kicker">Taste Profile</p>
          <h1><span class="profile-headline-lead">Less "you like fantasy."</span><br class="profile-headline-break" /><span class="profile-headline-highlight">More "this is what tends to click."</span></h1>
          <p class="lede">These are working patterns, not one fixed aesthetic. They can overlap, disagree, get stronger, or become more specific as you react.</p>
          <p class="lede profile-evidence-note">Your taste updates from things you have actually tried. Reactions to picks you have not tried only shape what comes next; they are not taste evidence. Taste Profile patterns appear only when live AI has proposed them and Tastemake has validated every evidence citation.</p>
          ${state.hypothesisAiMessage ? `<p class="profile-ai-status" role="status">${esc(state.hypothesisAiMessage)}</p>` : ""}
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
        </div>
        <div class="profile-stamp" aria-hidden="true">
          <strong>WORKING</strong>
          <span>PROFILE</span>
        </div>
      </div>

      <div class="profile-evidence-strip">\n        <span class="profile-evidence-label">Your favorites</span>\n        <div class="profile-evidence-track">\n          ${selectedTitles.map((title, index) => `<span class="profile-evidence-item evidence-${(index % 4) + 1}">${esc(title)}</span>`).join("")}\n        </div>\n      </div>\n\n      ${liveProfile ? `\n      <h2 class="visually-hidden">Patterns Tastemake is working with</h2>\n      <div class="profile-map">\n        <aside class="profile-map-aside">\n          <span class="profile-aside-number">${workingHypotheses.length}</span>\n          <p>validated AI patterns currently shaping your profile</p>\n          <div class="profile-aside-note">patterns, not one aesthetic &nearr;</div>\n        </aside>\n        <div class="signal-stack">${workingHypotheses.map(hypothesisCard).join("")}</div>\n      </div>` : `\n      <div class="profile-empty" role="status">\n        <strong>No generated patterns yet.</strong>\n        <p>Tastemake is not filling this page with demo hypotheses. When live profile AI is available, it will build patterns only from your real experienced evidence.</p>\n      </div>`}

      ${blindSpotSection()}

      <div class="profile-footer page-actions">
        <div class="page-actions-left"><button class="button button-quiet" type="button" data-action="show-recs">&larr; Recommendations</button></div>
        <span class="footer-note">working patterns, not a fixed identity.</span>
        <div class="page-actions-right">
          ${canKeepDiscovering(state) ? `<button class="button button-primary" type="button" data-action="keep-discovering">Keep discovering &rarr;</button>` : `<button class="button button-primary" type="button" data-action="show-recs">Recommendations &rarr;</button>`}
        </div>
      </div>
    </section>`;
}
