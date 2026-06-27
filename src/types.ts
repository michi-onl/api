import type { Context } from "hono";
import { z } from "zod";

export interface Env {
  API_CACHE: KVNamespace;
  ASSETS: Fetcher;
  GITHUB_USER: string;
  GITHUB_TOKEN?: string;
  WIKI_USER: string;
  BLOG_FEED: string;
  LINKDING_TOKEN: string;
  TMDB_TOKEN: string;
  API_TOKEN: string;
}

export type AppContext = Context<{ Bindings: Env }>;

export interface TimelineEvent {
  id: string;
  date: string;
  source: "github" | "wikipedia" | "blog" | "gallery" | "imdb";
  title: string;
  url: string;
}

export const ErrorResponseSchema = z.object({
  error: z.string(),
});

export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
