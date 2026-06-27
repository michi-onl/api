export async function cached<T>(
  kv: KVNamespace,
  key: string,
  ttl: number,
  fn: () => Promise<T>,
  shouldCache?: (result: T) => boolean,
): Promise<T> {
  try {
    const hit = await kv.get(key);
    if (hit) return JSON.parse(hit) as T;
  } catch (e) {
    // Cache read failed; fall through to origin fetch
    console.log(`cache read failed for ${key}: ${e}`);
  }

  const result = await fn();
  if (!shouldCache || shouldCache(result)) {
    try {
      await kv.put(key, JSON.stringify(result), { expirationTtl: ttl });
    } catch (e) {
      // Cache write failed; serve the result anyway
      console.log(`cache write failed for ${key}: ${e}`);
    }
  }
  return result;
}
