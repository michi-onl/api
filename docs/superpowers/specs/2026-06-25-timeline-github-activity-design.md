# Timeline: Additional GitHub Activity

Date: 2026-06-25
Scope: `src/fetchers/github.ts` only.

## Goal

Surface four additional GitHub event types on `GET /api/timeline` (and `?category=contributions`): published releases, stars given, forks created, and new repositories created. Currently only PullRequest, Issues, Create-tag, and author commits are shown.

## Non-Goals

- No new endpoint, no new query param, no new env var.
- No changes to `TimelineEvent` shape, Zod schema, OpenAPI schema, or `normalize.ts`.
- No changes to cache key (15-min TTL ages in new rows naturally).
- No tests added (repo has no test runner).

## Source

All new data comes from the existing `GET /users/{user}/events?per_page=100` call in `fetchGitHub`. No new HTTP requests.

The `GitHubEvent` interface in `fetchers/github.ts` must be extended with optional `payload.release?: { tag_name: string; name?: string; html_url?: string }` and `payload.forkee?: { full_name: string; html_url?: string }` fields to match the live API shapes (verified: `WatchEvent.payload.action="started"`, `ForkEvent.payload.action="forked"` with `forkee.html_url`, `ReleaseEvent.payload.action="published"` with `release.html_url`/`tag_name`).

## Event Mapping

Each new event becomes a `TimelineEvent` with `source: "github"`. The events API returns most-recent-first.

| Event type | Condition | Title | URL | ID |
|---|---|---|---|---|
| `ReleaseEvent` | `payload.action === "published"` | `Release {tag}: {name} in {repo}` (name falls back to tag) | `payload.release.html_url` | `github:{event.id}` |
| `WatchEvent` | `payload.action === "started"` | `Starred {repo}` | `https://github.com/{repo}` | `github:{event.id}` |
| `ForkEvent` | `payload.action === "forked"` | `Forked {parent} → {forkee.full_name}` | `payload.forkee.html_url` | `github:{event.id}` |
| `CreateEvent` | `payload.ref_type === "repository"` | `Created repo {repo}` | `https://github.com/{repo}` | `github:{event.id}` |

Events whose `action` (or `ref_type`) doesn't match the relevant value are skipped.

## Dedup: Releases vs. Tag events

Today `CreateEvent` with `ref_type === "tag"` produces a "Tagged …" row. A `ReleaseEvent` for the same tag would duplicate it. Resolution: collect release rows first, build a `Set<string>` of `${repo}|${tag}` from release rows, then skip any tag row whose `${repo}|${ref}` is in the set. Release row wins (richer title, release page URL).

## Per-type Caps

After all event rows are collected and deduped, apply caps to keep stars/forks/releases/repo-creates from drowning out PRs/issues/commits:

| Type | Cap |
|---|---|
| Star (WatchEvent) | 10 |
| Fork (ForkEvent) | 10 |
| Release (ReleaseEvent) | 10 |
| Repo-create (CreateEvent repo) | 10 |
| PR / Issue / Tag / Commit | none |

The events API returns most-recent-first, so cap = `.slice(0, N)` per bucket before concatenating. Cap values are named constants at the top of `fetchers/github.ts` alongside existing style.

## Failure Handling

Unchanged from current behavior: a single event that fails the condition checks is just not emitted. The whole `fetchGitHub` continues returning partial results even if the events API 5xxs. Commits search path is untouched. Per AGENTS.md, upstream fetch failures are `console.log`'d, not swallowed silently or thrown.

## IDs & Ordering

All new rows use `github:${event.id}` where `event.id` is GitHub's monotonic numeric event ID. `normalize.ts`'s `seen` Set continues to dedupe cleanly across sources and within GitHub. Existing `CreateEvent`-tag dedup key (`${repo}|${ref}`) is reused for release-vs-tag dedup.

## Acceptance Criteria

1. `GET /api/timeline` returns rows for release, star, fork, and repo-create events when present in the events API response.
2. Release/tag collision: when both a `ReleaseEvent` and `CreateEvent(ref_type="tag")` exist for the same repo+tag, only the release row appears.
3. Each of the four new types is capped at 10 rows per fetch.
4. Existing PR/Issue/Commit rows are unaffected.
5. Typecheck passes (`npm run cf-typegen` not needed; no binding changes).