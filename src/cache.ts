export async function cached<T>(
  kv: KVNamespace,
  key: string,
  ttl: number,
  fn: () => Promise<T>,
): Promise<T> {
  const hit = await kv.get(key);
  if (hit) return JSON.parse(hit) as T;

  const result = await fn();
  await kv.put(key, JSON.stringify(result), { expirationTtl: ttl });
  return result;
}
