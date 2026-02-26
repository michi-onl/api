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
}

export async function fetchWikipedia(user: string): Promise<TimelineEvent[]> {
  const params = new URLSearchParams({
    action: "query",
    format: "json",
    list: "usercontribs",
    formatversion: "2",
    ucuser: user,
    uclimit: "50",
  });

  const res = await fetch(`https://de.wikipedia.org/w/api.php?${params}`, {
    headers: { "User-Agent": "timeline-worker/1.0" },
  });
  if (!res.ok) return [];

  const data: { query?: { usercontribs?: WikiContrib[] } } = await res.json();
  const contribs = data.query?.usercontribs ?? [];

  return contribs.map((c) => ({
    id: `wiki:${c.revid}`,
    date: c.timestamp,
    source: "wikipedia" as const,
    title: `Edited "${c.title}"`,
    url: `https://de.wikipedia.org/wiki/${encodeURIComponent(c.title)}`,
  }));
}
