// Single source of truth for query keys + query options. Both consumer hooks
// (useQuery / useInfiniteQuery) and the prefetch-on-hover layer import from
// here, so they cannot drift.
//
// Keys are arrays — TanStack Query hashes them structurally, so filter objects
// work directly without manual stringification.

import {
  infiniteQueryOptions,
  queryOptions,
  type QueryKey,
} from "@tanstack/react-query";
import {
  api,
  type ListQuery,
  type RequestRow,
  type SessionRow,
  type TimeseriesBucket,
  type ToolUsage,
  type UserUsage,
} from "./api";
import { insightsApi } from "./insights/api";
import type { Job } from "./insights/types";

export const PAGE_SIZE = 50;

// ---------------------------------------------------------------------------
// Key roots — used for broad invalidation by the SSE bridge.
// ---------------------------------------------------------------------------

export const qk = {
  stats: ["stats"] as const,
  timeseries: (bucket: TimeseriesBucket, hours: number) =>
    ["timeseries", bucket, hours] as const,
  heatmap: (days: number) => ["heatmap", days] as const,
  latency: ["latency"] as const,
  providers: ["providers"] as const,

  jobs: {
    root: ["jobs"] as const,
    list: ["jobs", "list"] as const,
    detail: (id: string) => ["jobs", "detail", id] as const,
  },

  sessions: {
    root: ["sessions"] as const,
    list: (filters: SessionFilters) => ["sessions", "list", filters] as const,
    agg: (filters: SessionFilters) => ["sessions", "agg", filters] as const,
    detail: (id: string) => ["sessions", "detail", id] as const,
    insights: (id: string) => ["sessions", "insights", id] as const,
  },

  requests: {
    root: ["requests"] as const,
    list: (filters: RequestFilters) => ["requests", "list", filters] as const,
    agg: (filters: RequestFilters) => ["requests", "agg", filters] as const,
    detail: (id: string) => ["requests", "detail", id] as const,
  },

  tools: {
    root: ["tools"] as const,
    list: (filters: ToolFilters) => ["tools", "list", filters] as const,
    agg: ["tools", "agg"] as const,
  },

  users: {
    root: ["users"] as const,
    list: (filters: UserFilters) => ["users", "list", filters] as const,
    agg: ["users", "agg"] as const,
    insights: (id: string, friction: string | null) =>
      ["users", "insights", id, friction ?? null] as const,
  },

  insights: {
    root: ["insights"] as const,
    dataset: ["insights", "dataset"] as const,
  },

  search: (q: string) => ["search", q] as const,
} as const;

// ---------------------------------------------------------------------------
// Filter shapes — keep these tight; structure is part of the query key.
// ---------------------------------------------------------------------------

export type SessionFilters = {
  q?: string;
  user?: string;
};

export type RequestFilters = {
  model?: string;
  status?: string;
  session?: string;
};

export type ToolFilters = {
  q?: string;
  errorsOnly?: boolean;
};

export type UserFilters = {
  q?: string;
  friction?: string;
};

// Strip undefined/empty so structurally-identical filter sets share a cache.
function clean<T extends Record<string, unknown>>(f: T): T {
  const out = {} as Record<string, unknown>;
  for (const [k, v] of Object.entries(f)) {
    if (v == null || v === "" || v === false) continue;
    out[k] = v;
  }
  return out as T;
}

// ---------------------------------------------------------------------------
// Singletons (no params)
// ---------------------------------------------------------------------------

export const statsQuery = () =>
  queryOptions({
    queryKey: qk.stats,
    queryFn: () => api.stats(),
  });

export const timeseriesQuery = (bucket: TimeseriesBucket, hours: number) =>
  queryOptions({
    queryKey: qk.timeseries(bucket, hours),
    queryFn: () => api.timeseries(bucket, hours),
  });

export const heatmapQuery = (days: number) =>
  queryOptions({
    queryKey: qk.heatmap(days),
    queryFn: () => api.heatmap(days),
  });

export const latencyQuery = () =>
  queryOptions({
    queryKey: qk.latency,
    queryFn: () => api.latency(),
  });

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export const sessionsListQuery = (filters: SessionFilters) => {
  const f = clean(filters);
  return infiniteQueryOptions({
    queryKey: qk.sessions.list(f),
    queryFn: ({ pageParam = 0 }) =>
      api.sessions({ limit: PAGE_SIZE, offset: pageParam, ...f }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      const loaded = allPages.reduce((n, p) => n + p.sessions.length, 0);
      return loaded < lastPage.total ? loaded : undefined;
    },
  });
};

export const sessionsAggQuery = (filters: SessionFilters) => {
  const f = clean(filters);
  return queryOptions({
    queryKey: qk.sessions.agg(f),
    queryFn: () => api.sessionsAggregates(f as ListQuery),
  });
};

export const sessionDetailQuery = (id: string) =>
  queryOptions({
    queryKey: qk.sessions.detail(id),
    queryFn: () => api.session(id),
    enabled: !!id,
  });

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

