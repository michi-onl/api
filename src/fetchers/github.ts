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

  const result: TimelineEvent[] = [];

  // PR events
  if (eventsRes.ok) {
    const events: GitHubEvent[] = await eventsRes.json();
    for (const e of events) {
      if (e.type !== "PullRequestEvent" || !e.payload.pull_request) continue;
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
