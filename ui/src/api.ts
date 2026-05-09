async function j<T>(r: Response): Promise<T> {
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json();
}

export type Stats = {
  request_count: number;
  input_tokens: number;
  output_tokens: number;
  cost: number;
  avg_latency_ms: number;
  error_count: number | null;
  session_count: number;
  byModel: { model: string; n: number; cost: number; tokens: number }[];
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
  cost: number | null;
  finish_reason: string | null;
};

// Loose payload types - request/response JSON shapes vary by provider
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

export type Provider = { id: string; configured: boolean; base_url: string };

export type TimeseriesBucket = "minute" | "hour" | "day";
export type TimeseriesPoint = {
  bucket: string;
  n: number;
  cost: number;
  input_tokens: number;
  output_tokens: number;
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
  top_model: string;
  sample_args: string | null;
};
export type ToolsResp = { tools: ToolUsage[] };

export type UserUsage = {
  user_id: string;
  request_count: number;
  session_count: number;
  cost: number;
  tokens: number;
  avg_latency_ms: number;
  errors: number;
  last_seen: number;
};
export type UsersResp = { users: UserUsage[] };

export type SearchResp = { requests: RequestRow[]; q: string };

export const api = {
  stats: () => fetch("/api/stats").then(j<Stats>),
  sessions: (limit = 50, offset = 0) =>
    fetch(`/api/sessions?limit=${limit}&offset=${offset}`).then(
      j<{ sessions: SessionRow[]; total: number }>,
    ),
  session: (id: string) =>
    fetch(`/api/sessions/${encodeURIComponent(id)}`).then(
      j<{ session: SessionRow; requests: RequestRow[] }>,
    ),
  requests: (q: { limit?: number; offset?: number; model?: string; status?: string; session?: string } = {}) => {
    const p = new URLSearchParams();
    if (q.limit) p.set("limit", String(q.limit));
    if (q.offset) p.set("offset", String(q.offset));
    if (q.model) p.set("model", q.model);
    if (q.status) p.set("status", q.status);
    if (q.session) p.set("session", q.session);
    return fetch(`/api/requests?${p}`).then(j<{ requests: RequestRow[]; total: number }>);
  },
  request: (id: string) =>
    fetch(`/api/requests/${encodeURIComponent(id)}`).then(j<RequestDetail>),
  providers: () => fetch("/api/providers").then(j<{ providers: Provider[] }>),

  timeseries: (bucket: TimeseriesBucket = "hour", hours = 24) =>
    fetch(`/api/timeseries?bucket=${bucket}&hours=${hours}`).then(j<TimeseriesResp>),
  heatmap: (days = 7) =>
    fetch(`/api/heatmap?days=${days}`).then(j<HeatmapResp>),
  latency: () => fetch("/api/latency").then(j<LatencyResp>),
  tools: () => fetch("/api/tools").then(j<ToolsResp>),
  users: () => fetch("/api/users").then(j<UsersResp>),
  search: (q: string) =>
    fetch(`/api/search?q=${encodeURIComponent(q)}`).then(j<SearchResp>),
};
