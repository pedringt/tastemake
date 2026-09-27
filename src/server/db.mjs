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
export async function query(text, params = [], { env = process.env } = {}) {
  const url = env.TASTEMAKE_DATABASE_URL;
  if (!url) throw new Error("TASTEMAKE_DATABASE_URL is not configured");
  const sql = await sqlFor(url);
  const result = await sql.query(text, params);
  return Array.isArray(result) ? result : (result?.rows ?? []);
}
