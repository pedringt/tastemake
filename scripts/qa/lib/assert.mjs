// Shared check/eq helpers for the scripts/qa/*-tests.mjs suites (#221). Each suite used to define its
// own copy. A suite calls createSuite("label") once, runs its checks, then calls finish(), which prints
// the "<label>: N passed, M failed" summary line (scripts/qa/run-unit.mjs reads it) plus one line per
// failure, and exits 1 if anything failed.
export function createSuite(label) {
  let passed = 0;
  const failures = [];
  const check = (name, ok, detail = "") => { if (ok) passed += 1; else failures.push(`${name}${detail ? ` (${detail})` : ""}`); };
  const eq = (name, got, want) => check(name, got === want, `got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`);
  const finish = () => {
    console.log(`${label}: ${passed} passed, ${failures.length} failed`);
    failures.forEach((f) => console.log(`  x ${f}`));
    process.exit(failures.length ? 1 : 0);
  };
  return { check, eq, finish };
}
