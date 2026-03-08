import { contentJson, OpenAPIRoute } from "chanfana";
import { z } from "zod";
import type { AppContext } from "../types";
import { cached } from "../cache";

const LINKDING_URL = "https://linkding.michi.onl";

const BookmarkSchema = z.object({
  id: z.number().describe("Bookmark ID"),
  url: z.string().describe("Bookmarked URL"),
  title: z.string().describe("Bookmark title"),
  description: z.string().describe("Bookmark description"),
  tags: z.array(z.string()).describe("Tags"),
  date_added: z.string().describe("Date added (ISO 8601)"),
});

const BookmarksResponseSchema = z.object({
  source: z.string(),
  url: z.string(),
  count: z.number().describe("Number of bookmarks returned"),
  bookmarks: z.array(BookmarkSchema),
});

export class Bookmarks extends OpenAPIRoute {
  schema = {
    tags: ["Bookmarks"],
    summary: "Recent Linkding bookmarks",
    responses: {
      "200": {
        description: "Most recent 10 bookmarks from Linkding",
        ...contentJson(BookmarksResponseSchema),
      },
    },
  };

  async handle(c: AppContext) {
    const data = await cached(c.env.API_CACHE, "bookmarks:v1", 600, () =>
      fetchBookmarks(c.env.LINKDING_TOKEN),
    );
    return c.json(data);
  }
}

async function fetchBookmarks(token: string) {
  const apiUrl = `${LINKDING_URL}/api/bookmarks/?limit=10&format=json`;
  const res = await fetch(apiUrl, {
    headers: { Authorization: `Token ${token}` },
  });
  if (!res.ok) throw new Error(`Linkding fetch failed: ${res.status}`);

  const data = (await res.json()) as { results: Record<string, unknown>[] };

  const bookmarks = data.results.map((b: Record<string, unknown>) => ({
    id: b.id,
    url: b.url,
    title: (b.title as string) || (b.website_title as string) || "",
    description: (b.description as string) || (b.website_description as string) || "",
    tags: b.tag_names,
    date_added: b.date_added,
  }));

  return {
    source: "Linkding",
    url: LINKDING_URL,
    count: bookmarks.length,
    bookmarks,
  };
}
