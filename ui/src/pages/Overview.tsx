import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  api,
  type HeatmapResp,
  type LatencyResp,
  type RequestRow,
  type Stats,
  type TimeseriesResp,
} from "../api";
import { Sparkline } from "../components/Sparkline";
import { Heatmap } from "../components/Heatmap";
import { EmptyState } from "../components/EmptyState";
import { fmt } from "../format";

type Metric = "requests" | "cost" | "tokens" | "latency";

const PALETTE = [
  "var(--color-mint)",
  "var(--color-butter)",
  "var(--color-peach)",
  "var(--color-lavender)",
  "var(--color-sky)",
  "var(--color-rose)",
  "var(--color-lime)",
];

const CURL_DEMO = `curl http://localhost:8080/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "x-nebula-session: demo-1" \\
  -d '{"model":"openai/gpt-4o-mini",
       "messages":[{"role":"user","content":"Hello, Nebula!"}]}'`;

export function OverviewPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [ts, setTs] = useState<TimeseriesResp | null>(null);
  const [heat, setHeat] = useState<HeatmapResp | null>(null);
  const [lat, setLat] = useState<LatencyResp | null>(null);
  const [feed, setFeed] = useState<RequestRow[]>([]);
  const seenIds = useRef<Set<string>>(new Set());
  const [newIds, setNewIds] = useState<Set<string>>(new Set());
  const [metric, setMetric] = useState<Metric>("requests");
  const [err, setErr] = useState<string | null>(null);

  // Stats / charts poll (4s)
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const [s, t, h, l] = await Promise.all([
          api.stats(),
          api.timeseries("hour", 24),
          api.heatmap(7),
          api.latency(),
        ]);
        if (!alive) return;
        setStats(s);
        setTs(t);
        setHeat(h);
        setLat(l);
        setErr(null);
      } catch (e) {
        if (alive) setErr(String(e));
      }
    };
    tick();
    const id = setInterval(tick, 4000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  // Live feed poll (2s)
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const r = await api.requests({ limit: 8 });
        if (!alive) return;
        const incoming = r.requests;
        // Detect new ids on second+ fetch only
        if (seenIds.current.size > 0) {
          const fresh = new Set<string>();
          for (const row of incoming) {
            if (!seenIds.current.has(row.id)) fresh.add(row.id);
          }
          if (fresh.size) {
            setNewIds(fresh);
            setTimeout(() => alive && setNewIds(new Set()), 700);
          }
        }
        seenIds.current = new Set(incoming.map((x) => x.id));
        setFeed(incoming);
      } catch {
        // ignore
      }
    };
    tick();
    const id = setInterval(tick, 2000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const sparkSeries = useMemo(() => {
    const pts = ts?.points ?? [];
    return {
      requests: pts.map((p) => p.n),
      cost: pts.map((p) => p.cost),
      tokensIn: pts.map((p) => p.input_tokens),
      tokensOut: pts.map((p) => p.output_tokens),
      tokens: pts.map((p) => p.input_tokens + p.output_tokens),
      latency: pts.map((p) => p.avg_latency_ms),
      errors: pts.map((p) => p.errors),
    };
  }, [ts]);

  const chartData = useMemo(() => {
    return (ts?.points ?? []).map((p) => ({
      t: bucketLabel(p.bucket),
      requests: p.n,
      cost: round(p.cost, 4),
      tokensIn: p.input_tokens,
      tokensOut: p.output_tokens,
      latency: Math.round(p.avg_latency_ms || 0),
    }));
  }, [ts]);

  const modelDonut = useMemo(() => {
    const arr = stats?.byModel ?? [];
    return arr.slice(0, 7).map((m, i) => ({
      name: m.model,
      value: m.n,
      fill: PALETTE[i % PALETTE.length],
    }));
  }, [stats]);

  const totalReqs = stats?.request_count ?? 0;

  if (err && !stats)
    return (
      <div className="nb-card p-5" style={{ background: "var(--color-rose)" }}>
        Couldn't load stats: {err}
      </div>
    );
  if (!stats) return <div className="nb-card p-5">Loading…</div>;

  return (
    <div className="space-y-6">
      {/* Stat cards w/ sparklines */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
        <StatCard
          label="Sessions"
          value={fmt.num(stats.session_count)}
          color="var(--color-mint)"
          spark={sparkSeries.requests}
        />
        <StatCard
          label="Requests"
          value={fmt.num(stats.request_count)}
          color="var(--color-butter)"
          spark={sparkSeries.requests}
        />
        <StatCard
          label="Total cost"
          value={fmt.cost(stats.cost)}
          color="var(--color-peach)"
          hint="estimated"
          spark={sparkSeries.cost}
        />
        <StatCard
          label="Tokens"
          value={fmt.num(stats.input_tokens + stats.output_tokens)}
          color="var(--color-lavender)"
          hint={`${fmt.num(stats.input_tokens)} in · ${fmt.num(stats.output_tokens)} out`}
          spark={sparkSeries.tokens}
        />
        <StatCard
          label="Avg latency"
          value={`${Math.round(stats.avg_latency_ms || 0)}ms`}
          color="var(--color-sky)"
          spark={sparkSeries.latency}
        />
        <StatCard
          label="Errors"
          value={fmt.num(stats.error_count ?? 0)}
          color="var(--color-rose)"
          spark={sparkSeries.errors}
        />
      </div>

      {/* Activity area chart + Model donut */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="nb-card nb-hover p-5 lg:col-span-2">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <h3 className="font-display text-lg font-bold">Activity · last 24h</h3>
            <div className="ml-auto flex flex-wrap gap-1">
              {(["requests", "tokens", "cost", "latency"] as Metric[]).map((m) => (
                <button
                  key={m}
                  onClick={() => setMetric(m)}
                  className="nb-chip"
                  style={{
                    background:
                      metric === m ? "var(--color-butter)" : "#fff",
                    cursor: "pointer",
                  }}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>
          {chartData.length === 0 ? (
            <EmptyState
              title="No traffic in the last 24h"
              hint="Activity charts populate as soon as requests start hitting the gateway."
              curl={CURL_DEMO}
              illustration="chart"
            />
          ) : (
            <div style={{ height: 280 }}>
              <ResponsiveContainer width="100%" height="100%">
                {metric === "tokens" ? (
                  <AreaChart data={chartData} margin={{ top: 8, right: 12, left: -10, bottom: 0 }}>
                    <CartesianGrid vertical={false} strokeDasharray="0" />
                    <XAxis dataKey="t" tickLine={false} />
                    <YAxis tickLine={false} />
                    <Tooltip />
                    <Area
                      type="monotone"
                      dataKey="tokensIn"
                      stackId="1"
                      stroke="#111"
                      strokeWidth={3}
                      fill="var(--color-sky)"
                      isAnimationActive={false}
                      name="input"
                    />
                    <Area
                      type="monotone"
                      dataKey="tokensOut"
                      stackId="1"
                      stroke="#111"
                      strokeWidth={3}
                      fill="var(--color-mint)"
                      isAnimationActive={false}
                      name="output"
                    />
                  </AreaChart>
                ) : metric === "requests" ? (
                  <AreaChart data={chartData} margin={{ top: 8, right: 12, left: -10, bottom: 0 }}>
                    <CartesianGrid vertical={false} strokeDasharray="0" />
                    <XAxis dataKey="t" tickLine={false} />
                    <YAxis tickLine={false} allowDecimals={false} />
                    <Tooltip />
                    <Area
                      type="monotone"
                      dataKey="requests"
                      stroke="#111"
                      strokeWidth={3}
                      fill="var(--color-butter)"
                      isAnimationActive={false}
                    />
                  </AreaChart>
                ) : metric === "cost" ? (
                  <AreaChart data={chartData} margin={{ top: 8, right: 12, left: -10, bottom: 0 }}>
                    <CartesianGrid vertical={false} strokeDasharray="0" />
                    <XAxis dataKey="t" tickLine={false} />
                    <YAxis tickLine={false} />
                    <Tooltip />
                    <Area
                      type="monotone"
                      dataKey="cost"
                      stroke="#111"
                      strokeWidth={3}
                      fill="var(--color-peach)"
                      isAnimationActive={false}
                    />
                  </AreaChart>
                ) : (
                  <AreaChart data={chartData} margin={{ top: 8, right: 12, left: -10, bottom: 0 }}>
                    <CartesianGrid vertical={false} strokeDasharray="0" />
                    <XAxis dataKey="t" tickLine={false} />
                    <YAxis tickLine={false} />
                    <Tooltip />
                    <Area
                      type="monotone"
                      dataKey="latency"
                      stroke="#111"
                      strokeWidth={3}
                      fill="var(--color-lavender)"
                      isAnimationActive={false}
                    />
                  </AreaChart>
                )}
              </ResponsiveContainer>
            </div>
          )}
        </div>

        <div className="nb-card nb-hover p-5">
          <h3 className="font-display text-lg font-bold">Model share</h3>
          <p className="mb-2 text-xs opacity-60">By request count</p>
          {modelDonut.length === 0 ? (
            <EmptyState
              title="No models yet"
              hint="Models will appear here as requests come in."
              illustration="chart"
            />
          ) : (
            <>
              <div style={{ height: 200 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={modelDonut}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={45}
                      outerRadius={80}
                      stroke="#111"
                      strokeWidth={3}
                      isAnimationActive={false}
                    >
                      {modelDonut.map((d, i) => (
                        <Cell key={i} fill={d.fill} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <ul className="mt-2 space-y-1">
                {modelDonut.map((d, i) => (
                  <li key={i} className="flex items-center gap-2 text-xs">
                    <span
                      className="inline-block h-3 w-3 border-2 border-[var(--color-ink)]"
                      style={{ background: d.fill }}
                    />
                    <span className="nb-tag truncate">{d.name}</span>
                    <span className="ml-auto tabular-nums opacity-70">
                      {d.value}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>

      {/* Latency + Heatmap */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="nb-card nb-hover p-5">
          <h3 className="font-display text-lg font-bold">Latency distribution</h3>
          <p className="mb-3 text-xs opacity-60">Across all requests (ms)</p>
          {!lat || lat.count === 0 ? (
            <EmptyState
              title="No latency data yet"
              hint="Percentiles appear once requests complete."
              illustration="chart"
            />
          ) : (
            <>
              <div className="grid grid-cols-4 gap-2">
                <Pct label="p50" v={lat.p50} bg="var(--color-mint)" />
                <Pct label="p90" v={lat.p90} bg="var(--color-butter)" />
                <Pct label="p95" v={lat.p95} bg="var(--color-peach)" />
                <Pct label="p99" v={lat.p99} bg="var(--color-rose)" />
              </div>
              <div className="mt-4" style={{ height: 180 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={lat.histogram} margin={{ top: 6, right: 10, left: -16, bottom: 0 }}>
                    <CartesianGrid vertical={false} strokeDasharray="0" />
                    <XAxis dataKey="label" tickLine={false} interval={0} />
                    <YAxis tickLine={false} allowDecimals={false} />
                    <Tooltip />
                    <Bar
                      dataKey="count"
                      fill="var(--color-lavender)"
                      stroke="#111"
                      strokeWidth={2}
                      radius={2}
                      isAnimationActive={false}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </>
          )}
        </div>

        <div className="nb-card nb-hover p-5">
          <h3 className="font-display text-lg font-bold">When traffic happens</h3>
          <p className="mb-3 text-xs opacity-60">7-day heatmap · day of week × hour</p>
          {heat ? <Heatmap cells={heat.cells} /> : <div className="text-sm opacity-60">Loading…</div>}
        </div>
      </div>

      {/* Providers + Live feed */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="nb-card nb-hover p-5 lg:col-span-2">
          <h3 className="font-display text-lg font-bold">Providers</h3>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
            {(stats.byProvider ?? []).map((p) => {
              const share = totalReqs > 0 ? p.n / totalReqs : 0;
              return (
                <div
                  key={p.provider}
                  className="nb-card-flat px-3 py-2 text-sm"
                  style={{ background: "var(--color-mist)" }}
                >
                  <div className="font-mono text-xs uppercase opacity-60">{p.provider}</div>
                  <div className="text-xl font-bold tabular-nums">{fmt.num(p.n)}</div>
                  <div className="text-xs opacity-70">{fmt.cost(p.cost)}</div>
                  <div
                    className="mt-2 h-2 w-full border-2 border-[var(--color-ink)]"
                    style={{ background: "#fff" }}
                  >
                    <div
                      style={{
                        width: `${Math.max(2, Math.round(share * 100))}%`,
                        height: "100%",
                        background: "var(--color-rose)",
                      }}
                    />
                  </div>
                  <div className="mt-1 text-[10px] opacity-60">
                    {Math.round(share * 100)}% share
                  </div>
                </div>
              );
            })}
            {!stats.byProvider?.length && (
              <div className="col-span-full text-sm opacity-60">No traffic yet.</div>
            )}
          </div>
        </div>

        <div className="nb-card nb-hover p-5">
          <div className="mb-2 flex items-center gap-2">
            <h3 className="font-display text-lg font-bold">Live feed</h3>
            <span className="nb-chip" style={{ background: "var(--color-mint)" }}>
              <span className="inline-block h-2 w-2 rounded-full bg-[var(--color-ok)] nb-pulse" />
              auto · 2s
            </span>
          </div>
          {feed.length === 0 ? (
            <div className="text-sm opacity-60">Waiting for traffic…</div>
          ) : (
            <ul className="space-y-2">
              {feed.map((r) => (
                <li
                  key={r.id}
                  className={`nb-card-flat p-2 ${newIds.has(r.id) ? "nb-flash nb-slide-in" : ""}`}
                >
                  <Link
                    to={`/requests/${encodeURIComponent(r.id)}`}
                    className="flex items-center gap-2 text-xs"
                  >
                    <span
                      className="nb-chip"
                      style={{
                        background:
                          r.status === "ok"
                            ? "var(--color-mint)"
                            : "var(--color-rose)",
                      }}
                    >
                      {r.status}
                    </span>
                    <span className="nb-tag truncate">{r.model}</span>
                    <span className="ml-auto whitespace-nowrap tabular-nums opacity-70">
                      {fmt.ms(r.latency_ms)}
                    </span>
                  </Link>
                  <div className="mt-1 flex items-center justify-between text-[10px] opacity-60">
                    <span className="font-mono">{r.id.slice(0, 10)}</span>
                    <span>{fmt.rel(r.started_at)}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  hint,
  color,
  spark,
}: {
  label: string;
  value: string;
  hint?: string;
  color: string;
  spark?: number[];
}) {
  return (
    <div className="nb-card nb-hover p-4" style={{ background: color }}>
      <div className="text-[10px] font-bold uppercase tracking-widest opacity-70">
        {label}
      </div>
      <div className="mt-1 font-display text-2xl font-bold tabular-nums">
        {value}
      </div>
      {hint && <div className="mt-1 text-[11px] opacity-60">{hint}</div>}
      {spark && spark.length > 1 && (
        <div className="mt-2">
          <Sparkline values={spark} width={140} height={22} />
        </div>
      )}
    </div>
  );
}

function Pct({ label, v, bg }: { label: string; v: number; bg: string }) {
  return (
    <div className="nb-card-flat p-2 text-center" style={{ background: bg }}>
      <div className="text-[10px] font-bold uppercase opacity-70">{label}</div>
      <div className="font-display text-lg font-bold tabular-nums">
        {Math.round(v)}ms
      </div>
    </div>
  );
}

function bucketLabel(b: string): string {
  // bucket strings come from sqlite strftime; show last segment.
  // e.g. "2026-05-09 14:00" -> "14"
  const m = b.match(/(\d{1,2}):\d{2}$/);
  if (m) return m[1];
  const d = b.match(/(\d{4})-(\d{2})-(\d{2})$/);
  if (d) return `${d[2]}/${d[3]}`;
  return b.slice(-5);
}

function round(n: number, d: number): number {
  const f = 10 ** d;
  return Math.round(n * f) / f;
}
