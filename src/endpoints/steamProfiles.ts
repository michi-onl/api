import { contentJson, OpenAPIRoute } from "chanfana";
import { z } from "zod";
import * as cheerio from "cheerio";
import type { AppContext } from "../types";

const MAX_PROFILES = 8;
const MAX_GAMES = 10;
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";

const STEAM_PROFILE_RE = /^[a-zA-Z0-9_-]{2,32}$/;
const STEAM_APP_ID_RE = /\/app\/(\d+)/;
const WHITESPACE_RE = /\s+/;
const MINUTES_RE = /(\d+(?:\.\d+)?)\s*minutes?/;
const HOURS_RE = /(\d+(?:\.\d+)?)\s*(?:hrs?|hours?)/;
const DIGIT_RE = /(\d+)/;

const SteamGameSchema = z.object({
  name: z.string().describe("Game name"),
  hoursPlayed: z.string().describe("Hours played display text"),
  hoursPlayedNumeric: z.number().describe("Hours played as decimal"),
  lastPlayed: z.string().describe("Last played date text"),
  lastPlayedShort: z.string().describe("Short last played date"),
  appId: z.string().nullable().describe("Steam app ID"),
  iconUrl: z.string().nullable().describe("Game icon URL"),
});

const SteamProfileSchema = z.object({
  profileName: z.string().describe("Display name"),
  profileUrl: z.string().describe("Steam profile URL"),
  recentGames: z.array(SteamGameSchema),
  totalGames: z.number().nullable().describe("Total games owned"),
});

export class SteamProfiles extends OpenAPIRoute {
  schema = {
    tags: ["Gaming"],
    summary: "Steam profile recently played games",
    request: {
      query: z.object({
        profiles: z
          .string()
          .describe("Comma-separated Steam usernames (max 8)"),
      }),
    },
    responses: {
      "200": {
        description: "Steam profile data with recent games. Keys are profile usernames.",
        ...contentJson(z.record(z.string(), SteamProfileSchema)),
      },
      "400": { description: "Missing profiles parameter" },
    },
  };

  async handle(c: AppContext) {
    const profiles = c.req.query("profiles");
    if (!profiles) {
      return c.json(
        {
          error: "No profiles specified. Use ?profiles=username1,username2",
          example: "/api/steam-profiles?profiles=gaben,valve",
        },
        400,
      );
    }

    const profileList = profiles
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean)
      .slice(0, MAX_PROFILES);

    const settled = await Promise.allSettled(
      profileList.map((name) => fetchSteamProfile(name)),
    );

    const results: Record<string, unknown> = {};
    for (let i = 0; i < profileList.length; i++) {
      const r = settled[i];
      results[profileList[i]] =
        r.status === "fulfilled"
          ? r.value
          : {
              profileName: profileList[i],
              profileUrl: "",
              recentGames: [],
              totalGames: 0,
              error: "Failed to fetch profile",
            };
    }

    return c.json(results);
  }
}

async function fetchSteamProfile(profileName: string) {
  if (!STEAM_PROFILE_RE.test(profileName)) {
    return {
      profileName,
      profileUrl: "",
      recentGames: [],
      totalGames: 0,
      error: "Invalid profile name format",
    };
  }

  const profileUrl = `https://steamcommunity.com/id/${profileName}/`;
  const res = await fetch(profileUrl, {
    headers: { "User-Agent": USER_AGENT },
  });
  if (!res.ok) throw new Error(`Steam fetch failed: ${res.status}`);

  const $ = cheerio.load(await res.text());

  if ($(".profile_private_info").length) {
    return {
      profileName,
      profileUrl,
      recentGames: [],
      totalGames: 0,
      status: "private",
    };
  }

  const recentGames: Record<string, unknown>[] = [];

  $(".recent_game").each((_, el) => {
    const game = parseSteamGame($, $(el));
    if (game) recentGames.push(game);
  });

  // Fallback
  if (!recentGames.length) {
    $(".game_info_cap").each((_, el) => {
      const container = $(el).closest(".recent_game, .game_info_details");
      if (container.length) {
        const game = parseSteamGame($, container);
        if (game) recentGames.push(game);
      }
    });
  }

  let totalGames: number | null = null;
  const totalGamesElem = $(
    ".profile_item_links .profile_count_link_total",
  ).first();
  if (totalGamesElem.length) {
    const m = DIGIT_RE.exec(totalGamesElem.text());
    if (m) totalGames = parseInt(m[1], 10);
  }

  const actualNameElem = $(".actual_persona_name").first();
  let actualName = actualNameElem.text().trim() || null;
  if (!actualName) {
    const fallback = $(".profile_header .persona_name").first();
    actualName = fallback.text().trim() || profileName;
  }

  return {
    profileName: actualName,
    profileUrl,
    recentGames: recentGames.slice(0, MAX_GAMES),
    totalGames,
  };
}

function parseSteamGame(
  $: cheerio.CheerioAPI,
  $el: cheerio.Cheerio<cheerio.AnyNode>,
) {
  const nameLink =
    $el.find(".game_name a").first().length
      ? $el.find(".game_name a").first()
      : $el.find(".recent_game_content .game_name a").first();
  const name = nameLink.text().trim();

  let gameInfoText = $el.find(".game_info_details").first().text().trim();
  if (!gameInfoText)
    gameInfoText = $el
      .find(".recent_game_content .game_info_details")
      .first()
      .text()
      .trim();

  const parts = gameInfoText.split("last played on");
  const hoursPlayed = parts[0]?.trim() || "N/A";
  const lastPlayedShort = parts.length > 1 ? parts[1].trim() : "N/A";
  const hoursPlayedNumeric = parseHoursPlayed(hoursPlayed);
  const lastPlayed =
    lastPlayedShort !== "N/A"
      ? `last played on ${lastPlayedShort}`
      : "N/A";

  const gameLink =
    $el.find(".game_name a").first().length
      ? $el.find(".game_name a").first()
      : $el.find(".recent_game_content .game_name a").first();
  let appId: string | null = null;
  const href = gameLink.attr("href");
  if (href) {
    const m = STEAM_APP_ID_RE.exec(href);
    if (m) appId = m[1];
  }

  const iconImg = $el.find(".game_info_cap img").first().length
    ? $el.find(".game_info_cap img").first()
    : $el.find("img").first();
  const iconUrl = iconImg.attr("src") || null;

  if (!name) return null;

  return {
    name,
    hoursPlayed,
    hoursPlayedNumeric,
    lastPlayed,
    lastPlayedShort,
    appId,
    iconUrl,
  };
}

function parseHoursPlayed(text: string): number {
  if (!text) return 0;
  const clean = text.toLowerCase().replace(WHITESPACE_RE, " ").trim();

  if (clean.includes("minute")) {
    const m = MINUTES_RE.exec(clean);
    return m ? parseFloat(m[1]) / 60 : 0;
  }
  if (clean.includes("hour") || clean.includes("hr")) {
    const m = HOURS_RE.exec(clean);
    return m ? parseFloat(m[1]) : 0;
  }
  return 0;
}
