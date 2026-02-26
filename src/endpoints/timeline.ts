import { OpenAPIRoute } from "chanfana";
import type { AppContext } from "../types";
import { cached } from "../cache";
import { fetchGitHub } from "../fetchers/github";
import { fetchWikipedia } from "../fetchers/wikipedia";
import { fetchBlog } from "../fetchers/blog";
import { fetchGallery } from "../fetchers/gallery";
import { fetchImdb } from "../fetchers/imdb";
import { normalize } from "../normalize";

export class Timeline extends OpenAPIRoute {
  schema = {
    tags: ["Timeline"],
    summary: "Aggregated timeline events from multiple sources",
    responses: {
      "200": { description: "Timeline events sorted by date descending" },
    },
  };

  async handle(c: AppContext) {
    const env = c.env;

    const events = await cached(env.API_CACHE, "timeline:v1", 900, async () => {
      const results = await Promise.allSettled([
        fetchGitHub(env.GITHUB_USER),
        fetchWikipedia(env.WIKI_USER),
        fetchBlog(env.BLOG_FEED),
        fetchGallery(),
        Promise.resolve(fetchImdb()),
      ]);

      return normalize(
        results.flatMap((r) => (r.status === "fulfilled" ? r.value : [])),
      );
    });

    return c.json(events);
  }
}
