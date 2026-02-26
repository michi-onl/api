import { fromHono } from "chanfana";
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Env } from "./types";
import { Timeline } from "./endpoints/timeline";
import { Billboard200 } from "./endpoints/billboard";
import { ImdbPopular } from "./endpoints/imdb";
import { SteamProfiles } from "./endpoints/steamProfiles";
import { HackerNews } from "./endpoints/hackernews";
import { GitHubReleases } from "./endpoints/githubReleases";
import { WikipediaWatchlist } from "./endpoints/wikipediaWatchlist";

const app = new Hono<{ Bindings: Env }>();

app.use(
  "*",
  cors({
    origin: "https://www.michi.onl",
    allowMethods: ["GET", "POST", "OPTIONS"],
  }),
);

const openapi = fromHono(app, { docs_url: "/" });

openapi.get("/api/timeline", Timeline);
openapi.get("/api/billboard-200", Billboard200);
openapi.get("/api/imdb", ImdbPopular);
openapi.get("/api/steam-profiles", SteamProfiles);
openapi.get("/api/hackernews", HackerNews);
openapi.get("/api/github-releases", GitHubReleases);
openapi.post("/api/wikipedia-watchlist", WikipediaWatchlist);

export default app;
