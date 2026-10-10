// Side-by-side comparison of live eval reports (Oct 10). Reads JSON reports written by
// `node scripts/evals/run.mjs --producer live --model <id> --tag <name>` and prints one Markdown page:
// a summary row per report, then, per fixture, each model's taste-profile patterns and picks with the
// explanation a visitor would read. No model calls.
//
//   node scripts/evals/compare.mjs scripts/evals/reports/live-a-latest.json scripts/evals/reports/live-b-latest.json
import { readFileSync } from "node:fs";
import { basename } from "node:path";

const files = process.argv.slice(2).filter((f) => f.endsWith(".json"));
if (!files.length) {
  console.error("usage: node scripts/evals/compare.mjs <report.json> [<report.json> ...]");
  process.exit(2);
}

const reports = files.map((file) => {
  const data = JSON.parse(readFileSync(file, "utf8"));
  const name = data.models ? `${data.models.picks}${data.models.profile !== data.models.picks ? ` / profile ${data.models.profile}` : ""}` : basename(file);
  return { file, name: `${name} (${basename(file).replace(/-latest\.json$/, "")})`, data };
});

const cell = (text) => String(text ?? "").replace(/\|/g, "/").replace(/\s+/g, " ").trim();
const lines = ["# Tastemake live eval: side by side", ""];

lines.push("| Report | Picks kept | Picks rejected | Patterns kept | Rule failures | Quality findings | Errors | Cost |", "|---|---|---|---|---|---|---|---|");
for (const { name, data } of reports) {
  let picksKept = 0, picksRejected = 0, patterns = 0, rules = 0, quality = 0, errors = 0;
  for (const fixture of data.fixtures) {
    if (fixture.error) errors += 1;
    picksKept += fixture.picks.length;
    patterns += fixture.hypotheses.length;
    for (const score of fixture.scores) {
      if (score.kind === "rule" && score.pass === false) rules += 1;
      if (score.kind === "quality" && score.pass === false) quality += 1;
      const match = /(\d+) picks kept, (\d+) rejected/.exec(score.detail ?? "");
      if (match) picksRejected += Number(match[2]);
    }
  }
  const cost = data.spend ? `$${Number(data.spend.usd || 0).toFixed(3)} (${data.spend.calls} calls)` : "n/a";
  lines.push(`| ${cell(name)} | ${picksKept} | ${picksRejected} | ${patterns} | ${rules} | ${quality} | ${errors} | ${cost} |`);
}
lines.push("");

const fixtureIds = [...new Set(reports.flatMap(({ data }) => data.fixtures.map((f) => f.id)))];
for (const id of fixtureIds) {
  lines.push(`## ${id}`, "");
  for (const { name, data } of reports) {
    const fixture = data.fixtures.find((f) => f.id === id);
    lines.push(`**${name}**`, "");
    if (!fixture) { lines.push("- (fixture not in this report)", ""); continue; }
    if (fixture.error) { lines.push(`- error: ${cell(fixture.error)}`, ""); continue; }
    if (fixture.hypotheses.length) {
      lines.push(`- Patterns: ${fixture.hypotheses.map((h) => `${h.label} (${h.level})`).join("; ")}`);
    }
    if (!fixture.picks.length) lines.push("- No picks kept.");
    for (const pick of fixture.picks) {
      lines.push(`- ${pick.title ?? pick.itemId}${pick.kind === "curveball" ? " (curveball)" : ""}: ${cell(pick.why) || "(no explanation stored)"}`);
    }
    lines.push("");
  }
}

console.log(lines.join("\n"));
