import { contentJson, OpenAPIRoute } from "chanfana";
import { z } from "zod";
import * as cheerio from "cheerio";
import type { AppContext } from "../types";
import { cached } from "../cache";
import { safeInt } from "../utils";

const MAX_ITEMS = 25;
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";

const URLS: Record<string, string> = {
  movies: "https://www.imdb.com/chart/moviemeter/",
  tv_shows: "https://www.imdb.com/chart/tvmeter/",
};

const ImdbItemSchema = z.object({
  title: z.string().describe("Movie or show title (includes rank prefix)"),
  rank: z.number().describe("Popularity rank"),
  year: z.string().describe("Release year or range"),
  length: z.string().describe("Runtime"),
  age: z.string().describe("Age rating"),
  href: z.string().describe("IMDb URL"),
  rating: z.string().describe("IMDb rating"),
  numVotes: z.string().describe("Number of votes"),
  description: z.string().describe("Short synopsis"),
  image: z.string().describe("Poster/thumbnail URL"),
  genre: z.string().describe("Genre tags"),
});

const ImdbCategorySchema = z.object({
  data_title: z.string().describe("Category display name"),
  data_desc: z.string().describe("Category description"),
  data: z.array(ImdbItemSchema),
});

const ImdbResponseSchema = z.object({
  movies: ImdbCategorySchema,
  tv_shows: ImdbCategorySchema,
});

export class ImdbPopular extends OpenAPIRoute {
  schema = {
    tags: ["Movies & TV"],
    summary: "IMDb most popular movies and TV shows",
    responses: {
      "200": {
        description: "Popular movies and TV shows from IMDb",
        ...contentJson(ImdbResponseSchema),
      },
    },
  };

  async handle(c: AppContext) {
    const data = await cached(c.env.API_CACHE, "imdb-popular:v1", 1800, () =>
      fetchImdb(),
    );
    return c.json(data);
  }
}

async function fetchImdb() {
  const entries = Object.entries(URLS);
  const settled = await Promise.allSettled(
    entries.map(([key, url]) => fetchCategory(key, url)),
  );

  const results: Record<string, unknown> = {};
  for (let i = 0; i < entries.length; i++) {
    const [key] = entries[i];
    const r = settled[i];
    results[key] =
      r.status === "fulfilled"
        ? r.value
        : { error: "Failed to fetch data", data: [] };
  }
  return results;
}

const IMDB_TITLE_RE = /\/title\/(tt\d+)/;

interface JsonLdItem {
  "@type": string;
  url?: string;
  name?: string;
  description?: string;
  image?: string;
  genre?: string;
  aggregateRating?: { ratingValue?: number; ratingCount?: number };
  contentRating?: string;
  duration?: string;
}

async function fetchCategory(key: string, url: string) {
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT },
  });
  if (!res.ok) throw new Error(`IMDB ${key} fetch failed: ${res.status}`);

  const html = await res.text();
  const $ = cheerio.load(html);

  // Parse JSON-LD for rich metadata
  const jsonLdMap = new Map<string, JsonLdItem>();
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const data = JSON.parse($(el).text());
      if (data?.itemListElement) {
        for (const entry of data.itemListElement) {
          const item = entry?.item as JsonLdItem | undefined;
          if (item?.url) {
            const id = item.url.match(IMDB_TITLE_RE)?.[1];
            if (id) jsonLdMap.set(id, item);
          }
        }
      }
    } catch {}
  });

  const topItems: Record<string, unknown>[] = [];

  $("li.ipc-metadata-list-summary-item")
    .slice(0, MAX_ITEMS)
    .each((_, el) => {
      const $el = $(el);

      const title = $el.find("h3.ipc-title__text").text().trim() || "N/A";
      const rankText = $el.find("div.meter-const-ranking").text().trim();
      const rank = safeInt(rankText.split(" ")[0]);

      const metaItems = $el.find("span.cli-title-metadata-item");
      const year = (metaItems.eq(0).text().trim() || "N/A").replace(
        "\u2013",
        "-",
      );
      const length = metaItems.eq(1).text().trim() || "N/A";
      const age = metaItems.eq(2).text().trim() || "N/A";

      const ratingEl = $el.find("span.ipc-rating-star");
      let rating = "N/A";
      let numVotes = "N/A";
      if (ratingEl.length) {
        const ratingText = ratingEl.text();
        if (ratingText.includes("\xa0")) {
          const parts = ratingText.split("\xa0");
          rating = parts[0];
          numVotes = parts[1].replace(/[()]/g, "");
        } else {
          rating = ratingText;
        }
      }

      const hrefEl = $el.find("a.ipc-title-link-wrapper");
      let href = hrefEl.attr("href") || "N/A";
      if (href !== "N/A" && href.startsWith("/"))
        href = `https://www.imdb.com${href}`;

      // Enrich with JSON-LD data
      const titleId = href.match(IMDB_TITLE_RE)?.[1];
      const ld = titleId ? jsonLdMap.get(titleId) : undefined;

      topItems.push({
        title,
        rank,
        year,
        length,
        age: ld?.contentRating || age,
        href,
        rating: ld?.aggregateRating?.ratingValue?.toString() || rating,
        numVotes: ld?.aggregateRating?.ratingCount?.toLocaleString() || numVotes,
        description: ld?.description || "",
        image: ld?.image || "",
        genre: ld?.genre || "",
      });
    });

  const dataTitle =
    $("h1.ipc-title__text").first().text().trim() || `IMDb ${key}`;
  const dataDesc =
    $("div.ipc-title__description").first().text().trim() || "";

  return { data_title: dataTitle, data_desc: dataDesc, data: topItems };
}

