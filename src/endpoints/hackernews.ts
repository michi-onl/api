import { contentJson, OpenAPIRoute } from "chanfana";
import { z } from "zod";
import * as cheerio from "cheerio";
import type { AppContext } from "../types";
import { cached } from "../cache";

const MAX_STORIES = 10;
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";
const DIGIT_RE = /(\d+)/;

const HNStorySchema = z.object({
  id: z.string().describe("Hacker News story ID"),
  title: z.string().describe("Story title"),
  url: z.string().describe("Story URL"),
  domain: z.string().describe("Source domain"),
  points: z.number().describe("Upvote count"),
  author: z.string().describe("Author username"),
  timePosted: z.string().describe("Relative time since posted"),
  numComments: z.number().describe("Number of comments"),
  hnUrl: z.string().describe("Hacker News discussion URL"),
});

const HNResponseSchema = z.object({
  source: z.string(),
  url: z.string(),
  count: z.number().describe("Number of stories returned"),
  stories: z.array(HNStorySchema),
});

export class HackerNews extends OpenAPIRoute {
  schema = {
    tags: ["Tech"],
    summary: "Hacker News best stories",
    responses: {
      "200": {
        description: "Top stories from Hacker News",
        ...contentJson(HNResponseSchema),
      },
    },
  };

  async handle(c: AppContext) {
    const data = await cached(c.env.API_CACHE, "hn:v1", 600, () =>
      fetchHN(),
    );
    return c.json(data);
  }
}

async function fetchHN() {
  const url = "https://news.ycombinator.com/best";
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT },
  });
  if (!res.ok) throw new Error(`HN fetch failed: ${res.status}`);

  const $ = cheerio.load(await res.text());
  const stories: Record<string, unknown>[] = [];

  $("tr.athing")
    .slice(0, MAX_STORIES)
    .each((_, el) => {
      const $story = $(el);
      const storyId = $story.attr("id") || "";

      const titleCell = $story.find("span.titleline > a").first();
      const title = titleCell.text().trim() || "N/A";
      let storyUrl = titleCell.attr("href") || "";
      if (storyUrl && !storyUrl.startsWith("http"))
        storyUrl = `https://news.ycombinator.com/${storyUrl}`;

      const domain = $story.find("span.sitestr").text().trim() || "";

      const subtextRow = $story.next("tr");
      const subtext = subtextRow.find("td.subtext");

      const scoreSpan = subtext.find("span.score");
      let points = 0;
      if (scoreSpan.length) {
        const m = DIGIT_RE.exec(scoreSpan.text());
        if (m) points = parseInt(m[1], 10);
      }

      const author = subtext.find("a.hnuser").text().trim() || "N/A";
      const timePosted = subtext.find("span.age").text().trim() || "N/A";

      let numComments = 0;
      const links = subtext.find("a");
      const lastLink = links.last();
      if (lastLink.length && lastLink.text().toLowerCase().includes("comment")) {
        const m = DIGIT_RE.exec(lastLink.text());
        if (m) numComments = parseInt(m[1], 10);
      }

      const hnUrl = storyId
        ? `https://news.ycombinator.com/item?id=${storyId}`
        : "";

      stories.push({
        id: storyId,
        title,
        url: storyUrl,
        domain,
        points,
        author,
        timePosted,
        numComments,
        hnUrl,
      });
    });

  return { source: "Hacker News", url, count: stories.length, stories };
}
