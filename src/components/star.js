// The Favorite star, drawn as a shape. The ☆/★ text characters sat off-center in their round buttons
// (each font places those glyphs differently in the line box; Oct 24 review), so every star button uses
// this instead. Outline when off, filled when on; color follows the button's.
export function starIcon(filled = false) {
  return `<svg class="star-icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><path d="M12 3.2l2.7 5.47 6.03.88-4.37 4.25 1.03 6.01L12 16.97l-5.39 2.84 1.03-6.01-4.37-4.25 6.03-.88z" fill="${filled ? "currentColor" : "none"}" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>`;
}
