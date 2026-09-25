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

export async function cachedValue(key, producer, { ttl = 300, tags = [] } = {}) {
  try {
    const cache = getCache();
    const cacheKey = `tastemake:${key}`;
    const hit = await cache.get(cacheKey);
    if (hit !== undefined && hit !== null) return hit;
    const value = await producer();
    await cache.set(cacheKey, value, { ttl, tags });
    return value;
  } catch {
    const local = memoryGet(key);
    if (local !== undefined) return local;
    const value = await producer();
    memorySet(key, value, ttl);
    return value;
  }
}
