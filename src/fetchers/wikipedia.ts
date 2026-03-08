import type { TimelineEvent } from "../types";

interface WikiContrib {
  userid: number;
  user: string;
  pageid: number;
  revid: number;
  parentid: number;
  ns: number;
  title: string;
  timestamp: string;
  new: boolean;
  minor: boolean;
  top: boolean;
  comment: string;
  size: number;
  sizediff: number;
}

export async function fetchWikipedia(user: string): Promise<TimelineEvent[]> {
  const params = new URLSearchParams({
    action: "query",
    format: "json",
    list: "usercontribs",
    formatversion: "2",
    ucuser: user,
    uclimit: "50",
    ucprop: "ids|title|timestamp|comment|size|sizediff|flags",
  });

  const res = await fetch(`https://de.wikipedia.org/w/api.php?${params}`, {
    headers: { "User-Agent": "timeline-worker/1.0" },
  });
  if (!res.ok) return [];

  const data: { query?: { usercontribs?: WikiContrib[] } } = await res.json();
  const contribs = data.query?.usercontribs ?? [];

  return contribs
    .filter((c) => c.ns === 0)
    .map((c) => {
      const summary = c.comment ? `: ${c.comment}` : "";
      const sizePrefix =
        c.sizediff > 0 ? `+${c.sizediff}` : String(c.sizediff);
      const label = c.minor ? "Minor edit" : "Edited";
      return {
        id: `wiki:${c.revid}`,
        date: c.timestamp,
        source: "wikipedia" as const,
        title: `${label} "${c.title}" (${sizePrefix})${summary}`,
        url: c.parentid
          ? `https://de.wikipedia.org/w/index.php?diff=${c.revid}&oldid=${c.parentid}`
          : `https://de.wikipedia.org/wiki/${encodeURIComponent(c.title)}`,
      };
    });
}
