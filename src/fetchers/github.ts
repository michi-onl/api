import type { TimelineEvent } from "../types";

interface GitHubEvent {
  id: string;
  type: string;
  repo: { name: string };
  created_at: string;
  payload: {
    action?: string;
    number?: number;
    pull_request?: { title?: string; html_url?: string; number?: number };
    issue?: { title?: string; html_url?: string; number?: number };
    ref?: string;
    ref_type?: string;
  };
}

interface GitHubCommitEvent {
  sha: string;
  commit: { message: string; author: { date: string } };
  html_url: string;
  repository: { full_name: string };
}

export async function fetchGitHub(
  user: string,
  token?: string,
): Promise<TimelineEvent[]> {
  const headers: Record<string, string> = { "User-Agent": "timeline-worker" };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const [eventsRes, commitsRes] = await Promise.all([
    fetch(`https://api.github.com/users/${user}/events?per_page=100`, {
      headers,
    }),
    fetch(
      `https://api.github.com/search/commits?q=author:${user}&sort=author-date&per_page=30`,
      { headers },
    ),
  ]);

  if (!eventsRes.ok) {
    console.error(`GitHub events fetch failed: ${eventsRes.status}`);
  }
  if (!commitsRes.ok) {
    console.error(`GitHub commits search failed: ${commitsRes.status}`);
  }

  const result: TimelineEvent[] = [];

  // PR, Issue, and Create events
  if (eventsRes.ok) {
    const events: GitHubEvent[] = await eventsRes.json();
    for (const e of events) {
      if (e.type === "PullRequestEvent" && e.payload.pull_request) {
        const pr = e.payload.pull_request;
        const num = e.payload.number ?? pr.number;
        const action = e.payload.action ?? "opened";
        const title = pr.title
          ? `PR: ${pr.title}`
          : `${action} PR #${num} in ${e.repo.name}`;
        result.push({
          id: `github:${e.id}`,
          date: e.created_at,
          source: "github",
          title,
          url: pr.html_url ?? `https://github.com/${e.repo.name}/pull/${num}`,
        });
      } else if (e.type === "IssuesEvent" && e.payload.issue) {
        const issue = e.payload.issue;
        const action = e.payload.action ?? "opened";
        const title = issue.title
          ? `Issue ${action}: ${issue.title}`
          : `${action} issue #${issue.number} in ${e.repo.name}`;
        result.push({
          id: `github:${e.id}`,
          date: e.created_at,
          source: "github",
          title,
          url:
            issue.html_url ??
            `https://github.com/${e.repo.name}/issues/${issue.number}`,
        });
      } else if (e.type === "CreateEvent" && e.payload.ref_type === "tag") {
        result.push({
          id: `github:${e.id}`,
          date: e.created_at,
          source: "github",
          title: `Tagged ${e.payload.ref} in ${e.repo.name}`,
          url: `https://github.com/${e.repo.name}/releases/tag/${e.payload.ref}`,
        });
      }
    }
  }

  // Commits via search API (reliable, includes full message)
  if (commitsRes.ok) {
    const data: { items?: GitHubCommitEvent[] } = await commitsRes.json();
    for (const c of data.items ?? []) {
      const msg = c.commit.message.split("\n")[0];
      result.push({
        id: `github:commit:${c.sha.slice(0, 12)}`,
        date: c.commit.author.date,
        source: "github",
        title: `${c.repository.full_name}: ${msg}`,
        url: c.html_url,
      });
    }
  }

  return result;
}
