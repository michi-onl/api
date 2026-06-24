import { fromHono } from "chanfana";
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Env } from "./types";
import { Timeline } from "./endpoints/timeline";
import { Billboard200 } from "./endpoints/billboard";
import { TmdbTrending } from "./endpoints/tmdb";
import { SteamProfiles } from "./endpoints/steamProfiles";
import { HackerNews } from "./endpoints/hackernews";
import { GitHubReleases } from "./endpoints/githubReleases";
import { WikipediaWatchlist } from "./endpoints/wikipediaWatchlist";
import { Bookmarks } from "./endpoints/bookmarks";
import { DhbwTimetable } from "./endpoints/dhbwTimetable";

const app = new Hono<{ Bindings: Env }>();

app.use(
  "*",
  cors({
    origin: (origin) => {
      if (!origin) return null;
      if (origin === "https://www.michi.onl") return origin;
      if (origin.startsWith("http://localhost:") || origin.startsWith("http://127.0.0.1:")) return origin;
      return null;
    },
    allowMethods: ["GET", "POST", "OPTIONS"],
  }),
);

app.use("*", async (c, next) => {
  const start = Date.now();
  await next();
  const duration = Date.now() - start;
  console.log(`${c.req.method} ${c.req.path} ${c.res.status} ${duration}ms`);
});

app.get("/health", (c) =>
  c.json({ status: "ok", timestamp: new Date().toISOString() }),
);

app.use("/api/*", async (c, next) => {
  const token = c.env.API_TOKEN;
  if (!token) {
    return c.json({ error: "Server misconfiguration: API_TOKEN not set" }, 500);
  }
  if (c.req.query("token") === token) return next();
  const header = c.req.header("Authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (match && match[1] === token) return next();
  return c.json({ error: "Unauthorized" }, 401);
});

const openapi = fromHono(app, {
  docs_url: "/",
  schema: {
    info: {
      title: "michi.onl API",
      version: "1.0.0",
      description:
        "Personal API powering michi.onl — aggregates data from Billboard, Hacker News, GitHub, Steam, IMDb, Wikipedia, and more.",
    },
    servers: [
      {
        url: "https://api.michi.onl",
        description: "Production",
      },
    ],
    security: [{ bearerAuth: [] }],
    // @ts-expect-error chanfana omits `components` from schema type but passes it through at runtime
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
        },
      },
    },
    tags: [
      { name: "Media & Entertainment", description: "Music charts, movies, TV, and gaming data" },
      { name: "Development & Tech", description: "Developer news and open-source releases" },
      { name: "Knowledge & Education", description: "Wikipedia and course data" },
      { name: "Personal Aggregation", description: "Cross-source timelines and bookmarks" },
    ],
  },
});

openapi.get("/api/timeline", Timeline);
openapi.get("/api/billboard-200", Billboard200);
openapi.get("/api/imdb", TmdbTrending);
openapi.get("/api/steam-profiles", SteamProfiles);
openapi.get("/api/hackernews", HackerNews);
openapi.get("/api/github-releases", GitHubReleases);
openapi.post("/api/wikipedia-watchlist", WikipediaWatchlist);
openapi.get("/api/bookmarks", Bookmarks);
openapi.get("/api/dhbw-timetable", DhbwTimetable);

export default app;
