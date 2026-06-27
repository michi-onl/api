import { contentJson, OpenAPIRoute } from "chanfana";
import { z } from "zod";
import * as cheerio from "cheerio";
import type { AppContext } from "../types";
import { cached } from "../cache";
import { safeInt } from "../utils";

const MAX_ITEMS = 6;
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";

const BillboardItemSchema = z.object({
  position: z.number().describe("Chart position"),
  title: z.string().describe("Album title"),
  artist: z.string().describe("Artist name"),
  cover: z.string().describe("Album cover image URL"),
  last_week: z.number().describe("Position last week (0 if new)"),
  peak: z.number().describe("Peak chart position"),
  weeks: z.number().describe("Weeks on chart"),
});

const BillboardResponseSchema = z.object({
  music: z.object({
    data_title: z.string().describe("Chart name"),
    data_desc: z.string().describe("Chart description"),
    data: z.array(BillboardItemSchema),
  }),
});

export class Billboard200 extends OpenAPIRoute {
  schema = {
    tags: ["Media & Entertainment"],
    summary: "Billboard 200 chart top entries",
    responses: {
      "200": {
        description: "Billboard 200 chart data",
        ...contentJson(BillboardResponseSchema),
      },
    },
  };

  async handle(c: AppContext) {
    const data = await cached(
      c.env.API_CACHE,
      "billboard:v1",
      1800,
      () => fetchBillboard(),
      (result) => result.music.data.length > 0,
    );
    return c.json(data);
  }
}

const EMPTY_BILLBOARD = {
  music: {
    data_title: "Billboard 200",
    data_desc: "",
    data: [] as z.infer<typeof BillboardItemSchema>[],
  },
};

async function fetchBillboard() {
  let res: Response;
  try {
    res = await fetch("https://www.billboard.com/charts/billboard-200/", {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(10000),
    });
  } catch (e) {
    console.log(`Billboard fetch error: ${e}`);
    return EMPTY_BILLBOARD;
  }
  if (!res.ok) {
    console.log(`Billboard fetch failed: ${res.status}`);
    return EMPTY_BILLBOARD;
  }

  const $ = cheerio.load(await res.text());
  const topItems: z.infer<typeof BillboardItemSchema>[] = [];
  const seen = new Set<string>();

  $("div.o-chart-results-list-row-container")
    .slice(0, MAX_ITEMS)
    .each((idx, row) => {
      const $row = $(row);

      const positionElem = $row.find(
        "li.o-chart-results-list__item span.c-label.a-font-basic",
      );
      const position = positionElem.length
        ? safeInt(positionElem.text())
        : idx + 1;

      const col4 = $row.find("li.lrv-u-width-100p").first();
      if (!col4.length) return;

      const title = col4.find("h3.c-title").text().trim() || "N/A";
      const artistLink = col4.find("span.c-label a");
      const artist = artistLink.length
        ? artistLink.text().trim()
        : col4.find("span.c-label").first().text().trim() || "N/A";

      let lastWeek = 0;
      let peak = 0;
      let weeks = 0;

      $row
        .find("div.lrv-u-flex.lrv-u-justify-content-space-between")
        .each((_, div) => {
          const $div = $(div);
          const label = $div.find("span.c-span.a-font-secondary").text().trim();
          const value = $div
            .find("li.o-chart-results-list__item span.c-label")
            .text()
            .trim();

          if (label === "LW")
            lastWeek = value === "-" || value === "NEW" ? 0 : safeInt(value);
          else if (label === "PEAK") peak = safeInt(value);
          else if (label === "WEEKS") weeks = safeInt(value);
        });

      // Extract cover art: prefer data-lazy-src, fall back to src, skip fallback GIFs
      let cover = "";
      const coverImg = $row.find("img.c-lazy-image__img").first();
      if (coverImg.length) {
        const lazySrc = coverImg.attr("data-lazy-src") || "";
        const src = coverImg.attr("src") || "";
        const candidate = lazySrc || src;
        if (candidate && !candidate.includes("lazyload-fallback"))
          cover = candidate;
      }

      const key = `${title}|${artist}`;
      if (title && artist && !seen.has(key)) {
        seen.add(key);
        topItems.push({
          position,
          title,
          artist,
          cover,
          last_week: lastWeek,
          peak,
          weeks,
        });
      }
    });

  const dataTitle = $("h1.c-heading").first().text().trim() || "Billboard 200";
  const dataDesc = $("p.c-tagline").first().text().trim() || "";

  return {
    music: { data_title: dataTitle, data_desc: dataDesc, data: topItems },
  };
}
