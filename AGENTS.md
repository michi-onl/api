# Repo Notes

Guidance for agents working in this repository.

## Project Overview

Personal API at `api.michi.onl` deployed as a Cloudflare Worker. Aggregates GitHub, Wikipedia, blog, IMDb/TMDB, Billboard, Hacker News, Steam, Bookmarks, and DHBW timetable data into a cached REST API with auto-generated OpenAPI 3.1 docs (Swagger UI at `/`).

## Commands

```bash
pnpm install          # Install dependencies
npm run dev           # Local dev server at http://localhost:8787 (Swagger UI at /)
npm run deploy        # Deploy to Cloudflare Workers (wrangler deploy)
npm run cf-typegen    # Regenerate TypeScript types after changing bindings in wrangler.jsonc
```

No test runner, linter, or CI is configured — do not invent verification steps.

## Architecture

**Stack:** Hono (routing) + chanfana (OpenAPI schema generation) + Zod (validation). Entry point: `src/index.ts`.

**Endpoints** (`src/endpoints/`): Each file exports a class extending `OpenAPIRoute` with a Zod `schema` and `handle(c: AppContext)`. Registered centrally in `src/index.ts`. `wikipediaWatchlist` is the only POST route; the rest are GET.

**Fetchers** (`src/fetchers/`): Standalone functions for external APIs/scraping. Used by both dedicated endpoints and the timeline.

**Caching** (`src/cache.ts`): Generic `cached()` wrapper over the `API_CACHE` KV namespace. TTLs range 10 min–6 h. Optional `shouldCache` predicate gates writes on successful results.

**Timeline** (`GET /api/timeline`): Merges events from 5 sources (GitHub, Wikipedia, blog, gallery, IMDb) via `Promise.allSettled`. `src/normalize.ts` deduplicates and filters to the last 90 days. Preserve partial-success behavior — never fail the whole response on one upstream error.

**`src/fetchers/imdb.ts`** reads local `data/imdb-ratings.json` for the timeline. The separate `/api/imdb` endpoint (trending/popular, `endpoints/tmdb.ts` `TmdbTrending`) uses live `TMDB_TOKEN` calls — do not confuse the two.

**DHBW timetable** (`src/fetchers/dhbw.ts`): Hardcoded `DHBW_COURSE_CODE = "HDH-WWI2025B"` against `https://api.dhbw.app`. No env binding — edit the constant to change course.

**Non-API routes:** `GET /health` (unauthenticated `{status, timestamp}`), `/` (Swagger UI via chanfana). Request-logging middleware on all routes.

## Auth & CORS

- All `/api/*` routes require `API_TOKEN` — accepted as `Authorization: Bearer <token>` or `?token=<token>`.
- CORS allows `https://michi.onl` and any `localhost`/`127.0.0.1` origin.

## Environment & Bindings

Defined in `wrangler.jsonc` (plaintext vars), `.dev.vars` (secrets), and typed by `Env` in `src/types.ts` (canonical checklist):

| Binding          | Type              | Purpose                       |
| ---------------- | ----------------- | ----------------------------- |
| `API_CACHE`      | KV namespace      | Cache storage                 |
| `ASSETS`         | static assets     | Serves `public/`              |
| `GITHUB_USER`    | var               | GitHub username               |
| `WIKI_USER`      | var               | Wikipedia username            |
| `BLOG_FEED`      | var               | Blog RSS feed URL             |
| `GITHUB_TOKEN`   | secret (optional) | Higher GitHub rate limits     |
| `LINKDING_TOKEN` | secret            | Bookmarks API                 |
| `TMDB_TOKEN`     | secret            | TMDB API (trending movies/TV) |
| `API_TOKEN`      | secret            | Incoming request auth         |

Run `npm run cf-typegen` after changing bindings; generated types land in `worker-configuration.d.ts`.

## TypeScript

Strict mode on; `noImplicitAny` **off**; `strictNullChecks` and `noUncheckedIndexedAccess` **on**. `resolveJsonModule` on (JSON imports supported).

## Conventions

Hard-won rules from past bugfixes — follow them:

- **Error responses**: return `{ error: string }` via `ErrorResponseSchema` from `src/types.ts`. No other shape.
- **Cache keys**: use `makeCacheKey(namespace, ...parts)` from `src/utils.ts` for any key with variable-length parts. KV rejects keys over 512 bytes; `makeCacheKey` hashes long keys to stay under.
- **Cache resilience**: `cached()` already wraps KV read/write in try/catch. Never let a cache failure bubble up as an error response.
- **Auth fails closed**: unset or mismatched `API_TOKEN` → 401/500, never pass through.
- **Upstream fetch failures**: `console.log` them, then return partial/empty result. Never swallow silently. Timeline's `Promise.allSettled` is the model.
- **Outbound fetch timeouts**: every `fetch()` to an external host passes `signal: AbortSignal.timeout(10000)` so a slow upstream can't hold the request to the Worker wall-clock limit. A timeout rejects the fetch — handle it on the same path as a non-OK response (log + empty result, or let `Promise.allSettled` absorb it).
- **GitHub API**: pass `GITHUB_TOKEN` when available for higher rate limits.
- **OpenAPI tags**: exactly 4 categories — `Media & Entertainment`, `Development & Tech`, `Knowledge & Education`, `Personal Aggregation`. Assign every endpoint one.

## Cloudflare Workers

Cloudflare Workers APIs and limits change frequently. Before any task touching Workers/KV/R2/D1/Durable Objects/Queues/Vectorize/AI/Agents SDK features, retrieve current docs from https://developers.cloudflare.com/workers/ (or `https://docs.mcp.cloudflare.com/mcp`). Limits live under each product's `/platform/limits/` page.
