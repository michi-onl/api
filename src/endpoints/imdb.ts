import { OpenAPIRoute } from "chanfana";
import * as cheerio from "cheerio";
import type { AppContext } from "../types";
import { cached } from "../cache";

const MAX_ITEMS = 25;
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";

const URLS: Record<string, string> = {
  movies: "https://www.imdb.com/chart/moviemeter/",
  tv_shows: "https://www.imdb.com/chart/tvmeter/",
};

export class ImdbPopular extends OpenAPIRoute {
  schema = {
    tags: ["Entertainment"],
    summary: "IMDb most popular movies and TV shows",
    responses: {
      "200": { description: "Popular movies and TV shows from IMDb" },
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

async function fetchCategory(key: string, url: string) {
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT },
  });
  if (!res.ok) throw new Error(`IMDB ${key} fetch failed: ${res.status}`);

  const $ = cheerio.load(await res.text());
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

      topItems.push({ title, rank, year, length, age, href, rating, numVotes });
    });

  const dataTitle =
    $("h1.ipc-title__text").first().text().trim() || `IMDb ${key}`;
  const dataDesc =
    $("div.ipc-title__description").first().text().trim() || "";

  return { data_title: dataTitle, data_desc: dataDesc, data: topItems };
}

function safeInt(text: string, fallback = 0): number {
  const n = parseInt(text.replace(/,/g, "").trim(), 10);
  return isNaN(n) ? fallback : n;
}
