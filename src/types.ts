import type { Context } from "hono";

export interface Env {
  API_CACHE: KVNamespace;
  GITHUB_USER: string;
  WIKI_USER: string;
  BLOG_FEED: string;
}

export type AppContext = Context<{ Bindings: Env }>;

export interface TimelineEvent {
  id: string;
  date: string;
  source: "github" | "wikipedia" | "blog" | "gallery" | "imdb";
  title: string;
  url: string;
}
