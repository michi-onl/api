import { contentJson, OpenAPIRoute } from "chanfana";
import { z } from "zod";
import type { AppContext } from "../types";
import { cached } from "../cache";
import { formatTimeAgo, makeCacheKey } from "../utils";

const MAX_REPOS = 8;
const GITHUB_REPO_RE = /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/;

const ReleaseAssetSchema = z.object({
  name: z.string().describe("Asset filename"),
  downloadUrl: z.string().describe("Browser download URL"),
  size: z.number().describe("Asset size in bytes"),
  contentType: z.string().describe("MIME type"),
  downloadCount: z.number().describe("Number of downloads"),
});

const ReactionsSchema = z.object({
  totalCount: z.number(),
  "+1": z.number(),
  heart: z.number(),
  hooray: z.number(),
  rocket: z.number(),
});

const ReleaseSchema = z.object({
  repo: z.string().describe("Repository in owner/repo format"),
  repoUrl: z.string().describe("GitHub repository URL"),
  name: z.string().describe("Release name"),
  tagName: z.string().describe("Git tag"),
  publishedAt: z.string().describe("ISO 8601 publish date"),
  timeAgo: z.string().describe("Human-readable time since publish"),
  author: z.string().describe("Release author login"),
  authorAvatarUrl: z.string().describe("Author avatar URL"),
  url: z.string().describe("Release page URL"),
  isPrerelease: z.boolean(),
  isDraft: z.boolean(),
  body: z.string().describe("Release notes (truncated to 500 chars)"),
  reactions: ReactionsSchema.nullable().describe("Reaction counts"),
  assets: z.array(ReleaseAssetSchema).describe("Downloadable assets"),
});

const ReleasesResponseSchema = z.object({
  source: z.string(),
  count: z.number().describe("Number of repos returned"),
  releases: z.array(ReleaseSchema),
});

export class GitHubReleases extends OpenAPIRoute {
  schema = {
    tags: ["Development & Tech"],
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

    const cacheKey = makeCacheKey("gh-releases", [...repoList].sort().join(","));
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
    }, (result) => result.releases.every((r: Record<string, unknown>) => !r.error));

    // Recompute timeAgo from cached publishedAt so it stays fresh
    for (const r of data.releases as Record<string, unknown>[]) {
      const pub = r.publishedAt as string;
      if (pub) r.timeAgo = formatTimeAgo(pub);
    }

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

  const authorObj = data.author as Record<string, string> | undefined;
  const reactionsObj = data.reactions as Record<string, number> | undefined;
  const assetsArr = (data.assets as Record<string, unknown>[]) || [];

  return {
    repo,
    repoUrl: `https://github.com/${repo}`,
    name: data.name || "Unnamed Release",
    tagName: data.tag_name || "",
    publishedAt,
    timeAgo,
    author: authorObj?.login || "N/A",
    authorAvatarUrl: authorObj?.avatar_url || "",
    url: data.html_url || "",
    isPrerelease: data.prerelease || false,
    isDraft: data.draft || false,
    body: ((data.body as string) || "").slice(0, 500),
    reactions: reactionsObj
      ? {
          totalCount: reactionsObj.total_count ?? 0,
          "+1": reactionsObj["+1"] ?? 0,
          heart: reactionsObj.heart ?? 0,
          hooray: reactionsObj.hooray ?? 0,
          rocket: reactionsObj.rocket ?? 0,
        }
      : null,
    assets: assetsArr.slice(0, 10).map((a) => ({
      name: (a.name as string) || "",
      downloadUrl: (a.browser_download_url as string) || "",
      size: (a.size as number) || 0,
      contentType: (a.content_type as string) || "",
      downloadCount: (a.download_count as number) || 0,
    })),
  };
}

