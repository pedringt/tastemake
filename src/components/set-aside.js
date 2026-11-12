// #348 follow-up: when loading left out saved data it couldn't read, the original is kept aside
// (persistence.js). A one-line notice says so on the next screen; My Tastemake offers the copy as a
// download until the user discards it.
import { esc } from "../lib/html.js";

export function setAsideNoticeHtml(state) {
  if (!state.setAsideNotice || state.screen === "mine") return "";
  return `
    <div class="example-banner set-aside-notice" role="note">
      <p><strong>Some saved data couldn’t be read.</strong> Tastemake set it aside so everything else still works.</p>
      <div class="set-aside-notice-actions">
        <button class="button button-primary" type="button" data-open-mine>Review in My Tastemake</button>
        <button class="button button-quiet" type="button" data-set-aside-notice-close aria-label="Close this notice">Close</button>
      </div>
    </div>`;
}

export function setAsideBlock(copy, { armed = false } = {}) {
  if (!copy) return "";
  const when = Number.isNaN(Date.parse(copy.setAsideAt)) ? "" : ` on ${new Date(copy.setAsideAt).toLocaleDateString()}`;
  const count = Array.isArray(copy.dropped) ? copy.dropped.length : 0;
  return `
    <section class="mine-block mine-set-aside" aria-labelledby="mine-set-aside">
      <h2 id="mine-set-aside" tabindex="-1">Set-aside data</h2>
      <p class="mine-blurb">Some of the Tastemake data saved in this browser couldn’t be read${esc(when)}${count ? ` (${count} ${count === 1 ? "part" : "parts"})` : ""}. Tastemake left it out so the rest still works, and kept the original here. Download it if you want it repaired; it isn’t used for anything.</p>
      <div class="mine-actions">
        <button class="button button-secondary" type="button" data-set-aside="download">Download it</button>
        ${armed
          ? `<button class="button button-primary" type="button" data-set-aside="confirm">Yes, discard it</button><button class="button button-quiet" type="button" data-set-aside="cancel">Cancel</button>`
          : `<button class="button button-quiet" type="button" data-set-aside="arm">Discard it</button>`}
      </div>
    </section>`;
}
