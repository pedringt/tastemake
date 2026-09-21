// Junk-journal collage layer.
//
// Every piece lives in the board's reserved frame (side gutters + top/bottom bands, see
// "Collage frame" in styles/base.css), never on top of content. Positions are percentages
// along the frame, sizes are fractions of the gutter/band, so nothing drifts onto text when
// the layout reflows.

const INK = "#111a4b";
const COLOR = {
  pink: "#ff2fb3", pinkSoft: "#ffe3f6", cyan: "#20d9e8", cyanSoft: "#dcfbfd", lime: "#c8f52a",
  violet: "#8870ff", violetSoft: "#ece8ff", coral: "#ff776e", yellow: "#ffe36e", kraft: "#e6c48f"
};

const n = (value) => +value.toFixed(1);

function starPath(cx, cy, outer, inner, points = 5) {
  const coords = [];
  for (let i = 0; i < points * 2; i += 1) {
    const radius = i % 2 === 0 ? outer : inner;
    const angle = (Math.PI / points) * i - Math.PI / 2;
    coords.push(`${n(cx + radius * Math.cos(angle))} ${n(cy + radius * Math.sin(angle))}`);
  }
  return `M${coords.join(" L")} Z`;
}

function zigzagRect(x, y, w, h, step = 4, amp = 1.8) {
  const pts = [];
  for (let px = x, i = 0; px <= x + w; px += step, i += 1) pts.push([px, y + (i % 2 ? amp : 0)]);
  for (let py = y, i = 0; py <= y + h; py += step, i += 1) pts.push([x + w - (i % 2 ? amp : 0), py]);
  for (let px = x + w, i = 0; px >= x; px -= step, i += 1) pts.push([px, y + h - (i % 2 ? amp : 0)]);
  for (let py = y + h, i = 0; py >= y; py -= step, i += 1) pts.push([x + (i % 2 ? amp : 0), py]);
  return `M${pts.map((p) => `${n(p[0])} ${n(p[1])}`).join(" L")} Z`;
}

function svg(w, h, body) {
  return { w, h, html: `<svg viewBox="0 0 ${w} ${h}" aria-hidden="true" focusable="false">${body}</svg>` };
}

// Die-cut vinyl sticker: white border around a colored shape.
const diecut = (d, fill, extra = "") => `<path class="o" d="${d}"/><path d="${d}" fill="${fill}"/>${extra}`;

/* ---- washi tape ---------------------------------------------------------------------- */
function tape(L, T, fill, pattern, vertical = false) {
  const pts = [[3, 0], [L - 3, 0], [L, T * 0.17], [L - 4, T * 0.34], [L, T * 0.5], [L - 4, T * 0.67], [L, T * 0.84], [L - 3, T],
    [3, T], [0, T * 0.83], [4, T * 0.66], [0, T * 0.5], [4, T * 0.33], [0, T * 0.16]];
  let body = `<path class="pp" d="M${pts.map((p) => `${n(p[0])} ${n(p[1])}`).join(" L")} Z" fill="${fill}" opacity=".94"/>`;
  if (pattern === "stripe") {
    for (let x = 10; x < L - 16; x += 16) body += `<path d="M${x} 0 L${n(x + T * 0.5)} ${T}" stroke="#fff" stroke-width="${n(T * 0.22)}" opacity=".62"/>`;
  } else if (pattern === "dots") {
    for (let i = 0, cx = 12; cx < L - 8; i += 1, cx += 15) body += `<circle cx="${cx}" cy="${n(i % 2 ? T * 0.7 : T * 0.3)}" r="${n(T * 0.13)}" fill="#fff" opacity=".78"/>`;
  } else if (pattern === "check") {
    const s = T / 2;
    for (let col = 0, x = 8; x + s < L - 6; col += 1, x += s) {
      for (let row = 0; row < 2; row += 1) if ((col + row) % 2 === 0) body += `<rect x="${n(x)}" y="${n(row * s)}" width="${n(s)}" height="${n(s)}" fill="#fff" opacity=".58"/>`;
    }
  } else if (pattern === "zig") {
    const zig = [];
    for (let x = 8, i = 0; x < L - 6; x += T * 0.42, i += 1) zig.push(`${n(x)} ${n(i % 2 ? T * 0.72 : T * 0.28)}`);
    body += `<path d="M${zig.join(" L")}" fill="none" stroke="#111a4b" stroke-width="${n(T * 0.1)}" opacity=".5" stroke-linejoin="round"/>`;
  }
  return vertical
    ? svg(T, L, `<g transform="translate(${T} 0) rotate(90)">${body}</g>`)
    : svg(L, T, body);
}

