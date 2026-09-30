import { getCache } from "@vercel/functions";

const memory = globalThis.__tastemakeRuntimeCache ??= new Map();

function memoryGet(key) {
  const hit = memory.get(key);
  if (!hit) return undefined;
  if (hit.expires <= Date.now()) {
    memory.delete(key);
    return undefined;
  }
  return hit.value;
}

function memorySet(key, value, ttl) {
  memory.set(key, { value, expires: Date.now() + ttl * 1000 });
}

export async function cachedValue(key, producer, { ttl = 300, tags = [], cacheImpl } = {}) {
  const cacheKey = `tastemake:${key}`;
  let cache = cacheImpl ?? null;

  // Cache failures may fall back to process memory, but producer failures must never be mistaken
  // for cache failures. The old all-in-one try/catch could call a timed-out provider a second time,
  // turning one 8s Open Library timeout into ~16s of recommendation latency.
  if (!cache) {
    try { cache = getCache(); }
    catch { cache = null; }
  }

  if (cache) {
    try {
      const hit = await cache.get(cacheKey);
      if (hit !== undefined && hit !== null) return hit;
    } catch {
      const local = memoryGet(key);
      if (local !== undefined) return local;
      cache = null;
    }
  } else {
    const local = memoryGet(key);
    if (local !== undefined) return local;
  }

  const value = await producer();

  if (cache) {
    try {
      await cache.set(cacheKey, value, { ttl, tags });
      return value;
    } catch {
      memorySet(key, value, ttl);
      return value;
    }
  }

  memorySet(key, value, ttl);
  return value;
}
