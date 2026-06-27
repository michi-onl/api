import ratings from "../../data/imdb-ratings.json";
import type { TimelineEvent } from "../types";

interface ImdbRating {
  title: string;
  rating: number;
  date: string;
  imdbId: string;
}

export function fetchImdb(): TimelineEvent[] {
  const events: TimelineEvent[] = [];
  for (const r of ratings as ImdbRating[]) {
    const d = new Date(r.date);
    if (isNaN(d.getTime())) {
      console.log(
        `imdb: skipping rating with invalid date (${r.imdbId}): ${r.date}`,
      );
      continue;
    }
    events.push({
      id: `imdb:${r.imdbId}:${r.date}`,
      date: d.toISOString(),
      source: "imdb" as const,
      title: `Rated "${r.title}" ${r.rating}/10`,
      url: `https://www.imdb.com/title/${r.imdbId}/`,
    });
  }
  return events;
}