/* ---- neon signs on black paper scraps ------------------------------------------------ */
function neon(w, h, body, color, wide = false) {
  const { html } = svg(w, h, `<g class="tube-glow">${body}</g><g class="tube-core">${body}</g>`);
  return { w: w + (wide ? 8 : 12), h: h + (wide ? 8 : 12), neon: true, color, html: html.replace("<svg ", '<svg class="neon" ') };
}
const word = (x, y, size, text) => `<text x="${x}" y="${y}" font-size="${size}" text-anchor="middle" class="neon-word">${text}</text>`;

const KINDS = {
  // washi tape
  "washi-pink": tape(100, 26, "#ff8ed3", "stripe"),
  "washi-dots": tape(100, 26, "#5be6f0", "dots"),
  "washi-check": tape(100, 26, COLOR.yellow, "check"),
  "washi-zig": tape(100, 26, COLOR.lime, "zig"),
  "washi-v-pink": tape(90, 26, "#ff8ed3", "stripe", true),
  "washi-v-dots": tape(90, 26, "#5be6f0", "dots", true),
  "washi-v-check": tape(90, 26, COLOR.yellow, "check", true),
  "washi-v-zig": tape(90, 26, COLOR.lime, "zig", true),

  // paper ephemera
  ticket: svg(90, 44, `<path class="pp" d="M4 4 H86 V17 a5 5 0 0 0 0 10 V40 H4 V27 a5 5 0 0 0 0 -10 Z" fill="#fff8cf"/>
    <path d="M62 7 V37" stroke="${INK}" stroke-width="1" stroke-dasharray="2 2.5" opacity=".45"/>
    <text x="33" y="19" font-size="7" text-anchor="middle" class="hand" fill="#4053af">NO. 07</text>
    <text x="33" y="32" font-size="12" text-anchor="middle" class="hand" fill="${INK}">ADMIT ONE</text>
    <path d="${starPath(75, 22, 8, 3.4)}" fill="${COLOR.pink}"/>`),
  sticky: svg(60, 60, `<path class="pp" d="M4 4 H56 V40 L40 56 H4 Z" fill="${COLOR.yellow}"/>
    <path d="M56 40 L40 56 V44 Q40 40 44 40 Z" fill="#e6c53f" class="pp"/>
    <text x="28" y="27" font-size="15" text-anchor="middle" class="hand" fill="${INK}" transform="rotate(-4 28 27)">more!</text>
    <path d="M12 34 q5 -5 10 0 t10 0 t10 0" fill="none" stroke="${COLOR.pink}" stroke-width="2.2" stroke-linecap="round"/>
    <path d="M12 46 C6 42 6 38 9 37 C11 36.500 12 38 12 39 C12 38 13.500 36.500 15.500 37 C18.500 38 18 42 12 46 Z" fill="${COLOR.pink}"/>`),
  index: svg(84, 56, `<rect class="pp" x="4" y="4" width="76" height="48" rx="2" fill="#fff"/>
    <path d="M4 15 H80" stroke="${COLOR.pink}" stroke-width="1.2"/>
    <path d="M4 25 H80 M4 33 H80 M4 41 H80" stroke="#9fb3ff" stroke-width=".8"/>
    <text x="10" y="12" font-size="8.500" class="hand" fill="${INK}">favorites</text>
    <path d="M10 29.500 q5 -5 10 0 t10 0 t10 0" fill="none" stroke="${INK}" stroke-width="1" opacity=".7"/>
    <path d="M10 37.500 h34" stroke="${INK}" stroke-width="1" opacity=".55" stroke-linecap="round"/>
    <path d="${starPath(68, 36, 6, 2.6)}" fill="${COLOR.yellow}" stroke="${INK}" stroke-width=".8"/>`),
  polaroid: svg(60, 74, `<g transform="rotate(-2 30 40)"><rect class="pp" x="4" y="8" width="52" height="62" fill="#fff"/>
    <rect x="9" y="13" width="42" height="42" fill="${COLOR.cyan}"/>
    <circle cx="38" cy="26" r="6" fill="${COLOR.yellow}"/>
    <path d="M9 55 V44 Q21 30 30 43 Q38 34 51 45 V55 Z" fill="${COLOR.violet}"/>
    <path d="M12 63 q4 -4 8 0 t8 0 t8 0" fill="none" stroke="${INK}" stroke-width="1.100" opacity=".6"/>
    <rect x="17" y="2" width="26" height="10" fill="rgba(255,227,110,.92)" stroke="rgba(17,26,75,.2)" stroke-width=".8" transform="rotate(-4 30 7)"/></g>`),
  paperclip: svg(24, 56, `<path d="M8 44 V14 A5 5 0 0 1 18 14 V44 A8 8 0 0 1 2 44 V17" fill="none" stroke="#fff" stroke-width="5.500" stroke-linecap="round"/>
    <path d="M8 44 V14 A5 5 0 0 1 18 14 V44 A8 8 0 0 1 2 44 V17" fill="none" stroke="#8f98c4" stroke-width="2.200" stroke-linecap="round"/>`),
  stamp: svg(56, 66, `<rect x="2" y="2" width="52" height="62" fill="#fff" class="pp"/>
    <rect x="2" y="2" width="52" height="62" fill="none" stroke="#d8aa76" stroke-width="3.500" stroke-dasharray="3 3"/>
    <rect x="9" y="9" width="38" height="46" fill="${COLOR.violetSoft}" stroke="${COLOR.violet}" stroke-width="1"/>
    <path d="${starPath(28, 29, 12, 5)}" fill="${COLOR.pink}"/>
    <text x="28" y="50" font-size="8.500" text-anchor="middle" class="display" fill="${INK}">MORE</text>`),
  postmark: svg(72, 44, `<circle cx="22" cy="22" r="17" fill="none" stroke="${COLOR.violet}" stroke-width="2" opacity=".85"/>
    <circle cx="22" cy="22" r="12" fill="none" stroke="${COLOR.violet}" stroke-width="1" opacity=".85"/>
    <text x="22" y="25" font-size="8" text-anchor="middle" class="display" fill="${COLOR.violet}" opacity=".95">MAIL</text>
    <path d="M42 11 q7 -5 14 0 t14 0 M42 22 q7 -5 14 0 t14 0 M42 33 q7 -5 14 0 t14 0" fill="none" stroke="${COLOR.violet}" stroke-width="2" opacity=".8" stroke-linecap="round"/>`),
  tag: svg(46, 70, `<path class="pp" d="M23 4 L40 14 V66 H6 V14 Z" fill="${COLOR.kraft}"/>
    <circle cx="23" cy="15" r="6" fill="#fff8" stroke="rgba(17,26,75,.25)" stroke-width=".8"/><circle cx="23" cy="15" r="3" fill="#d8aa76"/>
    <path d="M23 15 C30 5 38 3 43 7" fill="none" stroke="${INK}" stroke-width="1.300" opacity=".65" stroke-linecap="round"/>
    <text x="23" y="42" font-size="12" text-anchor="middle" class="hand" fill="${INK}">fave</text>
    <path d="M23 58 C15 53 14 48 18 47 C21 46.500 23 49 23 50 C23 49 25 46.500 28 47 C32 48 31 53 23 58 Z" fill="${COLOR.pink}"/>`),
  ledger: svg(74, 52, `<path class="pp" d="M3 6 L14 3 L26 6 L40 3 L54 6 L68 3 L71 20 L68 34 L71 48 L58 46 L44 49 L30 46 L16 49 L3 46 L6 30 L3 16 Z" fill="#fffefe"/>
    <path d="M6 15 H68 M6 23 H68 M6 31 H68 M6 39 H68" stroke="#8fdde6" stroke-width=".8"/>
    <path d="M16 5 V47" stroke="${COLOR.coral}" stroke-width=".9"/>
    <text x="21" y="21" font-size="9" class="hand" fill="${INK}">to try:</text>
    <path d="M21 29 h26 M21 37 h20" stroke="${INK}" stroke-width="1" opacity=".55" stroke-linecap="round"/>
    <path d="M55 30 l4 4 l8 -9" fill="none" stroke="${COLOR.pink}" stroke-width="2.200" stroke-linecap="round" stroke-linejoin="round"/>`),
  fabric: svg(60, 46, `<path d="${zigzagRect(3, 3, 54, 40, 4, 2)}" fill="${COLOR.pink}" class="pp"/>
    <g fill="#fff" opacity=".8"><circle cx="14" cy="14" r="2.500"/><circle cx="30" cy="12" r="2.500"/><circle cx="46" cy="16" r="2.500"/><circle cx="22" cy="28" r="2.500"/><circle cx="38" cy="30" r="2.500"/><circle cx="12" cy="36" r="2.500"/><circle cx="48" cy="37" r="2.500"/></g>
    <rect x="8" y="8" width="44" height="30" fill="none" stroke="#fff" stroke-width="1.100" stroke-dasharray="3 2.500" opacity=".9"/>`),
  "pressed-flower": svg(44, 66, `<path d="M22 62 C20 48 24 40 22 28" fill="none" stroke="${INK}" stroke-width="1.500" opacity=".65" stroke-linecap="round"/>
    <path d="M21 52 C10 50 6 42 8 36 C16 36 21 42 21 52 Z" fill="${COLOR.lime}" stroke="${INK}" stroke-width=".9" opacity=".95"/>
    <path d="M23 46 C34 44 38 38 37 32 C29 32 24 38 23 46 Z" fill="${COLOR.lime}" stroke="${INK}" stroke-width=".9" opacity=".95"/>
    <g transform="translate(22 20)">${[0, 72, 144, 216, 288].map((a) => `<ellipse cx="0" cy="-9" rx="6.500" ry="9.500" fill="${COLOR.pinkSoft}" stroke="${COLOR.pink}" stroke-width="1.300" transform="rotate(${a})"/>`).join("")}<circle r="4.500" fill="${COLOR.yellow}" stroke="${INK}" stroke-width=".9"/></g>`),
  coffee: svg(56, 56, `<ellipse cx="28" cy="28" rx="21" ry="20" fill="none" stroke="#8b5a2b" stroke-width="3" opacity=".3"/>
    <path d="M9 30 A19 19 0 0 1 36 10" fill="none" stroke="#8b5a2b" stroke-width="1.500" opacity=".22"/>
    <circle cx="47" cy="44" r="2.500" fill="#8b5a2b" opacity=".2"/>`),

  // marker doodles
  "doodle-arrow": svg(64, 40, `<path d="M6 30 C18 6 40 4 54 20 M43 22 L55 20 L52 9" fill="none" stroke="${COLOR.pink}" stroke-width="3.500" stroke-linecap="round" stroke-linejoin="round"/>`),
  squiggle: svg(72, 22, `<path d="M4 12 q6 -12 12 0 t12 0 t12 0 t12 0 t12 0" fill="none" stroke="${COLOR.violet}" stroke-width="3.500" stroke-linecap="round"/>`),

  // glossy die-cut stickers
  star: svg(60, 60, diecut(starPath(30, 31, 25, 11.500), COLOR.yellow, `<path d="M21 22 L26 14" stroke="#fff" stroke-width="2.500" stroke-linecap="round" opacity=".8"/>`)),
  heart: svg(60, 56, diecut("M30 50 C8 34 4 22 10 14 C16 7 26 9 30 17 C34 9 44 7 50 14 C56 22 52 34 30 50 Z", COLOR.pink,
    `<path d="M14 19 C15 15 19 13 22 14" fill="none" stroke="#fff" stroke-width="2.500" stroke-linecap="round" opacity=".75"/>`)),
  bolt: svg(44, 64, diecut("M26 4 L6 36 H21 L15 60 L38 26 H24 Z", COLOR.cyan)),
  "sparkle-yellow": svg(44, 44, diecut("M22 4 C24 15 29 20 40 22 C29 24 24 29 22 40 C20 29 15 24 4 22 C15 20 20 15 22 4 Z", COLOR.yellow)),
  "sparkle-lime": svg(44, 44, diecut("M22 4 C24 15 29 20 40 22 C29 24 24 29 22 40 C20 29 15 24 4 22 C15 20 20 15 22 4 Z", COLOR.lime)),
  "sparkle-pink": svg(44, 44, diecut("M22 4 C24 15 29 20 40 22 C29 24 24 29 22 40 C20 29 15 24 4 22 C15 20 20 15 22 4 Z", COLOR.pink)),
  flower: svg(60, 60, `<circle class="o" cx="30" cy="30" r="26"/>
    ${Array.from({ length: 8 }, (_, i) => `<ellipse cx="30" cy="14" rx="7" ry="11" fill="${i % 2 ? COLOR.pinkSoft : COLOR.pink}" transform="rotate(${i * 45} 30 30)"/>`).join("")}
    <circle cx="30" cy="30" r="8" fill="${COLOR.yellow}" stroke="${INK}" stroke-width="1"/>`),
  rainbow: svg(80, 46, `<path d="M19 42 A21 21 0 0 1 61 42" fill="none" stroke="#fff" stroke-width="30"/>
    <path d="M10 42 A30 30 0 0 1 70 42" fill="none" stroke="${COLOR.pink}" stroke-width="6"/>
    <path d="M16 42 A24 24 0 0 1 64 42" fill="none" stroke="${COLOR.yellow}" stroke-width="6"/>
    <path d="M22 42 A18 18 0 0 1 58 42" fill="none" stroke="${COLOR.lime}" stroke-width="6"/>
    <path d="M28 42 A12 12 0 0 1 52 42" fill="none" stroke="${COLOR.cyan}" stroke-width="6"/>
    <g fill="#fff" stroke="${COLOR.cyan}" stroke-width="1"><circle cx="12" cy="40" r="6"/><circle cx="20" cy="41" r="5"/><circle cx="68" cy="40" r="6"/><circle cx="60" cy="41" r="5"/></g>`),
  cloud: svg(70, 44, diecut("M18 36 C6 36 4 22 15 20 C15 9 30 5 36 14 C42 6 58 10 56 22 C67 22 68 36 56 36 Z", COLOR.cyanSoft,
    `<path d="M20 30 h30" stroke="${COLOR.cyan}" stroke-width="2" stroke-linecap="round" opacity=".8"/>`)),
  cherry: svg(50, 56, `<path d="M14 36 C16 22 24 12 36 8 M36 8 C34 20 34 28 36 34" fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round"/>
    <circle class="o" cx="15" cy="40" r="12"/><circle class="o" cx="37" cy="41" r="11"/>
    <path d="M14 36 C16 22 24 12 36 8 M36 8 C34 20 34 28 36 34" fill="none" stroke="${INK}" stroke-width="1.800" stroke-linecap="round"/>
    <path d="M36 8 C42 2 48 4 50 9 C44 13 38 11 36 8 Z" fill="${COLOR.lime}" stroke="${INK}" stroke-width="1"/>
    <circle cx="15" cy="40" r="10" fill="${COLOR.pink}"/><circle cx="37" cy="41" r="9" fill="${COLOR.coral}"/>
    <path d="M9 37 q1 -4 5 -5 M32 38 q1 -3 4 -4" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" opacity=".8"/>`),

  // neon icons (black paper scrap + glowing tube)
  "neon-heart": neon(60, 60, `<path d="M30 49 C10 35 8 22 15 16 C21 11 28 14 30 20 C32 14 39 11 45 16 C52 22 50 35 30 49 Z"/><path d="M47 6 v9 M42.500 10.500 h9"/>`, COLOR.pink),
  "neon-game": neon(60, 60, `<path d="M16 22 H44 C52 22 55 32 53 40 C51 46 45 45 42 40 L39 36 H21 L18 40 C15 45 9 46 7 40 C5 32 8 22 16 22 Z"/><path d="M19 29 v6 M16 32 h6"/><circle cx="41" cy="29" r="1.800"/><circle cx="46.500" cy="33" r="1.800"/>`, COLOR.cyan),
  "neon-film": neon(60, 60, `<rect x="9" y="26" width="42" height="24" rx="2"/><path d="M9 26 L13 13 H53 L49 26 Z"/><path d="M19 26 L23 13 M30 26 L34 13 M41 26 L45 13"/>`, "#ffe36e"),
  "neon-book": neon(60, 60, `<path d="M8 16 C18 12 26 14 30 20 C34 14 42 12 52 16 V47 C42 43 34 45 30 51 C26 45 18 43 8 47 Z"/><path d="M30 20 V51"/>`, COLOR.lime),
  "neon-music": neon(60, 60, `<path d="M12 36 V30 C12 16 20 10 30 10 C40 10 48 16 48 30 V36"/><rect x="8" y="34" width="9" height="15" rx="3"/><rect x="43" y="34" width="9" height="15" rx="3"/>`, "#a48bff"),
  "neon-star": neon(60, 60, `<path d="${starPath(30, 31, 22, 10)}"/>`, "#ffe36e"),
  "neon-more": neon(130, 46, `${word(65, 20, 19, "more")}${word(65, 41, 19, "like this")}`, COLOR.pink, true),
  "neon-repeat": neon(130, 46, `${word(65, 30, 25, "on repeat")}<path d="M22 38 q6 -6 12 0 t12 0 t12 0 t12 0 t12 0" fill="none"/>`, COLOR.cyan, true),
  "neon-taste": neon(130, 46, `${word(65, 20, 19, "your")}${word(65, 41, 19, "taste!")}`, COLOR.lime, true)
};

