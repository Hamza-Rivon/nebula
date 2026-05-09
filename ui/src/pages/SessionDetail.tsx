import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, type RequestDetail, type RequestRow, type SessionRow } from "../api";
import { ConversationView, extractEvents, type ConvEvent } from "../components/ConversationView";
import { EmptyState } from "../components/EmptyState";
import { fmt } from "../format";

type View = "table" | "timeline" | "flow";

const PROVIDER_COLOR: Record<string, string> = {
  anthropic: "var(--color-mint)",
  openai: "var(--color-butter)",
  kimi: "var(--color-peach)",
  google: "var(--color-lavender)",
  groq: "var(--color-sky)",
  mistral: "var(--color-rose)",
  ollama: "var(--color-lime)",
};

function providerColor(p: string): string {
  return PROVIDER_COLOR[p.toLowerCase()] ?? "var(--color-mist)";
}

export function SessionDetailPage() {
  const { id = "" } = useParams();
  const [data, setData] = useState<{ session: SessionRow; requests: RequestRow[] } | null>(null);
  const [view, setView] = useState<View>("flow");
  const [err, setErr] = useState<string | null>(null);
  const seen = useRef<Set<string>>(new Set());
  const [newIds, setNewIds] = useState<Set<string>>(new Set());
  const [details, setDetails] = useState<Record<string, RequestDetail>>({});

  useEffect(() => {
    let alive = true;
    const tick = () =>
      api
        .session(id)
        .then((d) => {
          if (!alive) return;
          if (seen.current.size > 0) {
            const fresh = new Set<string>();
            for (const r of d.requests) {
              if (!seen.current.has(r.id)) fresh.add(r.id);
            }
            if (fresh.size) {
              setNewIds(fresh);
              setTimeout(() => alive && setNewIds(new Set()), 700);
            }
          }
          seen.current = new Set(d.requests.map((x) => x.id));
          setData(d);
        })
        .catch((e) => alive && setErr(String(e)));
    tick();
    const t = setInterval(tick, 4000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [id]);

  // Lazy-fetch details for all requests in the session (capped at 30) so we can
  // power the Gantt stats line and the Flow view. Cached by id.
  useEffect(() => {
    if (!data) return;
    let alive = true;
    const need = data.requests.slice(0, 30).filter((r) => !details[r.id]);
    Promise.all(
      need.map((r) =>
        api
          .request(r.id)
          .then((d) => [r.id, d] as const)
          .catch(() => null),
      ),
    ).then((results) => {
      if (!alive) return;
      setDetails((m) => {
        const next = { ...m };
        for (const r of results) {
          if (r) next[r[0]] = r[1];
        }
        return next;
      });
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.requests.map((r) => r.id).join(",")]);

  if (err) return <div className="nb-card p-5" style={{ background: "var(--color-rose)" }}>{err}</div>;
  if (!data) return <div className="nb-card p-5">Loading…</div>;
  const s = data.session;
  const exportHref = `/api/sessions/${encodeURIComponent(s.id)}/export.jsonl`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline gap-3">
        <Link to="/sessions" className="nb-btn" data-variant="ghost">← Back</Link>
        <h2 className="font-display text-2xl font-bold">Session</h2>
        <span className="nb-tag">{s.id}</span>
        {s.user_id && <span className="nb-chip">user · {s.user_id}</span>}
        <a
          href={exportHref}
          download={`session-${s.id}.jsonl`}
          className="nb-btn ml-auto"
          style={{ background: "var(--color-lime)" }}
        >
          Export JSONL
        </a>
        <div className="flex gap-2">
          {(["flow", "table", "timeline"] as View[]).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className="nb-chip"
              style={{
                background: view === v ? "var(--color-butter)" : "#fff",
                cursor: "pointer",
                textTransform: "capitalize",
              }}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <div className="nb-card p-4" style={{ background: "var(--color-butter)" }}>
          <div className="text-xs uppercase opacity-70">Requests</div>
          <div className="text-2xl font-bold tabular-nums">{fmt.num(s.request_count)}</div>
        </div>
        <div className="nb-card p-4" style={{ background: "var(--color-peach)" }}>
          <div className="text-xs uppercase opacity-70">Cost</div>
          <div className="text-2xl font-bold tabular-nums">{fmt.cost(s.total_cost)}</div>
        </div>
        <div className="nb-card p-4" style={{ background: "var(--color-lavender)" }}>
          <div className="text-xs uppercase opacity-70">Tokens</div>
          <div className="text-2xl font-bold tabular-nums">
            {fmt.num(s.total_input_tokens + s.total_output_tokens)}
          </div>
        </div>
        <div className="nb-card p-4" style={{ background: "var(--color-sky)" }}>
          <div className="text-xs uppercase opacity-70">Started</div>
          <div className="text-sm font-bold">{fmt.date(s.created_at)}</div>
        </div>
      </div>

      <GanttStats requests={data.requests} details={details} />

      <GanttStrip requests={data.requests} details={details} />

      {view === "table" ? (
        <TableView requests={data.requests} newIds={newIds} />
      ) : view === "timeline" ? (
        <TimelineView requests={data.requests} newIds={newIds} details={details} />
      ) : (
        <FlowView requests={data.requests} details={details} />
      )}
    </div>
  );
}

// =============================================================================
// Gantt stats — promoted out of the Gantt card
// =============================================================================

function computeSessionStats(
  requests: RequestRow[],
  details: Record<string, RequestDetail>,
) {
  if (requests.length === 0) {
    return {
      totalWall: 0,
      totalCompute: 0,
      totalToolCalls: 0,
      avgLatency: 0,
      streamedCount: 0,
      t0: 0,
      tEnd: 0,
    };
  }
  const t0 = Math.min(...requests.map((r) => r.started_at));
  const tEnd = Math.max(
    ...requests.map((r) => r.finished_at ?? r.started_at + (r.latency_ms ?? 0)),
  );
  let totalCompute = 0;
  let totalToolCalls = 0;
  let totalLatency = 0;
  let latencyN = 0;
  let streamedCount = 0;
  for (const r of requests) {
    totalCompute += r.latency_ms ?? 0;
    if (r.latency_ms != null) {
      totalLatency += r.latency_ms;
      latencyN += 1;
    }
    if (r.streamed) streamedCount += 1;
    const d = details[r.id];
    if (d?.tool_calls) totalToolCalls += d.tool_calls.length;
  }
  return {
    totalWall: tEnd - t0,
    totalCompute,
    totalToolCalls,
    avgLatency: latencyN > 0 ? totalLatency / latencyN : 0,
    streamedCount,
    t0,
    tEnd,
  };
}

function GanttStats({
  requests,
  details,
}: {
  requests: RequestRow[];
  details: Record<string, RequestDetail>;
}) {
  const s = useMemo(
    () => computeSessionStats(requests, details),
    [requests, details],
  );
  if (requests.length === 0) return null;
  return (
    <div className="nb-card-flat px-4 py-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11px] tabular-nums">
        <span>
          <strong>wall</strong> {msToLabel(s.totalWall)}
        </span>
        <span className="opacity-30">·</span>
        <span>
          <strong>compute</strong> {msToLabel(s.totalCompute)}
        </span>
        <span className="opacity-30">·</span>
        <span>
          <strong>avg</strong> {msToLabel(s.avgLatency)}
        </span>
        <span className="opacity-30">·</span>
        <span>
          <strong>tool calls</strong> {s.totalToolCalls}
        </span>
        <span className="opacity-30">·</span>
        <span>
          <strong>streamed</strong> {s.streamedCount}/{requests.length}
        </span>
        <span className="opacity-30">·</span>
        <span>
          <strong>requests</strong> {requests.length}
        </span>
      </div>
    </div>
  );
}

// =============================================================================
// Gantt strip
// =============================================================================

const MAX_VISIBLE_LANES = 5;

type LanePlacement = { r: RequestRow; lane: number; start: number; end: number };

function GanttStrip({
  requests,
  details,
}: {
  requests: RequestRow[];
  details: Record<string, RequestDetail>;
}) {
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState<{
    r: RequestRow;
    px: number;
    py: number;
    cw: number;
    ch: number;
  } | null>(null);

  const data = useMemo(() => {
    if (requests.length === 0) {
      return {
        placements: [] as LanePlacement[],
        overflow: [] as LanePlacement[],
        laneCount: 0,
        overflowCount: 0,
        t0: 0,
        tEnd: 0,
        totalWall: 0,
      };
    }
    const min = Math.min(...requests.map((r) => r.started_at));
    const max = Math.max(
      ...requests.map((r) => r.finished_at ?? r.started_at + (r.latency_ms ?? 0)),
    );
    const sorted = [...requests].sort((a, b) => a.started_at - b.started_at);

    // Greedy lane assignment: first lane whose last bar ends <= this start.
    const laneEnds: number[] = [];
    const placed: LanePlacement[] = [];
    for (const r of sorted) {
      const start = r.started_at;
      const end = r.finished_at ?? start + (r.latency_ms ?? 0);
      let li = laneEnds.findIndex((e) => e <= start);
      if (li === -1) {
        li = laneEnds.length;
        laneEnds.push(end);
      } else {
        laneEnds[li] = end;
      }
      placed.push({ r, lane: li, start, end });
    }

    const visible = placed.filter((p) => p.lane < MAX_VISIBLE_LANES);
    const overflow = placed.filter((p) => p.lane >= MAX_VISIBLE_LANES);
    const laneCount = Math.min(MAX_VISIBLE_LANES, laneEnds.length);
    const overflowLanes = Math.max(0, laneEnds.length - MAX_VISIBLE_LANES);

    return {
      placements: visible,
      overflow,
      laneCount,
      overflowCount: overflowLanes,
      t0: min,
      tEnd: max,
      totalWall: max - min,
    };
  }, [requests]);

  if (requests.length === 0) return null;

  const {
    placements,
    overflow,
    laneCount,
    overflowCount,
    t0,
    tEnd,
    totalWall,
  } = data;

  // SVG layout
  const W = 1000;
  const padX = 10;
  const laneH = 22;
  const laneGap = 4;
  const headerH = 22;
  const overflowH = overflowCount > 0 ? 18 : 0;
  const innerW = W - padX * 2;
  const visualLaneCount = Math.max(1, laneCount);
  const H = headerH + visualLaneCount * (laneH + laneGap) + overflowH + 6;
  const span = Math.max(1, tEnd - t0);

  const xFor = (t: number) => padX + ((t - t0) / span) * innerW;
  const wFor = (a: number, b: number) => Math.max(3, ((b - a) / span) * innerW);

  const ticks = buildTicks(t0, tEnd, span);

  return (
    <div className={open ? "nb-card p-4" : "nb-card-flat px-4 py-2"}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 text-left"
        style={{ background: "transparent", cursor: "pointer" }}
        aria-expanded={open}
      >
        <div className="flex items-center gap-2">
          <span
            className="font-mono text-[11px] opacity-60"
            aria-hidden
            style={{ width: 12, display: "inline-block" }}
          >
            {open ? "▾" : "▸"}
          </span>
          <h3 className="font-display text-sm font-bold uppercase tracking-widest opacity-70">
            Wall-clock timeline
          </h3>
          <span className="nb-chip" style={{ background: "var(--color-mist)" }}>
            {requests.length} request{requests.length === 1 ? "" : "s"} ·{" "}
            {msToLabel(totalWall)} span
          </span>
        </div>
        {open && (
          <div className="font-mono text-[11px] opacity-60">
            {fmt.date(t0)} → {fmt.date(tEnd)}
          </div>
        )}
      </button>
      {!open ? null : (
      <div
        className="relative mt-2 overflow-hidden"
        onMouseLeave={() => setHover(null)}
        style={{ borderRadius: 6 }}
      >
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          style={{
            width: "100%",
            height: `${Math.max(72, H * 1.6)}px`,
            display: "block",
          }}
        >
          {/* lane row tints + 1px ink separators */}
          {Array.from({ length: visualLaneCount }).map((_, li) => {
            const y = headerH + li * (laneH + laneGap);
            return (
              <g key={`lane-${li}`}>
                <rect
                  x={padX}
                  y={y - laneGap / 2}
                  width={innerW}
                  height={laneH + laneGap}
                  fill="var(--color-mist)"
                  opacity={li % 2 === 0 ? 0.5 : 0.2}
                />
                {li < visualLaneCount - 1 ? (
                  <line
                    x1={padX}
                    x2={padX + innerW}
                    y1={y + laneH + laneGap / 2}
                    y2={y + laneH + laneGap / 2}
                    stroke="var(--color-ink)"
                    strokeWidth={1}
                    opacity={0.85}
                  />
                ) : null}
              </g>
            );
          })}

          {/* dashed vertical guides + tick labels */}
          {ticks.map((tk, i) => (
            <g key={`tk-${i}`}>
              <line
                x1={xFor(tk.t)}
                x2={xFor(tk.t)}
                y1={headerH}
                y2={H - 2}
                stroke="var(--color-ink)"
                strokeWidth={1}
                strokeDasharray="3 3"
                opacity={0.15}
              />
              <text
                x={xFor(tk.t)}
                y={14}
                fontSize={10}
                fontFamily="JetBrains Mono, monospace"
                fill="var(--color-ink)"
                opacity={0.7}
                textAnchor={
                  i === 0
                    ? "start"
                    : i === ticks.length - 1
                      ? "end"
                      : "middle"
                }
              >
                {tk.label}
              </text>
            </g>
          ))}

          {/* bars */}
          {placements.map((p) => {
            const r = p.r;
            const x = xFor(p.start);
            const w = wFor(p.start, p.end);
            const y = headerH + p.lane * (laneH + laneGap);
            const fill =
              r.status === "ok" ? providerColor(r.provider) : "var(--color-rose)";
            const tcCount = details[r.id]?.tool_calls?.length ?? 0;

            return (
              <Link key={r.id} to={`/requests/${encodeURIComponent(r.id)}`}>
                <g
                  onMouseMove={(e) => {
                    const svg = e.currentTarget.ownerSVGElement as SVGSVGElement;
                    const rect = svg.getBoundingClientRect();
                    setHover({
                      r,
                      px: e.clientX - rect.left,
                      py: e.clientY - rect.top,
                      cw: rect.width,
                      ch: rect.height,
                    });
                  }}
                  onMouseLeave={() => setHover(null)}
                  style={{ cursor: "pointer" }}
                >
                  <rect
                    x={x}
                    y={y}
                    width={w}
                    height={laneH}
                    fill={fill}
                    stroke="var(--color-ink)"
                    strokeWidth={3}
                    rx={3}
                  />
                  {/* tool-call markers */}
                  {tcCount > 0 && tcCount <= 12 && w > 24
                    ? Array.from({ length: tcCount }).map((_, i) => {
                        const cx = x + (w * (i + 1)) / (tcCount + 1) - 3;
                        return (
                          <rect
                            key={`tc-${i}`}
                            x={cx}
                            y={y + laneH / 2 - 3}
                            width={6}
                            height={6}
                            fill="var(--color-ink)"
                          />
                        );
                      })
                    : null}
                  {tcCount > 12 && w > 40 ? (
                    <text
                      x={x + w / 2}
                      y={y + laneH / 2 + 3}
                      fontSize={9}
                      fontFamily="JetBrains Mono, monospace"
                      textAnchor="middle"
                      fill="var(--color-ink)"
                      fontWeight={700}
                    >
                      {tcCount}x tools
                    </text>
                  ) : null}
                  {/* status marker on right edge */}
                  {r.status === "ok" ? (
                    <text
                      x={x + w - 4}
                      y={y + laneH / 2 + 4}
                      fontSize={11}
                      textAnchor="end"
                      fontFamily="JetBrains Mono, monospace"
                      fill="var(--color-ink)"
                      fontWeight={700}
                    >
                      {"▸"}
                    </text>
                  ) : (
                    <rect
                      x={x + w - 9}
                      y={y + laneH / 2 - 3}
                      width={6}
                      height={6}
                      fill="var(--color-err)"
                      stroke="var(--color-ink)"
                      strokeWidth={1.5}
                    />
                  )}
                </g>
              </Link>
            );
          })}

          {/* overflow density strip */}
          {overflow.length > 0 ? (
            <g>
              <rect
                x={padX}
                y={headerH + visualLaneCount * (laneH + laneGap)}
                width={innerW}
                height={overflowH - 2}
                fill="var(--color-mist)"
                stroke="var(--color-ink)"
                strokeWidth={1}
              />
              {overflow.map((p, i) => {
                const x = xFor(p.start);
                const w = wFor(p.start, p.end);
                const y = headerH + visualLaneCount * (laneH + laneGap) + 1;
                return (
                  <rect
                    key={`ov-${i}`}
                    x={x}
                    y={y}
                    width={w}
                    height={overflowH - 4}
                    fill={
                      p.r.status === "ok"
                        ? providerColor(p.r.provider)
                        : "var(--color-rose)"
                    }
                    opacity={0.6}
                  />
                );
              })}
              <text
                x={padX + 4}
                y={headerH + visualLaneCount * (laneH + laneGap) + overflowH - 6}
                fontSize={9}
                fontFamily="JetBrains Mono, monospace"
                fill="var(--color-ink)"
                opacity={0.7}
              >
                +{overflowCount} more {overflowCount === 1 ? "lane" : "lanes"}
              </text>
            </g>
          ) : null}
        </svg>
        {hover ? <HoverCard hover={hover} /> : null}
      </div>
      )}
    </div>
  );
}

function HoverCard({
  hover,
}: {
  hover: { r: RequestRow; px: number; py: number; cw: number; ch: number };
}) {
  // Pin the hover card inside the strip's bounding box: clamp to [0, cw - W].
  const cardW = 210;
  const cardH = 110;
  let left = hover.px + 14;
  if (left + cardW > hover.cw - 4) left = Math.max(4, hover.px - cardW - 14);
  if (left < 4) left = 4;
  let top = hover.py - cardH - 8;
  if (top < 4) top = hover.py + 18;
  if (top + cardH > hover.ch - 4) top = Math.max(4, hover.ch - cardH - 4);
  return (
    <div
      className="nb-card-flat pointer-events-none absolute z-10 p-2 font-mono text-[11px]"
      style={{
        left,
        top,
        background: "#fff",
        width: cardW,
      }}
    >
      <div className="truncate font-bold">{hover.r.model}</div>
      <div className="mt-1 grid grid-cols-2 gap-x-2 gap-y-0.5">
        <span className="opacity-60">latency</span>
        <span className="text-right tabular-nums">{fmt.ms(hover.r.latency_ms)}</span>
        <span className="opacity-60">tokens</span>
        <span className="text-right tabular-nums">
          {fmt.num((hover.r.input_tokens ?? 0) + (hover.r.output_tokens ?? 0))}
        </span>
        <span className="opacity-60">cost</span>
        <span className="text-right tabular-nums">{fmt.cost(hover.r.cost)}</span>
        <span className="opacity-60">finish</span>
        <span className="truncate text-right">{hover.r.finish_reason ?? "—"}</span>
      </div>
    </div>
  );
}

function buildTicks(
  t0: number,
  tEnd: number,
  span: number,
): { t: number; label: string }[] {
  const N = 6;
  const out: { t: number; label: string }[] = [];
  const useLocaleTime = span > 600_000;
  for (let i = 0; i <= N; i++) {
    const t = t0 + (span * i) / N;
    let label: string;
    if (useLocaleTime) {
      const d = new Date(t);
      label = d.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
    } else if (span <= 60_000) {
      const dms = t - t0;
      label = `${(dms / 1000).toFixed(dms < 1000 ? 2 : 1)}s`;
    } else {
      const dms = t - t0;
      const m = Math.floor(dms / 60_000);
      const sec = Math.round((dms % 60_000) / 1000);
      label = `${m}m ${sec}s`;
    }
    out.push({ t, label });
  }
  return out;
}

function msToLabel(ms: number): string {
  if (!ms || ms <= 0) return "0ms";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

// =============================================================================
// Table view
// =============================================================================

function TableView({ requests, newIds }: { requests: RequestRow[]; newIds: Set<string> }) {
  if (!requests.length) {
    return (
      <div className="nb-card p-5">
        <EmptyState
          title="No requests on this session yet"
          hint="Requests appear here as soon as the session sees traffic."
          illustration="session"
        />
      </div>
    );
  }
  return (
    <div className="nb-card overflow-hidden">
      <table className="nb-table">
        <thead>
          <tr>
            <th>Request</th>
            <th>Model</th>
            <th className="text-right">Tokens</th>
            <th className="text-right">Cost</th>
            <th className="text-right">Latency</th>
            <th>Finish</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {requests.map((r) => (
            <tr key={r.id} className={newIds.has(r.id) ? "nb-flash" : ""}>
              <td>
                <Link className="nb-tag" to={`/requests/${encodeURIComponent(r.id)}`}>
                  {r.id.slice(0, 10)}
                </Link>
                <div className="mt-1 text-xs opacity-60">{fmt.rel(r.started_at)}</div>
              </td>
              <td>
                <span className="nb-tag">{r.model}</span>
                {r.streamed ? (
                  <span className="nb-chip ml-2" style={{ background: "var(--color-sky)" }}>
                    stream
                  </span>
                ) : null}
              </td>
              <td className="text-right tabular-nums">
                {fmt.num((r.input_tokens ?? 0) + (r.output_tokens ?? 0))}
              </td>
              <td className="text-right tabular-nums">{fmt.cost(r.cost)}</td>
              <td className="text-right tabular-nums">{fmt.ms(r.latency_ms)}</td>
              <td className="text-xs opacity-80">{r.finish_reason ?? "—"}</td>
              <td>
                <span
                  className="nb-chip"
                  style={{
                    background: r.status === "ok" ? "var(--color-mint)" : "var(--color-rose)",
                  }}
                >
                  {r.status}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// =============================================================================
// Timeline view (per-request stacked) — uses ConversationView
// =============================================================================

function TimelineView({
  requests,
  newIds,
  details,
}: {
  requests: RequestRow[];
  newIds: Set<string>;
  details: Record<string, RequestDetail>;
}) {
  if (!requests.length) {
    return (
      <div className="nb-card p-5">
        <EmptyState
          title="No conversation yet"
          hint="Once requests are made on this session, you'll see the chat replay here."
          illustration="session"
        />
      </div>
    );
  }

  return (
    <div className="nb-card relative p-5">
      <ul className="space-y-6">
        {requests.map((r, idx) => {
          const d = details[r.id];
          const events = d ? extractEvents(d) : [];
          return (
            <li
              key={r.id}
              className={`relative pl-12 ${newIds.has(r.id) ? "nb-flash" : ""}`}
            >
              <div
                className="absolute left-6 top-2 grid h-7 w-7 -translate-x-1/2 place-items-center rounded-full border-[3px] border-[var(--color-ink)] font-mono text-xs font-bold"
                style={{ background: "var(--color-butter)" }}
              >
                {idx + 1}
              </div>
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <Link className="nb-tag" to={`/requests/${encodeURIComponent(r.id)}`}>
                  {r.id.slice(0, 10)}
                </Link>
                <span className="nb-tag">{r.model}</span>
                <span className="text-xs opacity-60">{fmt.date(r.started_at)}</span>
                <span className="text-xs opacity-60">· {fmt.ms(r.latency_ms)}</span>
                <span
                  className="nb-chip ml-auto"
                  style={{
                    background: r.status === "ok" ? "var(--color-mint)" : "var(--color-rose)",
                  }}
                >
                  {r.status}
                </span>
              </div>
              {!d ? (
                <div className="text-xs opacity-60">Loading conversation…</div>
              ) : (
                <ConversationView events={events} />
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// =============================================================================
// Flow view — single continuous transcript across all requests
// =============================================================================

function FlowView({
  requests,
  details,
}: {
  requests: RequestRow[];
  details: Record<string, RequestDetail>;
}) {
  if (!requests.length) {
    return (
      <div className="nb-card p-5">
        <EmptyState
          title="No conversation yet"
          hint="Once requests are made on this session, you'll see a continuous transcript here."
          illustration="session"
        />
      </div>
    );
  }

  // Sort requests chronologically. Stitch all events into one transcript with
  // request-divider strips between groups.
  const sorted = [...requests].sort((a, b) => a.started_at - b.started_at);
  const t0 = sorted[0]?.started_at ?? 0;

  // Build a flat list interleaving dividers + per-request events.
  type Group = {
    r: RequestRow;
    events: ConvEvent[];
    loaded: boolean;
  };
  const groups: Group[] = sorted.map((r) => {
    const d = details[r.id];
    if (!d) return { r, events: [], loaded: false };
    // Re-anchor offsets to session t0 so dividers carry the real wall-clock.
    const baseOffset = r.started_at - t0;
    const tEnd = r.finished_at ?? r.started_at;
    const respOffset = baseOffset + (tEnd - r.started_at);
    const evs = extractEvents(d).map((ev) => {
      // event.offsetMs was relative to its own request's started_at.
      // Re-anchor: input-side events keep baseOffset, output-side use respOffset.
      const reAnchored =
        ev.offsetMs === 0 ? baseOffset : respOffset + (ev.offsetMs - (tEnd - r.started_at));
      return { ...ev, offsetMs: reAnchored };
    });
    return { r, events: evs, loaded: true };
  });

  return (
    <div className="nb-card p-5">
      <div className="mb-3 text-[11px] opacity-60">
        Continuous transcript across {sorted.length} request
        {sorted.length === 1 ? "" : "s"}. Output offsets are anchored to each
        request's <code>finished_at</code> (no intra-stream timestamps).
      </div>
      <div className="space-y-4">
        {groups.map((g, idx) => (
          <div key={g.r.id} className="space-y-3">
            {idx > 0 && <FlowDivider r={g.r} idx={idx} />}
            {idx === 0 && <FlowDivider r={g.r} idx={0} />}
            {!g.loaded ? (
              <div className="text-xs opacity-60">Loading conversation…</div>
            ) : g.events.length === 0 ? (
              <div className="text-xs opacity-60">(no events captured)</div>
            ) : (
              <ConversationView events={g.events} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function FlowDivider({ r, idx }: { r: RequestRow; idx: number }) {
  return (
    <Link
      to={`/requests/${encodeURIComponent(r.id)}`}
      className="nb-card-flat block p-2 hover:bg-[var(--color-mist)]"
      style={{ background: "#fff" }}
    >
      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        <span className="font-mono font-bold opacity-70">→ request {idx + 1}</span>
        <span className="nb-tag">{r.model}</span>
        <span className="opacity-60">· {fmt.ms(r.latency_ms)}</span>
        <span className="opacity-60">
          · {fmt.num((r.input_tokens ?? 0) + (r.output_tokens ?? 0))} tokens
        </span>
        <span className="opacity-60">· {fmt.cost(r.cost)}</span>
        <span className="ml-auto opacity-50">{fmt.date(r.started_at)}</span>
      </div>
    </Link>
  );
}
