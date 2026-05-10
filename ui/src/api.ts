async function j<T>(r: Response): Promise<T> {
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json();
}

// Token convention used everywhere in the UI:
//   input_tokens  = fresh (uncached) input tokens
//   output_tokens = generated tokens
//   cache_*_tokens = cached prefix re-read / written; reported separately so
//                    "total tokens" (input+output) matches Claude Code /status
export type Stats = {
  request_count: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  cost: number;
  avg_latency_ms: number;
  error_count: number | null;
  session_count: number;
  byModel: {
    model: string;
    n: number;
    cost: number;
    tokens: number;
    cache_read_tokens: number;
    cache_creation_tokens: number;
  }[];
  byProvider: { provider: string; n: number; cost: number }[];
  recent: { hour: string; n: number; cost: number }[];
};

export type SessionRow = {
  id: string;
  user_id: string | null;
  created_at: number;
  updated_at: number;
  request_count: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_cache_read_tokens: number;
  total_cache_creation_tokens: number;
  total_cost: number;
};

export type RequestRow = {
  id: string;
  session_id: string;
  user_id: string | null;
  provider: string;
  model: string;
  status: "ok" | "error";
  error: string | null;
  streamed: number;
  started_at: number;
  finished_at: number | null;
  latency_ms: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cache_read_tokens: number | null;
  cache_creation_tokens: number | null;
  cost: number | null;
  finish_reason: string | null;
};

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | { [k: string]: JsonValue }
  | JsonValue[];

export type ToolCall = {
  id?: string;
  type?: string;
  function?: { name?: string; arguments?: string | JsonValue };
};

export type RequestDetail = RequestRow & {
  request: JsonValue;
  response: JsonValue;
  tool_calls: ToolCall[] | null;
};

export type Provider = {
  id: string;
  kind: "openai" | "anthropic" | "google";
  base_url: string;
  configured: boolean;
  catalog_key: string | null;
};

export type TimeseriesBucket = "minute" | "hour" | "day";
export type TimeseriesPoint = {
  bucket: string;
  n: number;
  cost: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  avg_latency_ms: number;
  errors: number;
};
export type TimeseriesResp = {
  bucket: TimeseriesBucket;
  hours: number;
  points: TimeseriesPoint[];
};

export type HeatmapCell = { dow: number; hour: number; n: number; cost: number };
export type HeatmapResp = { days: number; cells: HeatmapCell[] };

export type LatencyResp = {
  count: number;
  p50: number;
  p90: number;
  p95: number;
  p99: number;
  max: number;
  min: number;
  histogram: { label: string; count: number }[];
};

export type ToolUsage = {
  name: string;
  count: number;
  avg_latency_ms: number;
  cost: number;
  error_rate: number;
  top_model: string | null;
  sample_args: string[] | null;
};
export type ToolsResp = { tools: ToolUsage[]; total: number };

export type UserUsage = {
  user_id: string;
  request_count: number;
  session_count: number;
  cost: number;
  tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  avg_latency_ms: number;
  errors: number;
  last_seen: number;
};
export type UsersResp = { users: UserUsage[]; total: number };

export type SearchResp = { requests: RequestRow[]; q: string };

export type SessionsAggregates = {
  count: number;
  total_cost: number;
  total_tokens: number;
  total_cache_read_tokens: number;
  total_cache_creation_tokens: number;
  avg_requests_per_session: number;
  top_model: string | null;
};

export type RequestsAggregates = {
  count: number;
  total_cost: number;
  avg_latency_ms: number;
  p95_latency_ms: number;
  error_count: number;
  error_rate: number;
};

export type UsersAggregates = {
  active: number;
  total_cost: number;
  total_tokens: number;
  total_cache_read_tokens: number;
  total_cache_creation_tokens: number;
  top_user_id: string | null;
  top_user_cost: number;
};

export type ToolsAggregates = {
  count: number;
  total_calls: number;
  total_cost: number;
  error_rate: number;
};

// Insights types — re-exported via the insights module too. We type just
// enough for the join endpoints; full SessionMeta lives in insights/types.
export type InsightsSessionStub = import("./insights/types").SessionMeta;
export type InsightsUser = import("./insights/types").User;
export type InsightsSessionsResp = {
  sessions: InsightsSessionStub[];
  total: number;
};
export type UserInsightsBundle = {
  user: InsightsUser | null;
  sessions: InsightsSessionStub[];
  total: number;
};
export type SessionInsights = { session: InsightsSessionStub | null };

