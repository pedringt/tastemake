// #209: Vercel's Node runtime defines req.query as a lazy getter, and the deployed runtime builds it
// with Node's deprecated url.parse(), which logs DEP0169 ("url.parse() behavior is not standardized")
// on /api/catalog and /api/browse. Upstream switched that getter to the WHATWG URL API
// (vercel/vercel#16109, #16159), but the warning was still in Tastemake's production logs on Oct 1.
// Reading the query string from req.url ourselves means the getter, and url.parse, never run.
//
// The result has the same shape as req.query: one string per key, or an array of strings when a key
// repeats. A request object without a string url (an in-process test double) falls back to req.query.
export function requestQuery(req) {
  if (typeof req?.url !== "string") return req?.query ?? {};
  const query = {};
  new URL(req.url, "http://localhost").searchParams.forEach((value, key) => {
    if (!Object.hasOwn(query, key)) query[key] = value;
    else query[key] = Array.isArray(query[key]) ? [...query[key], value] : [query[key], value];
  });
  return query;
}
