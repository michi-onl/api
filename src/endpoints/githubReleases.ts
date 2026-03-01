import { contentJson, OpenAPIRoute } from "chanfana";
import { z } from "zod";
import type { AppContext } from "../types";
import { cached } from "../cache";

const MAX_REPOS = 8;
const GITHUB_REPO_RE = /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/;

const ReleaseSchema = z.object({
  repo: z.string().describe("Repository in owner/repo format"),
  repoUrl: z.string().describe("GitHub repository URL"),
  name: z.string().describe("Release name"),
  tagName: z.string().describe("Git tag"),
  publishedAt: z.string().describe("ISO 8601 publish date"),
  timeAgo: z.string().describe("Human-readable time since publish"),
  author: z.string().describe("Release author login"),
  url: z.string().describe("Release page URL"),
  isPrerelease: z.boolean(),
  isDraft: z.boolean(),
  body: z.string().describe("Release notes (truncated to 500 chars)"),
});

const ReleasesResponseSchema = z.object({
  source: z.string(),
  count: z.number().describe("Number of repos returned"),
  releases: z.array(ReleaseSchema),
});

export class GitHubReleases extends OpenAPIRoute {
  schema = {
    tags: ["Tech"],
    summary: "Latest GitHub releases for given repositories",
    request: {
      query: z.object({
        repos: z
          .string()
          .describe("Comma-separated repos in owner/repo format (max 8)"),
      }),
    },
    responses: {
      "200": {
        description: "Latest release info for each repo",
        ...contentJson(ReleasesResponseSchema),
      },
      "400": { description: "Missing repos parameter" },
    },
  };

  async handle(c: AppContext) {
    const repos = c.req.query("repos");
    if (!repos) {
      return c.json(
        {
          error:
            "No repositories specified. Use ?repos=owner/repo,owner2/repo2",
          example: "/api/github-releases?repos=nodejs/node,python/cpython",
        },
        400,
      );
    }

    const repoList = repos
      .split(",")
      .map((r) => r.trim())
      .filter(Boolean)
      .slice(0, MAX_REPOS);

    const cacheKey = `gh-releases:${[...repoList].sort().join(",")}`;
    const data = await cached(c.env.API_CACHE, cacheKey, 3600, async () => {
      const settled = await Promise.allSettled(
        repoList.map((repo) => fetchRelease(repo)),
      );

      const results = repoList.map((repo, i) => {
        const r = settled[i];
        return r.status === "fulfilled"
          ? r.value
          : { repo, error: "Failed to fetch release" };
      });

      return {
        source: "GitHub Releases",
        count: results.length,
        releases: results,
      };
    });

    return c.json(data);
  }
}

async function fetchRelease(repo: string) {
  if (!GITHUB_REPO_RE.test(repo)) {
    return { repo, error: "Invalid format. Use 'owner/repo'" };
  }

  const res = await fetch(
    `https://api.github.com/repos/${repo}/releases/latest`,
    {
      headers: {
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "CloudflareWorker-API",
      },
    },
  );

  if (!res.ok) {
    if (res.status === 404)
      return { repo, error: "Repository not found or no releases available" };
    if (res.status === 403)
      return { repo, error: "GitHub API rate limit exceeded" };
    return { repo, error: `HTTP error: ${res.status}` };
  }

  const data: Record<string, unknown> = await res.json();
  const publishedAt = (data.published_at as string) || "";
  const timeAgo = publishedAt ? formatTimeAgo(publishedAt) : "unknown";

  return {
    repo,
    repoUrl: `https://github.com/${repo}`,
    name: data.name || "Unnamed Release",
    tagName: data.tag_name || "",
    publishedAt,
    timeAgo,
    author: (data.author as Record<string, string>)?.login || "N/A",
    url: data.html_url || "",
    isPrerelease: data.prerelease || false,
    isDraft: data.draft || false,
    body: ((data.body as string) || "").slice(0, 500),
  };
}

function formatTimeAgo(isoDate: string): string {
  const dt = new Date(isoDate);
  const now = Date.now();
  const seconds = Math.floor((now - dt.getTime()) / 1000);

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
