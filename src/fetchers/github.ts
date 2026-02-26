import type { TimelineEvent } from "../types";

interface GitHubEvent {
  id: string;
  type: string;
  repo: { name: string };
  created_at: string;
  payload: {
    commits?: { message: string }[];
    action?: string;
    pull_request?: { title: string; html_url: string };
  };
}

export async function fetchGitHub(user: string): Promise<TimelineEvent[]> {
  const res = await fetch(
    `https://api.github.com/users/${user}/events?per_page=100`,
    { headers: { "User-Agent": "timeline-worker" } },
  );
  if (!res.ok) return [];

  const events: GitHubEvent[] = await res.json();
  const result: TimelineEvent[] = [];

  for (const e of events) {
    if (e.type === "PushEvent" && e.payload.commits?.length) {
      const msg = e.payload.commits[0].message.split("\n")[0];
      result.push({
        id: `github:${e.id}`,
        date: e.created_at,
        source: "github",
        title: `${e.repo.name}: ${msg}`,
        url: `https://github.com/${e.repo.name}`,
      });
    } else if (e.type === "PullRequestEvent" && e.payload.pull_request) {
      result.push({
        id: `github:${e.id}`,
        date: e.created_at,
        source: "github",
        title: `PR: ${e.payload.pull_request.title}`,
        url: e.payload.pull_request.html_url,
      });
    }
  }

  return result;
}
