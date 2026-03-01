import { contentJson, OpenAPIRoute } from "chanfana";
import { z } from "zod";
import * as cheerio from "cheerio";
import type { AppContext } from "../types";
import { cached } from "../cache";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";
const WIKI_LANG_RE = /^[a-z]{2,3}$/;
const WIKI_USERNAME_RE = /^[a-zA-Z][a-zA-Z0-9_-]{0,254}$/;

const WikiEditSchema = z.object({
  title: z.string().describe("Article title"),
  link: z.string().describe("Diff URL"),
  description: z.string().describe("Edit summary HTML"),
  creator: z.string().describe("Editor username"),
  publishedAt: z.string().describe("RFC 2822 publish date"),
  timeAgo: z.string().describe("Human-readable time since edit"),
  language: z.string().describe("Wikipedia language code"),
});

const WikiResponseSchema = z.object({
  source: z.string(),
  count: z.number().describe("Number of edits returned"),
  edits: z.array(WikiEditSchema),
  errors: z.array(z.object({
    language: z.string(),
    error: z.string(),
  })).nullable().describe("Errors per language, or null if none"),
});

export class WikipediaWatchlist extends OpenAPIRoute {
  schema = {
    tags: ["Wikipedia"],
    summary: "Wikipedia watchlist recent edits (POST to protect tokens)",
    request: {
      body: {
        content: {
          "application/x-www-form-urlencoded": {
            schema: z.object({
              usernames: z
                .string()
                .describe(
                  'Format "lang:username,lang2:username2" e.g. "de:Mike_is_Michi"',
                ),
              tokens: z
                .string()
                .describe(
                  'Format "lang:token,lang2:token2" (watchlist tokens)',
                ),
              languages: z.string().default("en").describe("Comma-separated language codes"),
              hours: z.coerce.number().default(72).describe("Hours back to fetch"),
              limit: z.coerce.number().default(10).describe("Max edits per language"),
            }),
          },
        },
      },
    },
    responses: {
      "200": {
        description: "Watchlist edits",
        ...contentJson(WikiResponseSchema),
      },
      "400": { description: "Missing required parameters" },
    },
  };

  async handle(c: AppContext) {
    const body = await c.req.parseBody();
    const usernames = body.usernames as string | undefined;
    const tokens = body.tokens as string | undefined;
    const languages = (body.languages as string) || "en";
    const hours = clamp(Number(body.hours) || 72, 1, 720);
    const limit = clamp(Number(body.limit) || 10, 1, 50);

    if (!usernames || !tokens) {
      return c.json(
        {
          error:
            "Missing required parameters. Provide usernames and tokens in POST body.",
          example:
            "POST with body: usernames=de:Mike_is_Michi&tokens=de:abc123&languages=de",
        },
        400,
      );
    }

    const usernameDict = parseKV(usernames);
    const tokenDict = parseKV(tokens);

    // Validate all entries
    for (const [lang, user] of Object.entries(usernameDict)) {
      if (!WIKI_LANG_RE.test(lang))
        return c.json({ error: `Invalid language code: ${lang}` }, 400);
      if (!WIKI_USERNAME_RE.test(user))
        return c.json({ error: `Invalid username format: ${user}` }, 400);
    }
    for (const lang of Object.keys(tokenDict)) {
      if (!WIKI_LANG_RE.test(lang))
        return c.json({ error: `Invalid language code: ${lang}` }, 400);
    }

    const langList = languages.split(",").map((l) => l.trim()).filter(Boolean);

    const cacheKey = `wiki:${[...langList].sort().join(",")}_${Object.keys(usernameDict).sort().join(",")}_${hours}_${limit}`;
    const data = await cached(c.env.API_CACHE, cacheKey, 3600, async () => {
      const allEdits: Record<string, unknown>[] = [];
      const errors: Record<string, unknown>[] = [];

      const settled = await Promise.allSettled(
        langList.map((lang) =>
          fetchWatchlist(lang, usernameDict[lang], tokenDict[lang], hours, limit),
        ),
      );

      for (let i = 0; i < langList.length; i++) {
        const r = settled[i];
        if (r.status === "fulfilled") {
          allEdits.push(...r.value);
        } else {
          errors.push({
            language: langList[i],
            error: `Failed to fetch ${langList[i]} watchlist`,
          });
        }
      }

      // Sort by published date descending
      allEdits.sort((a, b) => {
        const da = a.publishedAt as string;
        const db = b.publishedAt as string;
        if (!da || !db) return 0;
        return db.localeCompare(da);
      });

      return {
        source: "Wikipedia Watchlist",
        count: allEdits.length,
        edits: allEdits.slice(0, limit),
        errors: errors.length ? errors : null,
      };
    });

    return c.json(data);
  }
}

async function fetchWatchlist(
  lang: string,
  username: string | undefined,
  token: string | undefined,
  hours: number,
  limit: number,
): Promise<Record<string, unknown>[]> {
  if (!username || !token) return [];

  const params = new URLSearchParams({
    action: "feedwatchlist",
    allrev: "",
    wlowner: username,
    wltoken: token,
    hours: String(hours),
    wlexcludeuser: username,
  });

  const res = await fetch(
    `https://${lang}.wikipedia.org/w/api.php?${params}`,
    { headers: { "User-Agent": USER_AGENT } },
  );
  if (!res.ok) throw new Error(`Wiki ${lang} fetch failed: ${res.status}`);

  const xml = await res.text();
  const $ = cheerio.load(xml, { xmlMode: true });

  const edits: Record<string, unknown>[] = [];
  $("item")
    .slice(0, limit)
    .each((_, el) => {
      const $item = $(el);
      const title = $item.find("title").text().trim() || "N/A";
      const link = $item.find("link").text().trim() || "";
      const description = $item.find("description").text().trim() || "";
      const pubDateStr = $item.find("pubDate").text().trim() || "";
      const creator =
        $item.find("dc\\:creator, creator").text().trim() || "N/A";

      const timeAgo = pubDateStr ? formatTimeAgo(pubDateStr) : "unknown";

      edits.push({
        title,
        link,
        description,
        creator,
        publishedAt: pubDateStr,
        timeAgo,
        language: lang,
      });
    });

  return edits;
}

function parseKV(input: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const entry of input.split(",")) {
    const idx = entry.indexOf(":");
    if (idx > 0) {
      result[entry.slice(0, idx).trim()] = entry.slice(idx + 1).trim();
    }
  }
  return result;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function formatTimeAgo(dateStr: string): string {
  const dt = new Date(dateStr);
  if (isNaN(dt.getTime())) return "unknown";

  const seconds = Math.floor((Date.now() - dt.getTime()) / 1000);
  if (seconds < 0) return "just now";

  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(seconds / 3600);
  const days = Math.floor(seconds / 86400);

  if (minutes < 1) return "just now";
  if (hours < 1) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 30) {
    const weeks = Math.floor(days / 7);
    return `${weeks} week${weeks > 1 ? "s" : ""} ago`;
  }
  if (days < 365) {
    const months = Math.floor(days / 30);
    return `${months} month${months > 1 ? "s" : ""} ago`;
  }
  const years = Math.floor(days / 365);
  return `${years} year${years > 1 ? "s" : ""} ago`;
}
