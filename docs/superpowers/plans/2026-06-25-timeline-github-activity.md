# Timeline: Additional GitHub Activity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface release, star, fork, and repo-create events on `GET /api/timeline` alongside the existing PR/Issue/Tag/Commit events, with per-type caps and release/tag dedup.

**Architecture:** Single-file change to `src/fetchers/github.ts`. Extend the `GitHubEvent` interface with two optional payload fields, branch on the four new event types inside the existing event loop, dedupe Create-tag rows against ReleaseEvent rows by `${repo}|${tag}`, then cap each new type at 10 rows via slice before returning.

**Tech Stack:** Hono + chanfana + Zod (unchanged). No new dependencies, no new HTTP calls, no schema changes.

## Global Constraints

- TypeScript strict mode on; `noImplicitAny` off; `strictNullChecks` and `noUncheckedIndexedAccess` on. Optional payload fields must use `?` and be narrowed with `??`/`?.` guards.
- Per AGENTS.md: upstream fetch failures `console.log`'d, return partial/empty results, never throw. (Existing in this fetcher; behavior preserved.)
- No tests added. Repo has no test runner. Verification = `npx tsc --noEmit` then `npm run dev` smoke hit.
- No comments in code unless asked.
- Cache key unchanged (timeline cache wraps `fetchGitHub` return; new rows flow through naturally; 15-min TTL ages them).

## File Structure

- Modify: `src/fetchers/github.ts` (entire change lives here)
- Read-only reference: `src/types.ts` (`TimelineEvent` shape), `src/normalize.ts` (dedup/90d filter), `src/endpoints/timeline.ts` (caller)

---

### Task 1: Extend GitHubEvent interface and add new event types

**Files:**
- Modify: `src/fetchers/github.ts:3-16`

**Interfaces:**
- Produces: updated `GitHubEvent` interface with `release?` and `forkee?` payload fields used in Task 2's branches.
- Consumes: `TimelineEvent` from `src/types.ts` (unchanged).

- [ ] **Step 1: Extend the interface payload with release + forkee**

Edit `src/fetchers/github.ts` lines 8-15 (the `payload` block inside `GitHubEvent`). Replace with:

```ts
  payload: {
    action?: string;
    number?: number;
    pull_request?: { title?: string; html_url?: string; number?: number };
    issue?: { title?: string; html_url?: string; number?: number };
    ref?: string;
    ref_type?: string;
    release?: { tag_name?: string; name?: string; html_url?: string };
    forkee?: { full_name?: string; html_url?: string };
  };
```

- [ ] **Step 2: Add per-type cap constants**

Add after line 7 (`interface GitHubEvent {` closes), before `interface GitHubCommitEvent`:

```ts
const MAX_STAR_EVENTS = 10;
const MAX_FORK_EVENTS = 10;
const MAX_RELEASE_EVENTS = 10;
const MAX_REPO_CREATE_EVENTS = 10;
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: 0 errors. No behavior change yet (new optional fields + unused constants).

- [ ] **Step 4: Commit**

```bash
git add src/fetchers/github.ts
git commit -m "feat(github): extend event payload interface for releases/forks"
```

---

### Task 2: Collect new event types with release/tag dedup

**Files:**
- Modify: `src/fetchers/github.ts:49-94` (the events block)

**Interfaces:**
- Consumes: extended `GitHubEvent` from Task 1.
- Produces: a `result: TimelineEvent[]` array that now includes release/star/fork/repo-create rows before the commits block runs.

- [ ] **Step 1: Add accumulator buckets and release-tag dedup set**

Replace lines 49-50 (`const result: TimelineEvent[] = [];` and the comment) with:

```ts
  const result: TimelineEvent[] = [];

  const releaseRows: TimelineEvent[] = [];
  const starRows: TimelineEvent[] = [];
  const forkRows: TimelineEvent[] = [];
  const repoCreateRows: TimelineEvent[] = [];
  const releaseTags = new Set<string>();
```

- [ ] **Step 2: Add branches for the four new event types inside the loop**

Inside the `for (const e of events)` loop (currently lines 54-93), the existing chain ends at the `CreateEvent && ref_type === "tag"` branch. Add new `else if` branches after it (before the closing `}` of the for loop).

```ts
      } else if (e.type === "ReleaseEvent" && e.payload.release) {
        const rel = e.payload.release;
        if (e.payload.action === "published") {
          const tag = rel.tag_name ?? "";
          const name = rel.name ?? tag;
          releaseRows.push({
            id: `github:${e.id}`,
            date: e.created_at,
            source: "github",
            title: `Release ${tag}: ${name} in ${e.repo.name}`,
            url: rel.html_url ?? `https://github.com/${e.repo.name}/releases/tag/${tag}`,
          });
          if (tag) releaseTags.add(`${e.repo.name}|${tag}`);
        }
      } else if (e.type === "WatchEvent" && e.payload.action === "started") {
        starRows.push({
          id: `github:${e.id}`,
          date: e.created_at,
          source: "github",
          title: `Starred ${e.repo.name}`,
          url: `https://github.com/${e.repo.name}`,
        });
      } else if (e.type === "ForkEvent" && e.payload.action === "forked" && e.payload.forkee) {
        const forkee = e.payload.forkee;
        forkRows.push({
          id: `github:${e.id}`,
          date: e.created_at,
          source: "github",
          title: `Forked ${e.repo.name} → ${forkee.full_name ?? e.repo.name}`,
          url: forkee.html_url ?? `https://github.com/${e.repo.name}`,
        });
      } else if (e.type === "CreateEvent" && e.payload.ref_type === "repository") {
        repoCreateRows.push({
          id: `github:${e.id}`,
          date: e.created_at,
          source: "github",
          title: `Created repo ${e.repo.name}`,
          url: `https://github.com/${e.repo.name}`,
        });
      }
