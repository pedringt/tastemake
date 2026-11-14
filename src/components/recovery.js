// #348: shown in place of a screen that threw while rendering, so a problem with saved data never leaves
// a blank page. It reuses My Tastemake's own controls (data-mine-*), which app.js also handles while this
// panel is on screen: download what's there first, restore a backup, or start over (two steps).
export function renderRecovery(state) {
  return `
    <section class="mine-screen render-recovery" data-render-recovery>
      <p class="mine-eyebrow">Something went wrong</p>
      <h1 tabindex="-1">This page couldn’t load.</h1>
      <p class="mine-lede">Some of the Tastemake data saved in this browser couldn’t be read. You can download a backup of it first, restore an earlier backup, or start over.</p>
      <div class="mine-actions">
        <button class="button button-secondary" type="button" data-mine-export="backup">Download backup</button>
        <button class="button button-quiet" type="button" data-mine-restore>Restore backup</button>
        <input class="visually-hidden" type="file" name="tastemake-backup" aria-label="Choose a Tastemake backup file" accept="application/json,.json" data-mine-restore-file />
      </div>
      <div class="mine-actions">
        ${state.resetArmed
          ? `<button class="button button-primary" type="button" data-mine-reset="confirm">Yes, clear everything</button><button class="button button-quiet" type="button" data-mine-reset="cancel">Cancel</button>`
          : `<button class="button button-secondary" type="button" data-mine-reset="arm">Start over</button>`}
      </div>
    </section>`;
}
