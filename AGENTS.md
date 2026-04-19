# Repo Notes

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Personal API at `api.michi.onl` built as a Cloudflare Worker. Aggregates data from GitHub, Wikipedia, blog, IMDb/TMDB, Billboard, Hacker News, and Steam into a cached REST API with auto-generated OpenAPI 3.1 documentation.

## Commands

```bash
pnpm install          # Install dependencies
npm run dev           # Local dev server at http://localhost:8787 (Swagger UI at /)
npm run deploy        # Deploy to Cloudflare Workers
npm run cf-typegen    # Regenerate TypeScript types after changing bindings in wrangler.jsonc
```

No test runner, linter, or CI is configured — do not invent verification steps.

## Architecture

**Stack:** Hono (routing) + chanfana (OpenAPI schema generation) + Zod (validation)

**Endpoints** (`src/endpoints/`): Each file exports a class extending `OpenAPIRoute` with a `schema` (Zod-based) and `handle(c: AppContext)`. Registered centrally in `src/index.ts`. Current endpoints: `timeline`, `billboard`, `imdb`, `steamProfiles`, `hackernews`, `githubReleases`, `wikipediaWatchlist`, `bookmarks`.

**Fetchers** (`src/fetchers/`): Standalone functions for external APIs/scraping. `GET /api/timeline` composes all fetchers via `Promise.allSettled` — preserve partial-success behavior, never fail the whole response on one upstream error.

**Caching** (`src/cache.ts`): Generic wrapper over Cloudflare KV (`API_CACHE` binding). TTLs range from 10 min to 6 hours; some endpoints only cache on successful results via the optional `shouldCache` predicate.

**Timeline** (`GET /api/timeline`): Merges events from 5 sources (GitHub, Wikipedia, blog, gallery, IMDb). `src/normalize.ts` deduplicates and filters to the last 90 days.

**Special case:** `src/fetchers/imdb.ts` reads local `data/imdb-ratings.json`. The `/api/imdb` endpoint (trending/popular) is separate and uses `TMDB_TOKEN`.

## Auth & CORS

- All `/api/*` routes require `API_TOKEN` — accepted as `Authorization: Bearer <token>` or `?token=<token>`.
- CORS allows `https://www.michi.onl` and any `localhost`/`127.0.0.1` origin.

## Environment & Bindings

Defined in `wrangler.jsonc` (plaintext vars) and `.dev.vars` (secrets). `Env` in `src/types.ts` is the canonical binding checklist:

| Binding | Type | Purpose |
|---------|------|---------|
| `API_CACHE` | KV namespace | Cache storage |
| `GITHUB_USER` | var | GitHub username |
| `WIKI_USER` | var | Wikipedia username |
| `BLOG_FEED` | var | Blog RSS feed URL |
| `GITHUB_TOKEN` | secret (optional) | Higher GitHub rate limits |
| `LINKDING_TOKEN` | secret | Bookmarks API |
| `TMDB_TOKEN` | secret | TMDB API (trending movies/TV) |
| `API_TOKEN` | secret | Incoming request auth |

Run `npm run cf-typegen` after changing bindings; generated types land in `worker-configuration.d.ts`.

## TypeScript

Strict mode on; `noImplicitAny` and `strictNullChecks` are **off**; `noUncheckedIndexedAccess` is **on**. JSON imports supported (`resolveJsonModule`).

# Cloudflare Workers

STOP. Your knowledge of Cloudflare Workers APIs and limits may be outdated. Always retrieve current documentation before any Workers, KV, R2, D1, Durable Objects, Queues, Vectorize, AI, or Agents SDK task.

## Docs

- https://developers.cloudflare.com/workers/
- MCP: `https://docs.mcp.cloudflare.com/mcp`

For all limits and quotas, retrieve from the product's `/platform/limits/` page. eg. `/workers/platform/limits`

## Commands

| Command               | Purpose                   |
| --------------------- | ------------------------- |
| `npx wrangler dev`    | Local development         |
| `npx wrangler deploy` | Deploy to Cloudflare      |
| `npx wrangler types`  | Generate TypeScript types |

Run `wrangler types` after changing bindings in wrangler.jsonc.

## Node.js Compatibility

https://developers.cloudflare.com/workers/runtime-apis/nodejs/

## Errors

- **Error 1102** (CPU/Memory exceeded): Retrieve limits from `/workers/platform/limits/`
- **All errors**: https://developers.cloudflare.com/workers/observability/errors/

## Product Docs

Retrieve API references and limits from:
`/kv/` · `/r2/` · `/d1/` · `/durable-objects/` · `/queues/` · `/vectorize/` · `/workers-ai/` · `/agents/`
