export function safeInt(text: string, fallback = 0): number {
  const n = parseInt(text.replace(/,/g, "").trim(), 10);
  return isNaN(n) ? fallback : n;
}

export function formatTimeAgo(isoDate: string): string {
  const dt = new Date(isoDate);
  if (isNaN(dt.getTime())) return "unknown";

  const seconds = Math.floor((Date.now() - dt.getTime()) / 1000);
  if (seconds < 0) return "just now";

  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(seconds / 3600);
  const days = Math.floor(seconds / 86400);

  if (minutes < 1) return "just now";
  if (hours < 1) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 30) {
    const weeks = Math.floor(days / 7);
    return `${weeks} week${weeks > 1 ? "s" : ""} ago`;
  }
  if (days < 365) {
    const months = Math.floor(days / 30);
    return `${months} month${months > 1 ? "s" : ""} ago`;
  }
  const years = Math.floor(days / 365);
  return `${years} year${years > 1 ? "s" : ""} ago`;
}

const MAX_KEY_LENGTH = 480;

export function makeCacheKey(namespace: string, ...parts: string[]): string {
  const raw = `${namespace}:${parts.join(":")}`;
  if (raw.length <= MAX_KEY_LENGTH) return raw;

  let hash = 5381;
  for (let i = 0; i < raw.length; i++) {
    hash = ((hash << 5) + hash) + raw.charCodeAt(i);
  }
  const hashHex = (hash >>> 0).toString(16);
  return `${namespace}:hash:${hashHex}`;
}
