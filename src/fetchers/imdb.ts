import type { TimelineEvent } from "../types";
import ratings from "../../data/imdb-ratings.json";

interface ImdbRating {
  title: string;
  rating: number;
  date: string;
  imdbId: string;
}

export function fetchImdb(): TimelineEvent[] {
  return (ratings as ImdbRating[]).map((r) => ({
    id: `imdb:${r.imdbId}:${r.date}`,
    date: new Date(r.date).toISOString(),
    source: "imdb" as const,
    title: `Rated "${r.title}" ${r.rating}/10`,
    url: `https://www.imdb.com/title/${r.imdbId}/`,
  }));
}
