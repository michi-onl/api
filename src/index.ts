import { fromHono } from "chanfana";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { bearerAuth } from "hono/bearer-auth";
import type { Env } from "./types";
import { Timeline } from "./endpoints/timeline";
import { Billboard200 } from "./endpoints/billboard";
import { ImdbPopular } from "./endpoints/imdb";
import { SteamProfiles } from "./endpoints/steamProfiles";
import { HackerNews } from "./endpoints/hackernews";
import { GitHubReleases } from "./endpoints/githubReleases";
import { WikipediaWatchlist } from "./endpoints/wikipediaWatchlist";
import { Bookmarks } from "./endpoints/bookmarks";

const app = new Hono<{ Bindings: Env }>();

app.use(
  "*",
  cors({
    origin: (origin) => {
      if (origin === "https://www.michi.onl") return origin;
      if (origin.startsWith("http://localhost:") || origin.startsWith("http://127.0.0.1:")) return origin;
      return "https://www.michi.onl";
    },
    allowMethods: ["GET", "POST", "OPTIONS"],
  }),
);

app.use("/api/*", async (c, next) => {
  if (c.req.query("token") === c.env.API_TOKEN) return next();
  const auth = bearerAuth({ token: c.env.API_TOKEN });
  return auth(c, next);
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
      { name: "Music", description: "Billboard chart data" },
      { name: "Tech", description: "Hacker News and GitHub data" },
      { name: "Gaming", description: "Steam profile data" },
      { name: "Movies & TV", description: "IMDb ratings and watchlist" },
      { name: "Timeline", description: "Aggregated timeline events" },
      { name: "Wikipedia", description: "Wikipedia watchlist data" },
      { name: "Bookmarks", description: "Linkding bookmarks" },
    ],
  },
});

openapi.get("/api/timeline", Timeline);
openapi.get("/api/billboard-200", Billboard200);
openapi.get("/api/imdb", ImdbPopular);
openapi.get("/api/steam-profiles", SteamProfiles);
openapi.get("/api/hackernews", HackerNews);
openapi.get("/api/github-releases", GitHubReleases);
openapi.post("/api/wikipedia-watchlist", WikipediaWatchlist);
openapi.get("/api/bookmarks", Bookmarks);

export default app;
