// #100: Vercel Web Analytics and Speed Insights, loaded with Vercel's script-tag method for plain
// HTML. This app has no bundler, so the npm packages (@vercel/analytics, @vercel/speed-insights)
// cannot be imported in the browser: a bare specifier like "@vercel/analytics" throws "Failed to
// resolve module specifier" and aborts the whole module graph. That exact mistake took production
// down in #162 (see docs/HANDOFF.md). This file is its own <script type="module"> in index.html, so
// even a failure here can never stop src/app.js from running.
//
// Vercel serves both scripts from the deployment itself (/_vercel/...), only once Web Analytics and
// Speed Insights are enabled for the project in the Vercel dashboard. Until then they 404, which is
// harmless: a deferred <script> that fails to load does nothing, and the queue shims below just
// collect calls that nothing reads. Local dev and the headless QA suites (localhost) skip them.
//
// Privacy: Web Analytics is cookieless and aggregated (no cross-site tracking, visitors are not
// identified across days). Speed Insights reports page performance metrics (Core Web Vitals) per
// route. Neither sends taste evidence, favorites or anything the user typed. See
// docs/ai-readiness.md section 9.

export const INSIGHTS_SCRIPTS = Object.freeze([
  { queue: "va", src: "/_vercel/insights/script.js" },
  { queue: "si", src: "/_vercel/speed-insights/script.js" }
]);

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1", ""]);

export function shouldLoadInsights(location) {
  const protocol = String(location?.protocol ?? "");
  if (protocol !== "https:" && protocol !== "http:") return false;
  const host = String(location?.hostname ?? "").toLowerCase();
  if (LOCAL_HOSTS.has(host) || host.endsWith(".localhost")) return false;
  return true;
}

// Installs the documented queue shims (window.va / window.si) and appends one deferred script tag
// per service. Idempotent: calling it twice never adds a second tag.
export function installVercelInsights(win, doc) {
  if (!win || !doc || !shouldLoadInsights(win.location)) return [];
  const added = [];
  for (const { queue, src } of INSIGHTS_SCRIPTS) {
    if (typeof win[queue] !== "function") {
      win[queue] = function () { (win[`${queue}q`] = win[`${queue}q`] || []).push(arguments); };
    }
    if (doc.querySelector(`script[src="${src}"]`)) continue;
    const script = doc.createElement("script");
    script.defer = true;
    script.src = src;
    doc.head.appendChild(script);
    added.push(src);
  }
  return added;
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  try { installVercelInsights(window, document); } catch { /* analytics must never break the app */ }
}
