import type { TimelineEvent } from "./types";

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

export function normalize(events: TimelineEvent[]): TimelineEvent[] {
  const cutoff = new Date(Date.now() - NINETY_DAYS_MS).toISOString();

  const seen = new Set<string>();
  return events
    .filter((e) => {
      if (e.date < cutoff || seen.has(e.id)) return false;
      seen.add(e.id);
      return true;
    })
    .sort((a, b) => b.date.localeCompare(a.date));
}
