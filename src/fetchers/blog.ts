import type { TimelineEvent } from "../types";

export async function fetchBlog(feedUrl: string): Promise<TimelineEvent[]> {
  const res = await fetch(feedUrl, {
    headers: { "User-Agent": "timeline-worker/1.0" },
  });
  if (!res.ok) return [];

  const xml = await res.text();
  const entries: TimelineEvent[] = [];

  const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
  let match;

  while ((match = entryRegex.exec(xml)) !== null) {
    const block = match[1];
    const title = block.match(/<title[^>]*>([\s\S]*?)<\/title>/)?.[1]?.trim() ?? "";
    const id = block.match(/<id>([\s\S]*?)<\/id>/)?.[1]?.trim() ?? "";
    const updated = block.match(/<updated>([\s\S]*?)<\/updated>/)?.[1]?.trim() ?? "";

    const linkMatch =
      block.match(/<link[^>]*rel="alternate"[^>]*href="([^"]*)"[^>]*\/>/) ||
      block.match(/<link[^>]*href="([^"]*)"[^>]*rel="alternate"[^>]*\/>/) ||
      block.match(/<link[^>]*href="([^"]*)"[^>]*\/>/);
    const link = linkMatch?.[1] ?? "";

    if (title && updated) {
      entries.push({
        id: `blog:${id}`,
        date: updated,
        source: "blog",
        title: `Published "${title}"`,
        url: link || id,
      });
    }
  }

  return entries;
}
