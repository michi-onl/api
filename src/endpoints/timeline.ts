import { contentJson, OpenAPIRoute } from "chanfana";
import { z } from "zod";
import type { AppContext } from "../types";
import { cached } from "../cache";
import { fetchGitHub } from "../fetchers/github";
import { fetchWikipedia } from "../fetchers/wikipedia";
import { fetchBlog } from "../fetchers/blog";
import { fetchGallery } from "../fetchers/gallery";
import { fetchImdb } from "../fetchers/imdb";
import { normalize } from "../normalize";

const TimelineEventSchema = z.object({
  id: z.string().describe("Unique event identifier"),
  date: z.string().describe("ISO 8601 date"),
  source: z.enum(["github", "wikipedia", "blog", "gallery", "imdb"]).describe("Event source"),
  title: z.string().describe("Event title"),
  url: z.string().describe("Event URL"),
});

export class Timeline extends OpenAPIRoute {
  schema = {
    tags: ["Timeline"],
    summary: "Aggregated timeline events from multiple sources",
    request: {
      query: z.object({
        category: z
          .enum(["media", "contributions"])
          .optional()
          .describe(
            "Filter by category: media (blog, gallery, imdb) or contributions (github, wikipedia). Omit for all sources.",
          ),
      }),
    },
    responses: {
      "200": {
        description: "Timeline events sorted by date descending",
        ...contentJson(z.array(TimelineEventSchema)),
      },
    },
  };

  async handle(c: AppContext) {
    const env = c.env;
    const category = c.req.query("category") as
      | "media"
      | "contributions"
      | undefined;

    const cacheKey = category
      ? `timeline:v1:${category}`
      : "timeline:v1";

    const events = await cached(env.API_CACHE, cacheKey, 900, async () => {
      const mediaFetchers = [
        fetchBlog(env.BLOG_FEED),
        fetchGallery(),
        Promise.resolve(fetchImdb()),
      ];
      const contribFetchers = [
        fetchGitHub(env.GITHUB_USER, env.GITHUB_TOKEN),
        fetchWikipedia(env.WIKI_USER),
      ];

      const chosen =
        category === "media"
          ? mediaFetchers
          : category === "contributions"
            ? contribFetchers
            : [...contribFetchers, ...mediaFetchers];

      const results = await Promise.allSettled(chosen);

      return normalize(
        results.flatMap((r) => (r.status === "fulfilled" ? r.value : [])),
      );
    });

    return c.json(events);
  }
}
