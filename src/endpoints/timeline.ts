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
  source: z
    .enum(["github", "wikipedia", "blog", "gallery", "imdb"])
    .describe("Event source"),
  title: z.string().describe("Event title"),
  url: z.string().describe("Event URL"),
});

export class Timeline extends OpenAPIRoute {
  schema = {
    tags: ["Personal Aggregation"],
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
    const { query } = await this.getValidatedData<typeof this.schema>();
    const category = query.category;

    const cacheKey = category ? `timeline:v1:${category}` : "timeline:v1";

    const events = await cached(
      env.API_CACHE,
      cacheKey,
      900,
      async () => {
        const mediaFetchers = [
          fetchBlog(env.BLOG_FEED),
          fetchGallery(),
          Promise.resolve().then(() => fetchImdb()),
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

        const events = normalize(
          results.flatMap((r) => (r.status === "fulfilled" ? r.value : [])),
        );

        return events;
      },
      (result) => result.length > 0,
    );

    return c.json(events);
  }
}
