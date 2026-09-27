// #135 foundation: thin, injectable Neon Postgres client.
//
// Tastemake has its own isolated Neon project/database (see docs referenced in #135); the
// connection string lives only in `TASTEMAKE_DATABASE_URL`. This module never hardcodes a
// real-DB-only code path: every exported function accepts an injected `query`/`sql` implementation
// so unit tests (and any caller that wants to mock persistence) can run fully offline, the same
// dependency-injection convention already used for `fetchImpl` in src/catalog/providers.mjs and
// src/catalog/related.mjs.
//
// This module is intentionally the *only* place that imports the Neon driver. Nothing else in the
// codebase should import "@neondatabase/serverless" directly.

let neonModule = null;
async function loadNeon() {
  if (neonModule) return neonModule;
  neonModule = await import("@neondatabase/serverless");
  return neonModule;
}

const sqlByUrl = new Map();

async function sqlFor(url) {
  if (sqlByUrl.has(url)) return sqlByUrl.get(url);
  const { neon } = await loadNeon();
  const sql = neon(url);
  sqlByUrl.set(url, sql);
  return sql;
}

// Returns null (never throws) when no database is configured, so every caller can treat "no DB"
// as an ordinary, cheap-to-check condition rather than an exceptional one.
export function isConfigured(env = process.env) {
  return Boolean(env.TASTEMAKE_DATABASE_URL);
}

// Executes a parameterized query and always resolves to a plain array of row objects, regardless
// of the underlying driver's own return shape. Throws on a real DB/query error — callers that want
// graceful degradation (e.g. the write-behind canonicalization in providers.mjs/related.mjs) are
// responsible for catching, exactly like they already do around provider fetches.
//
// `sqlImpl` is a test-only seam: passing it skips `sqlFor`/the real driver entirely and calls
// `sqlImpl(text, params)` directly. This exists because the offline canonical-store tests mock at
// a higher level (an injected `query` function) and never actually exercised this module's real
// call convention against the driver -- which is exactly how a real bug shipped and sat live in
// production silently swallowing every write until it was caught by hand. A test that passes a
// plain callable fake (mirroring `neon()`'s actual shape: callable, no `.query()` method) now
// exercises this exact call site and would have failed loudly instead.
export async function query(text, params = [], { env = process.env, sqlImpl } = {}) {
  if (sqlImpl) {
    const result = await sqlImpl(text, params);
    return Array.isArray(result) ? result : (result?.rows ?? []);
  }
  const url = env.TASTEMAKE_DATABASE_URL;
  if (!url) throw new Error("TASTEMAKE_DATABASE_URL is not configured");
  // The `neon()` client is itself the callable query function (`sql(text, params)`) -- it has no
  // `.query()` method. Verified live on production: every write-behind upsert was throwing
  // "sql.query is not a function" and getting silently swallowed by the caller's own catch handler,
  // so rows were never landing despite requests succeeding and no visible user-facing error.
  const sql = await sqlFor(url);
  const result = await sql(text, params);
  return Array.isArray(result) ? result : (result?.rows ?? []);
}