/* ---- placement -------------------------------------------------------------------------
   [kind, zone, position %, size, rotation deg, nudge px, hideOnTablet]
   zone l/r: left/right gutter, position = % down the board, size = width as a fraction of
   the gutter (before rotation). zone t/b: top/bottom band, position = % across the board,
   size = height as a fraction of the band. A piece rotated 90deg stands up so a long piece
   can run along a narrow gutter. */
const LAYOUT = {
  favorites: [
    ["neon-game", "l", 6, .82, -5], ["washi-v-pink", "l", 14, .3, 3], ["star", "l", 22, .62, 10], ["sticky", "l", 31, .74, -7],
    ["tag", "l", 41, .6, 6], ["fabric", "l", 51, .78, -9, 0, 1], ["stamp", "l", 60, .66, 5], ["sparkle-lime", "l", 67, .5, 0],
    ["cherry", "l", 75, .62, -8], ["index", "l", 85, 1.2, 90, 0, 1], ["washi-v-check", "l", 94, .3, -3],
    ["washi-v-dots", "r", 5, .3, -3], ["pressed-flower", "r", 13, .66, 8], ["neon-heart", "r", 22, .78, 6], ["ticket", "r", 32, 1.5, -90],
    ["flower", "r", 41, .68, 12, 0, 1], ["polaroid", "r", 51, .66, -6], ["rainbow", "r", 61, .8, -4, 0, 1], ["bolt", "r", 69, .5, 14],
    ["ledger", "r", 78, 1.1, -90, 0, 1], ["postmark", "r", 88, 1.25, 90], ["squiggle", "r", 95, 1.4, 90],
    ["washi-pink", "t", 9, .34, -3], ["neon-taste", "t", 30, .8, 2], ["ticket", "t", 48, .6, -3, 0, 1], ["star", "t", 58, .7, 8],
    ["neon-more", "t", 73, .8, -2], ["washi-check", "t", 90, .34, 4],
    ["index", "b", 8, .72, 3], ["cloud", "b", 22, .6, -4, 0, 1], ["neon-repeat", "b", 40, .8, 3], ["washi-zig", "b", 57, .32, -3],
    ["ledger", "b", 70, .75, 2, 0, 1], ["sparkle-pink", "b", 82, .6, 0], ["washi-dots", "b", 94, .32, 3],
    ["paperclip", "r", 27, .34, 8], ["doodle-arrow", "t", 39, .8, -12], ["coffee", "b", 48, .9, 0]
  ],
  profile: [
    ["neon-music", "l", 5, .8, 5], ["washi-v-dots", "l", 13, .3, -4], ["polaroid", "l", 22, .66, -7], ["sparkle-pink", "l", 29, .5, 0],
    ["ticket", "l", 38, 1.5, 90, 0, 1], ["flower", "l", 47, .66, 9], ["ledger", "l", 56, 1.15, -90, 0, 1], ["star", "l", 64, .6, -12],
    ["tag", "l", 73, .6, 5], ["fabric", "l", 82, .78, 8, 0, 1], ["washi-v-pink", "l", 90, .3, 4],
    ["cloud", "r", 5, .85, 6, 0, 1], ["sticky", "r", 13, .72, 6], ["neon-heart", "r", 23, .78, -6], ["washi-v-check", "r", 31, .3, 3],
    ["pressed-flower", "r", 40, .66, -8], ["stamp", "r", 49, .66, 6], ["index", "r", 58, 1.2, -90, 0, 1], ["rainbow", "r", 67, .8, 5, 0, 1],
    ["bolt", "r", 75, .5, -12], ["postmark", "r", 83, 1.25, -90], ["washi-v-zig", "r", 91, .3, -4],
    ["washi-check", "t", 8, .34, -3], ["heart", "t", 22, .7, -10], ["neon-taste", "t", 38, .8, -2], ["ticket", "t", 55, .62, 3, 0, 1],
    ["sparkle-lime", "t", 66, .6, 0], ["neon-more", "t", 80, .8, 2], ["washi-pink", "t", 94, .32, -4],
    ["index", "b", 10, .72, -3], ["flower", "b", 24, .66, 8, 0, 1], ["neon-repeat", "b", 38, .8, -2], ["washi-zig", "b", 55, .32, 3],
    ["stamp", "b", 68, .68, -5], ["cloud", "b", 80, .6, 4, 0, 1], ["washi-check", "b", 94, .32, -3],
    ["paperclip", "l", 33, .34, -8], ["doodle-arrow", "t", 30, .8, 8], ["coffee", "b", 47, .9, 0]
  ],
  recommendations: [
    ["neon-film", "l", 4, .8, -5], ["washi-v-pink", "l", 11, .3, 3], ["flower", "l", 18, .66, -10], ["sticky", "l", 26, .72, 7],
    ["ticket", "l", 34, 1.5, -90, 0, 1], ["star", "l", 41, .62, 12], ["polaroid", "l", 49, .66, -5], ["washi-v-dots", "l", 57, .3, -3],
    ["cherry", "l", 64, .62, 8], ["fabric", "l", 72, .78, -8, 0, 1], ["tag", "l", 80, .6, 5], ["sparkle-yellow", "l", 87, .5, 0],
    ["washi-v-check", "l", 94, .3, 3],
    ["neon-book", "r", 4, .8, 5], ["pressed-flower", "r", 12, .66, -8], ["washi-v-zig", "r", 19, .3, 4], ["postmark", "r", 27, 1.25, 90],
    ["heart", "r", 35, .62, -8], ["stamp", "r", 43, .66, 6], ["neon-star", "r", 51, .78, -6], ["ledger", "r", 59, 1.15, 90, 0, 1],
    ["rainbow", "r", 67, .8, -4, 0, 1], ["bolt", "r", 75, .5, 12], ["index", "r", 83, 1.2, -90, 0, 1], ["washi-v-pink", "r", 91, .3, -3],
    ["squiggle", "r", 96, 1.4, 90],
    ["washi-pink", "t", 8, .34, -3], ["neon-more", "t", 25, .8, 2], ["star", "t", 40, .7, -8], ["ticket", "t", 52, .6, 3, 0, 1],
    ["sparkle-pink", "t", 62, .6, 0], ["neon-taste", "t", 76, .8, -2], ["washi-dots", "t", 92, .32, 4],
    ["washi-check", "b", 9, .32, -3], ["cloud", "b", 20, .6, 4, 0, 1], ["neon-repeat", "b", 36, .8, -3], ["polaroid", "b", 50, .85, -4],
    ["washi-zig", "b", 63, .32, 3], ["sticky", "b", 74, .8, 5, 0, 1], ["washi-pink", "b", 92, .32, 4],
    ["paperclip", "l", 45, .34, 8], ["doodle-arrow", "t", 33, .8, -10], ["coffee", "b", 43, .9, 0]
  ],
  bookmarks: [
    ["neon-film", "l", 8, .8, -5], ["washi-v-pink", "l", 19, .3, 3], ["sticky", "l", 31, .74, -7], ["tag", "l", 44, .6, 6],
    ["star", "l", 56, .62, 10], ["polaroid", "l", 68, .66, -6], ["sparkle-lime", "l", 79, .5, 0], ["washi-v-check", "l", 91, .3, -3],
    ["neon-music", "r", 8, .8, 5], ["pressed-flower", "r", 20, .66, 8], ["ticket", "r", 34, 1.5, -90], ["cherry", "r", 47, .62, -8],
    ["stamp", "r", 59, .66, 6], ["rainbow", "r", 70, .8, -4, 0, 1], ["washi-v-dots", "r", 82, .3, 4], ["postmark", "r", 92, 1.25, 90],
    ["washi-check", "t", 10, .34, -3], ["neon-taste", "t", 32, .8, 2], ["heart", "t", 52, .7, -10], ["neon-more", "t", 72, .8, -2], ["washi-pink", "t", 92, .34, 4],
    ["index", "b", 10, .72, 3], ["neon-repeat", "b", 34, .8, -2], ["flower", "b", 52, .66, 8], ["washi-zig", "b", 68, .32, -3], ["sparkle-pink", "b", 82, .6, 0], ["washi-dots", "b", 94, .32, 3]
  ]
};

// The Library board reuses the Bookmarks arrangement, mirrored left/right and tilted the other way.
LAYOUT.library = LAYOUT.bookmarks.map(([kind, zone, position, size, rotation, nudge, hide]) =>
  [kind, zone === "l" ? "r" : zone === "r" ? "l" : zone, position, size, -rotation, nudge, hide]);

function place([kindName, zone, position, size, rotation = 0, nudge = 0, hideOnTablet = 0]) {
  const kind = KINDS[kindName];
  const style = [`--p:${position}%`, `--f:${size}`, `--r:${rotation}deg`, `--ar:${n(kind.w / kind.h)}`];
  if (nudge) style.push(`--n:${nudge}px`);
  if (kind.color) style.push(`--c:${kind.color}`);
  const classes = ["sticker", `sticker-zone-${zone}`, `st-${kindName}`];
  if (kind.neon) classes.push("st-neon");
  if (hideOnTablet) classes.push("t-hide");
  return `<span class="${classes.join(" ")}" style="${style.join(";")}">${kind.html}</span>`;
}

export function renderStickerField(page) {
  return `<div class="sticker-field sticker-field-${page}" aria-hidden="true">${LAYOUT[page].map(place).join("")}</div>`;
}
