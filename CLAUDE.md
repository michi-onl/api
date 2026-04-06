# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Personal API at `api.michi.onl` built as a Cloudflare Worker. Aggregates data from multiple sources (GitHub, Wikipedia, blog, IMDb, Billboard, Hacker News, Steam) into a cached REST API with auto-generated OpenAPI 3.1 documentation.

## Commands

```bash
pnpm install          # Install dependencies
npm run dev           # Local dev server at http://localhost:8787 (Swagger UI at /)
npm run deploy        # Deploy to Cloudflare Workers
npm run cf-typegen    # Regenerate TypeScript types after changing bindings in wrangler.jsonc
```

No test runner or linter is configured.

## Architecture

**Framework stack:** Hono (routing) + chanfana (OpenAPI schema generation) + Zod (validation) + Cheerio (HTML scraping)

**Key pattern — OpenAPI endpoints:** Each endpoint in `src/endpoints/` is a class extending `OpenAPIRoute` from chanfana. It declares a `schema` property (Zod-based request/response validation) and a `handle(c: AppContext)` method. Routes are registered in `src/index.ts`.

**Data fetching:** `src/fetchers/` contain standalone functions that call external APIs or scrape HTML. Endpoints compose these fetchers. External calls use `Promise.allSettled` to prevent cascading failures.

**Caching:** `src/cache.ts` provides a generic caching wrapper over Cloudflare KV (`API_CACHE` binding). Each endpoint has its own TTL (10 min–6 hours). Some endpoints conditionally cache only on successful results.

**Timeline aggregation:** `GET /api/timeline` merges events from 5 sources into a common `TimelineEvent` interface. `src/normalize.ts` deduplicates and filters to the last 90 days.

**CORS:** Configured in `src/index.ts` — allows `https://www.michi.onl` and localhost origins.

## Auth

All `/api/*` routes require an `API_TOKEN` — accepted as a Bearer token or `?token=` query param. See the middleware in `src/index.ts`.

## Environment & Bindings

Defined in `wrangler.jsonc` (plaintext vars) and `.dev.vars` (secrets):
- `GITHUB_USER`, `WIKI_USER`, `BLOG_FEED` — plaintext vars in wrangler.jsonc
- `GITHUB_TOKEN` — optional secret for higher GitHub rate limits
- `LINKDING_TOKEN` — Linkding API token for bookmarks endpoint
- `TMDB_TOKEN` — TMDB API token for IMDb/movie data
- `API_TOKEN` — secret used to authenticate incoming requests
- `API_CACHE` — KV namespace binding

Types are in `src/types.ts` (`Env`, `AppContext`, `TimelineEvent`). Auto-generated binding types are in `worker-configuration.d.ts`.

## TypeScript

Strict mode is on but `noImplicitAny` and `strictNullChecks` are off. `noUncheckedIndexedAccess` is enabled. JSON imports are supported (`resolveJsonModule`).