// Common shape for paginated query parameters that most list endpoints accept.
export type ListQuery = {
  limit?: number;
  offset?: number;
  q?: string;
  user?: string;
  since?: number;
  until?: number;
};

function qs(params: Record<string, string | number | boolean | undefined>): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v == null || v === "" || v === false) continue;
    u.set(k, String(v));
  }
  const s = u.toString();
  return s ? `?${s}` : "";
}

export const api = {
  stats: () => fetch("/api/stats").then(j<Stats>),

  sessions: (q: ListQuery = {}) =>
    fetch(`/api/sessions${qs(q)}`).then(j<{ sessions: SessionRow[]; total: number }>),
  sessionsAggregates: (q: ListQuery = {}) =>
    fetch(`/api/sessions/aggregates${qs(q)}`).then(j<SessionsAggregates>),
  session: (id: string) =>
    fetch(`/api/sessions/${encodeURIComponent(id)}`).then(
      j<{ session: SessionRow; requests: RequestRow[] }>,
    ),
  sessionInsights: (id: string) =>
    fetch(`/api/sessions/${encodeURIComponent(id)}/insights`).then(j<SessionInsights>),

  requests: (
    q: ListQuery & { model?: string; status?: string; session?: string } = {},
  ) =>
    fetch(`/api/requests${qs(q)}`).then(j<{ requests: RequestRow[]; total: number }>),
  requestsAggregates: (
    q: ListQuery & { model?: string; status?: string; session?: string } = {},
  ) => fetch(`/api/requests/aggregates${qs(q)}`).then(j<RequestsAggregates>),
  request: (id: string) =>
    fetch(`/api/requests/${encodeURIComponent(id)}`).then(j<RequestDetail>),

  users: (q: { limit?: number; offset?: number; q?: string; friction?: string } = {}) =>
    fetch(`/api/users${qs(q)}`).then(j<UsersResp>),
  usersAggregates: () => fetch(`/api/users/aggregates`).then(j<UsersAggregates>),
  userInsights: (
    idOrRaw: string,
    q: { friction?: string; limit?: number; offset?: number } = {},
  ) =>
    fetch(`/api/users/${encodeURIComponent(idOrRaw)}/insights${qs(q)}`).then(
      j<UserInsightsBundle>,
    ),

  tools: (q: { limit?: number; offset?: number; q?: string; errorsOnly?: boolean } = {}) =>
    fetch(`/api/tools${qs({ ...q, errorsOnly: q.errorsOnly ? 1 : undefined })}`).then(
      j<ToolsResp>,
    ),
  toolsAggregates: () => fetch(`/api/tools/aggregates`).then(j<ToolsAggregates>),

  providers: () => fetch("/api/providers").then(j<{ providers: Provider[] }>),

  timeseries: (bucket: TimeseriesBucket = "hour", hours = 24) =>
    fetch(`/api/timeseries?bucket=${bucket}&hours=${hours}`).then(j<TimeseriesResp>),
  heatmap: (days = 7) => fetch(`/api/heatmap?days=${days}`).then(j<HeatmapResp>),
  latency: () => fetch("/api/latency").then(j<LatencyResp>),
  search: (q: string) =>
    fetch(`/api/search?q=${encodeURIComponent(q)}`).then(j<SearchResp>),

  insightsSessionsByFilter: (
    q: { friction?: string; user?: string; limit?: number; offset?: number },
  ) => fetch(`/api/insights/sessions${qs(q)}`).then(j<InsightsSessionsResp>),

  // Destructive: delete a session and everything tied to it (requests,
  // insights row, transcript, extract cache, queued/done jobs). Same blast
  // radius as the manual cleanup the proxy does on `clearInsights`, but
  // scoped to one session id.
  deleteSession: (id: string) =>
    fetch(`/api/sessions/${encodeURIComponent(id)}`, { method: "DELETE" }).then(
      j<{ ok: true }>,
    ),
  // Destructive: delete every session this user owned + the user row itself.
  // The display id "(anonymous)" maps server-side to NULL user_id rows.
  deleteUser: (id: string) =>
    fetch(`/api/users/${encodeURIComponent(id)}`, { method: "DELETE" }).then(
      j<{ ok: true; sessionsDeleted: number }>,
    ),
};
