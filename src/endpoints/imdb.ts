import { contentJson, OpenAPIRoute } from "chanfana";
import { z } from "zod";
import type { AppContext } from "../types";
import { cached } from "../cache";

const MAX_ITEMS = 25;

const TmdbItemSchema = z.object({
  title: z.string().describe("Movie or show title"),
  rank: z.number().describe("Trending rank"),
  year: z.string().describe("Release year or first air date year"),
  rating: z.string().describe("TMDB vote average"),
  numVotes: z.string().describe("Number of votes"),
  description: z.string().describe("Overview / synopsis"),
  image: z.string().describe("Poster URL"),
  href: z.string().describe("TMDB URL"),
  genre: z.string().describe("Genre names"),
});

const TmdbCategorySchema = z.object({
  data_title: z.string().describe("Category display name"),
  data_desc: z.string().describe("Category description"),
  data: z.array(TmdbItemSchema),
});

const TmdbResponseSchema = z.object({
  movies: TmdbCategorySchema,
  tv_shows: TmdbCategorySchema,
});

const GENRE_MAP: Record<number, string> = {
  28: "Action", 12: "Adventure", 16: "Animation", 35: "Comedy", 80: "Crime",
  99: "Documentary", 18: "Drama", 10751: "Family", 14: "Fantasy", 36: "History",
  27: "Horror", 10402: "Music", 9648: "Mystery", 10749: "Romance",
  878: "Science Fiction", 10770: "TV Movie", 53: "Thriller", 10752: "War",
  37: "Western", 10759: "Action & Adventure", 10762: "Kids", 10763: "News",
  10764: "Reality", 10765: "Sci-Fi & Fantasy", 10766: "Soap", 10767: "Talk",
  10768: "War & Politics",
};

interface TmdbResult {
  id: number;
  title?: string;
  name?: string;
  release_date?: string;
  first_air_date?: string;
  vote_average?: number;
  vote_count?: number;
  overview?: string;
  poster_path?: string;
  genre_ids?: number[];
}

export class ImdbPopular extends OpenAPIRoute {
  schema = {
    tags: ["Movies & TV"],
    summary: "Trending movies and TV shows (via TMDB)",
    responses: {
      "200": {
        description: "Trending movies and TV shows",
        ...contentJson(TmdbResponseSchema),
      },
    },
  };

  async handle(c: AppContext) {
    const token = c.env.TMDB_TOKEN;
    const data = await cached(c.env.API_CACHE, "tmdb-trending:v1", 1800, () =>
      fetchTrending(token),
    );
    return c.json(data);
  }
}

async function fetchTrending(token: string) {
  const [movies, tvShows] = await Promise.allSettled([
    fetchCategory("movie", token),
    fetchCategory("tv", token),
  ]);

  return {
    movies:
      movies.status === "fulfilled"
        ? movies.value
        : { data_title: "Trending Movies", data_desc: "", data: [] },
    tv_shows:
      tvShows.status === "fulfilled"
        ? tvShows.value
        : { data_title: "Trending TV Shows", data_desc: "", data: [] },
  };
}

const IMG_BASE = "https://image.tmdb.org/t/p/w500";

async function fetchCategory(type: "movie" | "tv", token: string) {
  const res = await fetch(
    `https://api.themoviedb.org/3/trending/${type}/week?language=en-US`,
    { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } },
  );
  if (!res.ok) throw new Error(`TMDB ${type} fetch failed: ${res.status}`);

  const json = (await res.json()) as { results: TmdbResult[] };
  const items = json.results.slice(0, MAX_ITEMS).map((item, i) => {
    const title = item.title || item.name || "Unknown";
    const date = item.release_date || item.first_air_date || "";
    const year = date ? date.slice(0, 4) : "N/A";
    const genres = (item.genre_ids || [])
      .map((id) => GENRE_MAP[id])
      .filter(Boolean)
      .join(", ");
    return {
      title,
      rank: i + 1,
      year,
      rating: item.vote_average?.toFixed(1) || "N/A",
      numVotes: item.vote_count?.toLocaleString() || "N/A",
      description: item.overview || "",
      image: item.poster_path ? `${IMG_BASE}${item.poster_path}` : "",
      href: `https://www.themoviedb.org/${type}/${item.id}`,
      genre: genres,
    };
  });

  const label = type === "movie" ? "Trending Movies" : "Trending TV Shows";
  return { data_title: label, data_desc: "Updated weekly", data: items };
}
