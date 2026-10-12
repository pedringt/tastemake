#!/usr/bin/env node
// #100: Vercel Web Analytics / Speed Insights loader. Free, no network, no browser.
import { readFileSync } from "node:fs";
import { INSIGHTS_SCRIPTS, installVercelInsights, shouldLoadInsights } from "../../src/lib/vercel-insights.js";
import { createSuite } from "./lib/assert.mjs";

const { check, eq, finish } = createSuite("insights tests");
const ROOT = new URL("../../", import.meta.url);

function fakeDom(location) {
  const head = { children: [], appendChild(node) { this.children.push(node); } };
  const doc = {
    head,
    createElement: (tag) => ({ tag, defer: false, src: "" }),
    querySelector: (selector) => head.children.find((node) => selector === `script[src="${node.src}"]`) ?? null
  };
  return { win: { location }, doc };
}

// Host gating: production and preview load the scripts; local dev and headless QA do not.
check("production host loads", shouldLoadInsights({ protocol: "https:", hostname: "tastemake.vercel.app" }));
check("preview host loads", shouldLoadInsights({ protocol: "https:", hostname: "tastemake-git-x-pedringt.vercel.app" }));
check("localhost skips", !shouldLoadInsights({ protocol: "http:", hostname: "localhost" }));
check("127.0.0.1 skips", !shouldLoadInsights({ protocol: "http:", hostname: "127.0.0.1" }));
check("*.localhost skips", !shouldLoadInsights({ protocol: "http:", hostname: "tastemake.localhost" }));
check("file: skips", !shouldLoadInsights({ protocol: "file:", hostname: "" }));
check("missing location skips", !shouldLoadInsights(undefined));

// Installs both documented paths with queue shims, once.
{
  const { win, doc } = fakeDom({ protocol: "https:", hostname: "tastemake.vercel.app" });
  const added = installVercelInsights(win, doc);
  eq("adds two scripts", added.length, 2);
  check("Web Analytics path", added.includes("/_vercel/insights/script.js"));
  check("Speed Insights path", added.includes("/_vercel/speed-insights/script.js"));
  check("scripts are deferred", doc.head.children.every((node) => node.tag === "script" && node.defer === true));
  check("va shim installed", typeof win.va === "function");
  check("si shim installed", typeof win.si === "function");
  win.va("event", { name: "QA" });
  eq("va shim queues calls before the real script loads", win.vaq?.length, 1);
  eq("second install adds nothing", installVercelInsights(win, doc).length, 0);
  eq("still exactly two script tags", doc.head.children.length, 2);
}

// Never touches the page locally.
{
  const { win, doc } = fakeDom({ protocol: "http:", hostname: "localhost" });
  eq("localhost adds nothing", installVercelInsights(win, doc).length, 0);
  check("localhost installs no shim", win.va === undefined && win.si === undefined);
}

// Guard against a repeat of #162: no npm analytics package, no bare-specifier import, and the
// loader is its own module ahead of app.js.
{
  const pkg = JSON.parse(readFileSync(new URL("package.json", ROOT), "utf8"));
  const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  check("no @vercel/analytics dependency", !deps["@vercel/analytics"]);
  check("no @vercel/speed-insights dependency", !deps["@vercel/speed-insights"]);
  const appSource = readFileSync(new URL("src/app.js", ROOT), "utf8");
  check("app.js has no bare @vercel import", !/^\s*import\b[^;]*["']@vercel\//m.test(appSource));
  const html = readFileSync(new URL("index.html", ROOT), "utf8");
  const loaderAt = html.indexOf('src="/src/lib/vercel-insights.js"');
  const appAt = html.indexOf('src="/src/app.js"');
  check("index.html loads the insights module", loaderAt > 0);
  check("insights module is separate from and before app.js", loaderAt > 0 && appAt > loaderAt);
  eq("two documented scripts", INSIGHTS_SCRIPTS.length, 2);
}

finish();