```

- [ ] **Step 3: Guard existing Create-tag branch against release collision**

Edit the existing `CreateEvent && ref_type === "tag"` branch (currently lines 84-92) to skip when a release row already claims the same repo+tag. Change the condition from:

```ts
      } else if (e.type === "CreateEvent" && e.payload.ref_type === "tag") {
```

to:

```ts
      } else if (
        e.type === "CreateEvent" &&
        e.payload.ref_type === "tag" &&
        !releaseTags.has(`${e.repo.name}|${e.payload.ref ?? ""}`)
      ) {
```

- [ ] **Step 4: Merge capped buckets into result**

After the for loop ends (before the `// Commits via search API` comment), append:

```ts
    result.push(...releaseRows.slice(0, MAX_RELEASE_EVENTS));
    result.push(...starRows.slice(0, MAX_STAR_EVENTS));
    result.push(...forkRows.slice(0, MAX_FORK_EVENTS));
    result.push(...repoCreateRows.slice(0, MAX_REPO_CREATE_EVENTS));
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: 0 errors. `strictNullChecks` satisfied via `??` fallbacks on `rel.tag_name`, `rel.name`, `rel.html_url`, `forkee.full_name`, `forkee.html_url`, `e.payload.ref`.

- [ ] **Step 6: Commit**

```bash
git add src/fetchers/github.ts
git commit -m "feat(github): surface releases, stars, forks, repo-creates on timeline"
```

---

### Task 3: Smoke verify against live API

**Files:**
- None modified.

- [ ] **Step 1: Start dev server**

Run: `npm run dev`
Expected: Wrangler dev server starts at http://localhost:8787, no errors.

- [ ] **Step 2: Hit timeline endpoint**

In another shell (or browser):

```bash
curl -s -H "Authorization: Bearer $API_TOKEN" \
  "http://localhost:8787/api/timeline?category=contributions" | python3 -m json.tool | grep -E '"source": "github"|"title":' | head -40
```

Expected: output includes titles starting with `Release `, `Starred `, `Forked `, `Created repo `, alongside existing `PR:`, `Issue `, `Tagged `, and `<repo>: <msg>` commit rows. If the live user has none of these events in the last 90 days, only the existing types appear — that's a pass, not a failure.

- [ ] **Step 3: Verify dedup by eyeballing tag collisions**

In the JSON output, search for rows whose title contains both `Release X.Y: ` and `Tagged X.Y in `. A given repo+tag should appear only once, as a Release row (no matching Tagged row). If no collisions exist in live data, skip this step.

- [ ] **Step 4: Kill dev server**

`Ctrl-C` in the dev server shell.

- [ ] **Step 5: Commit (verification artifact)**

No file to commit. If any behavior bug surfaced, fix it in `github.ts` and amend Task 2's commit per AGENTS.md (small fixup commit, not amend, per git guidance — actually create a new commit):

```bash
git commit --allow-empty -m "chore: verify timeline github activity additions"
```

(Empty commit keeps a marker that smoke verification ran; only run if no fix was needed.)

---

## Self-Review Notes

- Spec section "Event Mapping" table → Task 2 Step 2 branches (one per row).
- Spec section "Dedup" → Task 2 Step 3 (releaseTags Set + guard on existing branch).
- Spec section "Per-type Caps" → Task 1 Step 2 constants + Task 2 Step 4 slice.
- Spec section "GitHubEvent interface extension" → Task 1 Step 1.
- Spec section "Failure Handling" → no code change needed (existing `console.error` on events Res not-ok preserved; the for loop just runs zero iterations if parse fails).
- Spec acceptance criterion 4 (existing rows unaffected) → existing PR/Issue branches unchanged; Create-tag branch only gains an additional skip condition.
- Spec acceptance criterion 5 (typecheck) → Task 1 Step 3 and Task 2 Step 5 run `npx tsc --noEmit`.
- No placeholders. All code shown verbatim. Cap values = 10 per spec.
- Type consistency: `releaseTags` Set name and `${repo}|${tag}` format match between Task 2 Step 2 (write) and Task 2 Step 3 (read). `MAX_*` constant names match between Task 1 Step 2 (define) and Task 2 Step 4 (use).