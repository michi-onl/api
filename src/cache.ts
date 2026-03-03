export async function cached<T>(
  kv: KVNamespace,
  key: string,
  ttl: number,
  fn: () => Promise<T>,
  shouldCache?: (result: T) => boolean,
): Promise<T> {
  const hit = await kv.get(key);
  if (hit) return JSON.parse(hit) as T;

  const result = await fn();
  if (!shouldCache || shouldCache(result)) {
    await kv.put(key, JSON.stringify(result), { expirationTtl: ttl });
  }
  return result;
}