export const requestsListQuery = (filters: RequestFilters) => {
  const f = clean(filters);
  return infiniteQueryOptions({
    queryKey: qk.requests.list(f),
    queryFn: ({ pageParam = 0 }) =>
      api.requests({ limit: PAGE_SIZE, offset: pageParam, ...f }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      const loaded = allPages.reduce((n, p) => n + p.requests.length, 0);
      return loaded < lastPage.total ? loaded : undefined;
    },
  });
};

export const requestsAggQuery = (filters: RequestFilters) => {
  const f = clean(filters);
  return queryOptions({
    queryKey: qk.requests.agg(f),
    queryFn: () => api.requestsAggregates(f as ListQuery),
  });
};

export const requestDetailQuery = (id: string) =>
  queryOptions({
    queryKey: qk.requests.detail(id),
    queryFn: () => api.request(id),
    enabled: !!id,
  });

// Slim feed for Overview live panel.
export const recentRequestsQuery = (limit: number) =>
  queryOptions({
    queryKey: ["requests", "recent", limit] as const,
    queryFn: () => api.requests({ limit }),
  });

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

export const toolsListQuery = (filters: ToolFilters) => {
  const f = clean(filters);
  return infiniteQueryOptions({
    queryKey: qk.tools.list(f),
    queryFn: ({ pageParam = 0 }) =>
      api.tools({
        limit: PAGE_SIZE,
        offset: pageParam,
        q: f.q,
        errorsOnly: f.errorsOnly,
      }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      const loaded = allPages.reduce((n, p) => n + p.tools.length, 0);
      return loaded < lastPage.total ? loaded : undefined;
    },
  });
};

export const toolsAggQuery = () =>
  queryOptions({
    queryKey: qk.tools.agg,
    queryFn: () => api.toolsAggregates(),
  });

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

export const usersListQuery = (filters: UserFilters) => {
  const f = clean(filters);
  return infiniteQueryOptions({
    queryKey: qk.users.list(f),
    queryFn: ({ pageParam = 0 }) =>
      api.users({
        limit: PAGE_SIZE,
        offset: pageParam,
        q: f.q,
        friction: f.friction,
      }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      const loaded = allPages.reduce((n, p) => n + p.users.length, 0);
      return loaded < lastPage.total ? loaded : undefined;
    },
  });
};

export const usersAggQuery = () =>
  queryOptions({
    queryKey: qk.users.agg,
    queryFn: () => api.usersAggregates(),
  });

export const userInsightsQuery = (
  id: string,
  friction: string | null,
  limit = 100,
) =>
  queryOptions({
    queryKey: qk.users.insights(id, friction),
    queryFn: () =>
      api.userInsights(id, { friction: friction ?? undefined, limit }),
    enabled: !!id,
  });

// ---------------------------------------------------------------------------
// Insights
// ---------------------------------------------------------------------------

export const insightsDatasetQuery = () =>
  queryOptions({
    queryKey: qk.insights.dataset,
    queryFn: () => insightsApi.getDataset(),
  });

// ---------------------------------------------------------------------------
// Jobs (analyze queue) — pushed live via SSE; fetched on mount + invalidate.
// ---------------------------------------------------------------------------

export const jobsListQuery = () =>
  queryOptions<{ jobs: Job[] }>({
    queryKey: qk.jobs.list,
    queryFn: () => insightsApi.listJobs(),
  });

export const jobDetailQuery = (id: string) =>
  queryOptions<Job>({
    queryKey: qk.jobs.detail(id),
    queryFn: () => insightsApi.getJob(id),
    enabled: !!id,
  });

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export const searchQuery = (q: string) =>
  queryOptions({
    queryKey: qk.search(q),
    queryFn: () => api.search(q),
    enabled: q.trim().length > 0,
  });

// ---------------------------------------------------------------------------
// Helpers exposed for callers that want to hand-roll a flatten.
// ---------------------------------------------------------------------------

export const flattenSessions = (
  pages: { sessions: SessionRow[]; total: number }[] | undefined,
): { rows: SessionRow[]; total: number } => ({
  rows: pages?.flatMap((p) => p.sessions) ?? [],
  total: pages?.[0]?.total ?? 0,
});

export const flattenRequests = (
  pages: { requests: RequestRow[]; total: number }[] | undefined,
): { rows: RequestRow[]; total: number } => ({
  rows: pages?.flatMap((p) => p.requests) ?? [],
  total: pages?.[0]?.total ?? 0,
});

export const flattenTools = (
  pages: { tools: ToolUsage[]; total: number }[] | undefined,
): { rows: ToolUsage[]; total: number } => ({
  rows: pages?.flatMap((p) => p.tools) ?? [],
  total: pages?.[0]?.total ?? 0,
});

export const flattenUsers = (
  pages: { users: UserUsage[]; total: number }[] | undefined,
): { rows: UserUsage[]; total: number } => ({
  rows: pages?.flatMap((p) => p.users) ?? [],
  total: pages?.[0]?.total ?? 0,
});

// Re-export type for any caller that imports from here.
export type { QueryKey };
