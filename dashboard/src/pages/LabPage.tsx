// Visualization prototyping lab. Goal: try multiple encodings of the same
// dataset to see which read fastest. Following Cleveland–McGill perceptual
// ranking (position > length > angle > area > color), most viz here lean on
// position/length over color where comparison matters.
//
// Layout: each viz lives in its own card with a one-line "Cleveland note" that
// states what perceptual task the chart is asking the eye to perform.

import { useEffect, useMemo, useRef, useState } from "react";
import {
  scaleLinear,
  scaleBand,
  scaleSequential,
  scaleTime,
} from "d3-scale";
import { max, min, sum, group, rollup } from "d3-array";
import { timeDay, timeWeek } from "d3-time";
import { interpolateRgb, interpolateRgbBasis } from "d3-interpolate";
import { line, curveCatmullRom, area, stack, stackOffsetWiggle, arc } from "d3-shape";
import { hierarchy, treemap } from "d3-hierarchy";
import { chord, ribbon } from "d3-chord";
import { hexbin as hexbinGen } from "d3-hexbin";
import { kernelDensityEstimator, kernelEpanechnikov } from "../viz/kde";
import type { Dataset, SessionMeta } from "../types";
import { formatUsd, formatDate } from "../format";

interface Props {
  data: Dataset;
}

const COOL = "#2563EB";
const WARM = "#C2410C";
const POSITIVE = "#15803D";
const WARN = "#B45309";
const INK = "#0F172A";
const INK2 = "#475569";
const INK3 = "#94A3B8";
const RULE = "#e4e7ed";

const PERSONA_COLOR: Record<string, string> = {
  power: POSITIVE,
  active: COOL,
  stuck: WARN,
  misuser: WARM,
  lurker: INK3,
};

const OUTCOME_COLOR: Record<string, string> = {
  fully: POSITIVE,
  mostly: "#76ad8a",
  partial: WARN,
  none: WARM,
  unclear: INK3,
};

export default function LabPage({ data }: Props) {
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="page-eyebrow">Visualization lab · prototype</div>
          <h1 className="page-title">Twelve ways to read the data</h1>
          <p className="page-subtitle">
            Same dataset, twelve encodings. Each card states the perceptual task
            the viewer is asked to perform — position‑based comparisons sit
            above color/area per Cleveland–McGill. We pick winners later.
          </p>
        </div>
      </div>

      <div className="lab-grid">
        <Card
          n={1}
          title="Calendar heatmap — daily spend"
          note="Position+saturation across a calendar grid. Best for spotting cadence and dead days, not absolute magnitude."
        >
          <CalendarHeatmap data={data} />
        </Card>

        <Card
          n={2}
          title="Beeswarm — session cost by outcome"
          note="One dot per session. Position on a single axis is high-precision; jittered Y avoids overplotting without adding meaning."
        >
          <BeeswarmCost data={data} />
        </Card>

        <Card
          n={3}
          title="Streamgraph — waste-by-type over time"
          note="Stacked area with wiggle baseline. Encodes composition trends; weak for absolute values but strong for shifts."
        >
          <Streamgraph data={data} />
        </Card>

        <Card
          n={4}
          title="Slope chart — consultant trajectory"
          note="Two parallel position scales. Slope itself encodes change; instantly readable for who's improving / sliding."
        >
          <SlopeChart data={data} />
        </Card>

        <Card
          n={5}
          title="Lollipop — waste leaderboard"
          note="Dot+stem replaces a bar. Position is identical to bars, with less ink — good for ranked categorical comparison."
        >
          <LollipopWaste data={data} />
        </Card>

        <Card
          n={6}
          title="Dot matrix — every session, by outcome"
          note="One mark per session. Direct counts beat percentages when N is small enough to render every unit."
        >
          <DotMatrix data={data} />
        </Card>

        <Card
          n={7}
          title="Ridgeline — cost distribution per consultant"
          note="Stacked KDEs. Shape comparison is qualitative but powerful; modes & long tails pop out."
        >
          <Ridgeline data={data} />
        </Card>

        <Card
          n={8}
          title="Pareto — friction types"
          note="Sorted bars + cumulative line. Identifies the few categories that dominate; the 80% cut line is explicit."
        >
          <Pareto data={data} />
        </Card>

        <Card
          n={9}
          title="Treemap — spend by domain × cluster"
          note="Area encodes spend share. Lower precision than position but tolerates many categories in tight space."
        >
          <SpendTreemap data={data} />
        </Card>

        <Card
          n={10}
          title="Chord — tools × outcomes"
          note="Ribbons encode pair flows. Beautiful but slow to read; treat as exploratory not analytical."
        >
          <ToolOutcomeChord data={data} />
        </Card>

        <Card
          n={11}
          title="Diverging bar — productive vs wasted"
          note="Aligned baseline at zero, length encodes magnitude. Strongest single chart for ROI-per-consultant."
        >
          <DivergingBar data={data} />
        </Card>

        <Card
          n={12}
          title="Hexbin — cost × duration density"
          note="Position + binned count. Replaces the unreadable scatter when N exceeds eyeballing capacity."
        >
          <Hexbin data={data} />
        </Card>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Card shell

function Card({
  n,
  title,
  note,
  children,
}: {
  n: number;
  title: string;
  note: string;
  children: React.ReactNode;
}) {
  return (
    <section className="lab-card">
      <header className="lab-card-head">
        <div className="lab-num">#{String(n).padStart(2, "0")}</div>
        <div className="lab-card-text">
          <h3 className="lab-card-title">{title}</h3>
          <p className="lab-card-note">{note}</p>
        </div>
      </header>
      <div className="lab-card-body">{children}</div>
    </section>
  );
}

function useSize(): [
  React.MutableRefObject<HTMLDivElement | null>,
  { w: number; h: number },
] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ w: 600, h: 320 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const rect = el.getBoundingClientRect();
      setSize({
        w: Math.max(280, rect.width),
        h: Math.max(220, rect.height),
      });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size];
}

// ------------------------------------------------------------------ #1 Calendar

function CalendarHeatmap({ data }: { data: Dataset }) {
  const days = useMemo(() => {
    const start = timeDay.floor(new Date(data.aggregates.dateRange.start));
    const end = timeDay.ceil(new Date(data.aggregates.dateRange.end));
    const all = timeDay.range(start, end);
    const byDay = rollup(
      data.sessions,
      (vs) => sum(vs, (s) => s.costUsd),
      (s) => timeDay.floor(new Date(s.startedAt)).toISOString(),
    );
    return all.map((d) => ({
      date: d,
      cost: byDay.get(d.toISOString()) ?? 0,
    }));
  }, [data]);

  const maxCost = max(days, (d) => d.cost) ?? 1;
  const cell = 16;
  const gap = 3;
  const cols = Math.ceil(days.length / 7);
  const w = cols * (cell + gap) + 60;
  const h = 7 * (cell + gap) + 30;
  const color = scaleSequential(interpolateRgb("#f1f4f8", COOL)).domain([
    0,
    maxCost,
  ]);

  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: "100%", height: "auto" }}>
      {["M", "W", "F"].map((lbl, i) => (
        <text
          key={lbl}
          x={4}
          y={(cell + gap) * (i * 2 + 1) + 11}
          fontSize="9"
          fill={INK3}
          fontFamily="Geist Mono"
        >
          {lbl}
        </text>
      ))}
      {days.map((d, i) => {
        const col = Math.floor(i / 7);
        const row = (d.date.getDay() + 6) % 7;
        return (
          <rect
            key={i}
            x={20 + col * (cell + gap)}
            y={20 + row * (cell + gap)}
            width={cell}
            height={cell}
            rx={2}
            fill={d.cost > 0 ? color(d.cost) : "#f6f7f9"}
            stroke={RULE}
            strokeWidth={0.5}
          >
            <title>
              {formatDate(d.date.toISOString())} · {formatUsd(d.cost, { decimals: 0 })}
            </title>
          </rect>
        );
      })}
    </svg>
  );
}

// ------------------------------------------------------------------ #2 Beeswarm

function BeeswarmCost({ data }: { data: Dataset }) {
  const [ref, size] = useSize();
  const w = size.w;
  const h = 260;
  const pad = { l: 36, r: 16, t: 16, b: 36 };
  const xMax = max(data.sessions, (s) => s.costUsd) ?? 1;
  const x = scaleLinear()
    .domain([0, xMax])
    .range([pad.l, w - pad.r]);

  // simple force-free dodge: keep radius small and jitter Y
  const r = 3;
  const placed: { x: number; y: number }[] = [];
  const dots = useMemo(() => {
    return [...data.sessions]
      .sort((a, b) => a.costUsd - b.costUsd)
      .map((s) => {
        const cx = x(s.costUsd);
        let y = (h - pad.b + pad.t) / 2;
        for (let attempt = 0; attempt < 24; attempt++) {
          const collides = placed.some(
            (p) =>
              Math.abs(p.x - cx) < r * 2 + 0.4 &&
              Math.abs(p.y - y) < r * 2 + 0.4,
          );
          if (!collides) break;
          y += attempt % 2 === 0 ? r * 1.4 : -r * 1.4;
        }
        placed.push({ x: cx, y });
        return { s, cx, cy: y };
      });
  }, [data.sessions, w]);

  return (
    <div ref={ref} style={{ width: "100%" }}>
      <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h}>
        <line
          x1={pad.l}
          x2={w - pad.r}
          y1={h - pad.b}
          y2={h - pad.b}
          stroke={RULE}
        />
        {x.ticks(5).map((t) => (
          <text
            key={t}
            x={x(t)}
            y={h - pad.b + 16}
            textAnchor="middle"
            fontSize="10"
            fill={INK3}
            fontFamily="Geist Mono"
          >
            {formatUsd(t, { decimals: 0 })}
          </text>
        ))}
        {dots.map((d, i) => (
          <circle
            key={i}
            cx={d.cx}
            cy={d.cy}
            r={r}
            fill={OUTCOME_COLOR[d.s.outcome] ?? INK3}
            fillOpacity={0.85}
          >
            <title>
              {formatUsd(d.s.costUsd, { decimals: 1 })} · {d.s.outcome}
            </title>
          </circle>
        ))}
        <text
          x={pad.l}
          y={pad.t + 4}
          fontSize="9.5"
          fill={INK3}
          fontFamily="Geist"
          style={{ letterSpacing: "0.18em", textTransform: "uppercase" }}
        >
          Cost per session
        </text>
      </svg>
    </div>
  );
}

// ------------------------------------------------------------------ #3 Streamgraph

function Streamgraph({ data }: { data: Dataset }) {
  const [ref, size] = useSize();
  const w = size.w;
  const h = 260;
  const pad = { l: 4, r: 4, t: 16, b: 24 };

  interface Row {
    date: Date;
    [k: string]: number | Date;
  }

  const series = useMemo(() => {
    const start = timeWeek.floor(new Date(data.aggregates.dateRange.start));
    const end = timeWeek.ceil(new Date(data.aggregates.dateRange.end));
    const weeks = timeWeek.range(start, end);
    const types = Array.from(
      new Set(data.sessions.flatMap((s) => s.wasteFlags.map((f) => f.type))),
    );
    const rows: Row[] = weeks.map((wk) => {
      const wkEnd = timeWeek.offset(wk, 1);
      const row: Row = { date: wk };
      for (const t of types) row[t] = 0;
      for (const s of data.sessions) {
        const d = new Date(s.startedAt);
        if (d < wk || d >= wkEnd) continue;
        for (const f of s.wasteFlags) {
          row[f.type] = ((row[f.type] as number) ?? 0) + f.usdWasted;
        }
      }
      return row;
    });
    return { weeks, types, rows };
  }, [data]);

  const x = scaleTime()
    .domain([series.weeks[0], series.weeks[series.weeks.length - 1]])
    .range([pad.l, w - pad.r]);

  const stk = stack<Row>()
    .keys(series.types)
    .value((d, key) => (d[key] as number) ?? 0)
    .offset(stackOffsetWiggle);
  const stacked = stk(series.rows);
  const yExt = [
    min(stacked.flat(2) as number[]) ?? 0,
    max(stacked.flat(2) as number[]) ?? 1,
  ] as [number, number];
  const y = scaleLinear()
    .domain(yExt)
    .range([h - pad.b, pad.t]);

  const ar = area<[number, number] & { data: Row }>()
    .x((d) => x(d.data.date))
    .y0((d) => y(d[0]))
    .y1((d) => y(d[1]))
    .curve(curveCatmullRom.alpha(0.5));

  const palette = ["#C2410C", "#B45309", "#7c3aed", "#2563EB", "#0891b2"];

  return (
    <div ref={ref} style={{ width: "100%" }}>
      <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h}>
        {stacked.map((s, i) => (
          <path
            key={s.key}
            d={
              ar(
                s as unknown as ([number, number] & { data: Row })[],
              ) ?? ""
            }
            fill={palette[i % palette.length]}
            opacity={0.78}
          >
            <title>{s.key}</title>
          </path>
        ))}
        {series.types.map((t, i) => (
          <g key={t} transform={`translate(${pad.l + 8 + i * 110}, ${h - 8})`}>
            <rect width={8} height={8} fill={palette[i % palette.length]} />
            <text x={12} y={7} fontSize="10" fill={INK2} fontFamily="Geist Mono">
              {t}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}

// ------------------------------------------------------------------ #4 Slope

function SlopeChart({ data }: { data: Dataset }) {
  const split = useMemo(() => {
    const start = new Date(data.aggregates.dateRange.start).getTime();
    const end = new Date(data.aggregates.dateRange.end).getTime();
    const mid = (start + end) / 2;
    const out = data.users.map((u) => {
      const userSessions = data.sessions.filter((s) => s.userId === u.id);
      const earlyOuts = userSessions.filter(
        (s) => new Date(s.startedAt).getTime() < mid,
      );
      const lateOuts = userSessions.filter(
        (s) => new Date(s.startedAt).getTime() >= mid,
      );
      const wr = (xs: SessionMeta[]) => {
        if (xs.length === 0) return 0;
        const good = xs.filter(
          (s) => s.outcome === "fully" || s.outcome === "mostly",
        ).length;
        return good / xs.length;
      };
      return { user: u, early: wr(earlyOuts), late: wr(lateOuts) };
    });
    return out;
  }, [data]);

  const w = 600;
  const h = 280;
  const pad = { l: 100, r: 100, t: 30, b: 30 };
  const y = scaleLinear().domain([0, 1]).range([h - pad.b, pad.t]);

  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: "100%", height: "auto" }}>
      <text
        x={pad.l}
        y={pad.t - 12}
        fontSize="10"
        fill={INK3}
        fontFamily="Geist"
        style={{ letterSpacing: "0.16em", textTransform: "uppercase" }}
      >
        Early window
      </text>
      <text
        x={w - pad.r}
        y={pad.t - 12}
        textAnchor="end"
        fontSize="10"
        fill={INK3}
        fontFamily="Geist"
        style={{ letterSpacing: "0.16em", textTransform: "uppercase" }}
      >
        Late window
      </text>
      {[0, 0.25, 0.5, 0.75, 1].map((v) => (
        <g key={v}>
          <line
            x1={pad.l}
            x2={w - pad.r}
            y1={y(v)}
            y2={y(v)}
            stroke={RULE}
            strokeDasharray="2 4"
            strokeWidth={v === 0.5 ? 1 : 0.5}
          />
          <text
            x={pad.l - 6}
            y={y(v)}
            textAnchor="end"
            dominantBaseline="middle"
            fontSize="10"
            fill={INK3}
            fontFamily="Geist Mono"
          >
            {(v * 100).toFixed(0)}%
          </text>
        </g>
      ))}
      {split.map((d) => {
        const color = d.late >= d.early ? POSITIVE : WARM;
        return (
          <g key={d.user.id}>
            <line
              x1={pad.l}
              x2={w - pad.r}
              y1={y(d.early)}
              y2={y(d.late)}
              stroke={color}
              strokeOpacity={0.7}
              strokeWidth={1.6}
            />
            <circle cx={pad.l} cy={y(d.early)} r={4} fill={color} />
            <circle cx={w - pad.r} cy={y(d.late)} r={4} fill={color} />
            <text
              x={pad.l - 14}
              y={y(d.early)}
              textAnchor="end"
              dominantBaseline="middle"
              fontSize="11"
              fill={INK}
              fontFamily="Geist"
            >
              {d.user.displayName}
            </text>
            <text
              x={w - pad.r + 14}
              y={y(d.late)}
              dominantBaseline="middle"
              fontSize="11"
              fill={INK}
              fontFamily="Geist Mono"
            >
              {(d.late * 100).toFixed(0)}%
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// ------------------------------------------------------------------ #5 Lollipop

function LollipopWaste({ data }: { data: Dataset }) {
  const sorted = [...data.users].sort(
    (a, b) => b.totalWasteUsd - a.totalWasteUsd,
  );
  const w = 600;
  const rowH = 38;
  const h = sorted.length * rowH + 20;
  const pad = { l: 110, r: 80, t: 8, b: 8 };
  const xMax = max(sorted, (u) => u.totalWasteUsd) ?? 1;
  const x = scaleLinear().domain([0, xMax]).range([pad.l, w - pad.r]);

  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: "100%", height: "auto" }}>
      {sorted.map((u, i) => {
        const cy = pad.t + i * rowH + rowH / 2;
        return (
          <g key={u.id}>
            <text
              x={pad.l - 12}
              y={cy}
              textAnchor="end"
              dominantBaseline="middle"
              fontSize="12"
              fill={INK}
              fontFamily="Geist"
            >
              {u.displayName}
            </text>
            <line
              x1={pad.l}
              x2={x(u.totalWasteUsd)}
              y1={cy}
              y2={cy}
              stroke={WARM}
              strokeOpacity={0.4}
              strokeWidth={1.5}
            />
            <circle
              cx={x(u.totalWasteUsd)}
              cy={cy}
              r={7}
              fill={WARM}
              fillOpacity={0.95}
            />
            <text
              x={x(u.totalWasteUsd) + 14}
              y={cy}
              dominantBaseline="middle"
              fontSize="11"
              fill={INK}
              fontFamily="Geist Mono"
            >
              {formatUsd(u.totalWasteUsd, { decimals: 0 })}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// ------------------------------------------------------------------ #6 Dot matrix

function DotMatrix({ data }: { data: Dataset }) {
  const sorted = useMemo(() => {
    const order = ["fully", "mostly", "partial", "unclear", "none"];
    return [...data.sessions].sort(
      (a, b) => order.indexOf(a.outcome) - order.indexOf(b.outcome),
    );
  }, [data.sessions]);
  const cols = 32;
  const cell = 12;
  const gap = 2;
  const rows = Math.ceil(sorted.length / cols);
  const w = cols * (cell + gap);
  const h = rows * (cell + gap) + 6;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: "100%", height: "auto" }}>
      {sorted.map((s, i) => {
        const r = Math.floor(i / cols);
        const c = i % cols;
        return (
          <rect
            key={s.sessionId}
            x={c * (cell + gap)}
            y={r * (cell + gap)}
            width={cell}
            height={cell}
            rx={2}
            fill={OUTCOME_COLOR[s.outcome] ?? INK3}
            opacity={0.9}
          >
            <title>
              {s.outcome} · {formatUsd(s.costUsd, { decimals: 1 })}
            </title>
          </rect>
        );
      })}
    </svg>
  );
}

// ------------------------------------------------------------------ #7 Ridgeline

function Ridgeline({ data }: { data: Dataset }) {
  const w = 640;
  const rowH = 60;
  const h = data.users.length * rowH + 40;
  const pad = { l: 110, r: 16, t: 12, b: 24 };
  const xMax = max(data.sessions, (s) => s.costUsd) ?? 1;
  const x = scaleLinear().domain([0, xMax]).range([pad.l, w - pad.r]);
  const ticks = x.ticks(40);
  const kde = kernelDensityEstimator(kernelEpanechnikov(xMax * 0.06), ticks);

  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: "100%", height: "auto" }}>
      {data.users.map((u, i) => {
        const userCosts = data.sessions
          .filter((s) => s.userId === u.id)
          .map((s) => s.costUsd);
        const density = kde(userCosts);
        const yMax = max(density, (d) => d[1]) ?? 1;
        const baseY = pad.t + i * rowH + rowH * 0.85;
        const yScale = scaleLinear()
          .domain([0, yMax])
          .range([baseY, baseY - rowH * 0.8]);
        const ar = area<[number, number]>()
          .x((d) => x(d[0]))
          .y0(baseY)
          .y1((d) => yScale(d[1]))
          .curve(curveCatmullRom);
        return (
          <g key={u.id}>
            <text
              x={pad.l - 12}
              y={baseY}
              textAnchor="end"
              dominantBaseline="middle"
              fontSize="11"
              fill={INK}
              fontFamily="Geist"
            >
              {u.displayName}
            </text>
            <path
              d={ar(density) ?? ""}
              fill={PERSONA_COLOR[u.persona] ?? INK3}
              fillOpacity={0.32}
              stroke={PERSONA_COLOR[u.persona] ?? INK3}
              strokeWidth={1}
            />
          </g>
        );
      })}
      {x.ticks(5).map((t) => (
        <text
          key={t}
          x={x(t)}
          y={h - 6}
          textAnchor="middle"
          fontSize="10"
          fill={INK3}
          fontFamily="Geist Mono"
        >
          {formatUsd(t, { decimals: 0 })}
        </text>
      ))}
    </svg>
  );
}

// ------------------------------------------------------------------ #8 Pareto

function Pareto({ data }: { data: Dataset }) {
  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of data.sessions) {
      for (const f of s.friction) map.set(f, (map.get(f) ?? 0) + 1);
    }
    return [...map.entries()]
      .map(([k, v]) => ({ k, v }))
      .sort((a, b) => b.v - a.v)
      .slice(0, 10);
  }, [data.sessions]);

  const w = 640;
  const h = 280;
  const pad = { l: 40, r: 40, t: 20, b: 60 };
  const total = sum(counts, (d) => d.v) || 1;
  const x = scaleBand<string>()
    .domain(counts.map((d) => d.k))
    .range([pad.l, w - pad.r])
    .padding(0.25);
  const y = scaleLinear()
    .domain([0, max(counts, (d) => d.v) ?? 1])
    .range([h - pad.b, pad.t]);
  const yPct = scaleLinear().domain([0, 1]).range([h - pad.b, pad.t]);

  let cum = 0;
  const cumPoints = counts.map((d) => {
    cum += d.v;
    return { k: d.k, p: cum / total };
  });
  const ln = line<{ k: string; p: number }>()
    .x((d) => (x(d.k) ?? 0) + x.bandwidth() / 2)
    .y((d) => yPct(d.p))
    .curve(curveCatmullRom);

  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: "100%", height: "auto" }}>
      <line
        x1={pad.l}
        x2={w - pad.r}
        y1={yPct(0.8)}
        y2={yPct(0.8)}
        stroke={INK3}
        strokeDasharray="4 4"
      />
      <text
        x={w - pad.r}
        y={yPct(0.8) - 4}
        textAnchor="end"
        fontSize="10"
        fill={INK3}
        fontFamily="Geist Mono"
      >
        80%
      </text>
      {counts.map((d) => (
        <g key={d.k}>
          <rect
            x={x(d.k) ?? 0}
            y={y(d.v)}
            width={x.bandwidth()}
            height={h - pad.b - y(d.v)}
            fill={COOL}
            opacity={0.78}
            rx={1.5}
          />
          <text
            x={(x(d.k) ?? 0) + x.bandwidth() / 2}
            y={h - pad.b + 14}
            textAnchor="end"
            fontSize="10"
            fill={INK2}
            fontFamily="Geist Mono"
            transform={`rotate(-32 ${(x(d.k) ?? 0) + x.bandwidth() / 2} ${h - pad.b + 14})`}
          >
            {d.k}
          </text>
        </g>
      ))}
      <path
        d={ln(cumPoints) ?? ""}
        stroke={WARM}
        strokeWidth={1.6}
        fill="none"
      />
      {cumPoints.map((d) => (
        <circle
          key={d.k}
          cx={(x(d.k) ?? 0) + x.bandwidth() / 2}
          cy={yPct(d.p)}
          r={3}
          fill={WARM}
        />
      ))}
    </svg>
  );
}

// ------------------------------------------------------------------ #9 Treemap

function SpendTreemap({ data }: { data: Dataset }) {
  const w = 640;
  const h = 320;

  const root = useMemo(() => {
    const byDomain = group(data.clusters, (c) => c.domain);
    const sessionsById = new Map(data.sessions.map((s) => [s.sessionId, s]));
    const children = [...byDomain].map(([domain, clusters]) => ({
      name: domain,
      children: clusters.map((c) => {
        const cost = c.members.reduce(
          (a, m) => a + (sessionsById.get(m)?.costUsd ?? 0),
          0,
        );
        return { name: c.label, value: cost };
      }),
    }));
    const r = hierarchy({ name: "root", children })
      .sum((d) => (d as { value?: number }).value ?? 0)
      .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
    treemap<typeof r extends infer R ? R extends { data: infer D } ? D : never : never>()
      .size([w, h])
      .paddingInner(2)
      .paddingTop(18)(r as never);
    return r as unknown as {
      leaves: () => {
        x0: number;
        x1: number;
        y0: number;
        y1: number;
        value?: number;
        parent: { data: { name: string } } | null;
        data: { name: string };
      }[];
      descendants: () => {
        depth: number;
        x0: number;
        y0: number;
        x1: number;
        data: { name: string };
      }[];
    };
  }, [data]);

  const palette: Record<string, string> = {
    code: "#2563EB",
    strategy: "#7c3aed",
    research: "#0891b2",
    writing: "#15803D",
    data: "#B45309",
    ops: "#C2410C",
    other: "#94A3B8",
  };

  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: "100%", height: "auto" }}>
      {root.descendants().filter((d) => d.depth === 1).map((d, i) => (
        <text
          key={i}
          x={d.x0 + 6}
          y={d.y0 + 12}
          fontSize="10"
          fill={INK2}
          fontFamily="Geist"
          style={{ letterSpacing: "0.14em", textTransform: "uppercase" }}
        >
          {d.data.name}
        </text>
      ))}
      {root.leaves().map((leaf, i) => {
        const domain = leaf.parent?.data.name ?? "other";
        return (
          <g key={i}>
            <rect
              x={leaf.x0}
              y={leaf.y0}
              width={leaf.x1 - leaf.x0}
              height={leaf.y1 - leaf.y0}
              fill={palette[domain] ?? INK3}
              opacity={0.85}
              stroke="#fff"
              strokeWidth={1}
            >
              <title>
                {leaf.data.name} · {formatUsd(leaf.value ?? 0, { decimals: 0 })}
              </title>
            </rect>
            {leaf.x1 - leaf.x0 > 90 && leaf.y1 - leaf.y0 > 24 && (
              <text
                x={leaf.x0 + 6}
                y={leaf.y0 + 18}
                fontSize="10.5"
                fill="#fff"
                fontFamily="Geist"
                fontWeight={500}
              >
                {leaf.data.name.length > 22
                  ? leaf.data.name.slice(0, 22) + "…"
                  : leaf.data.name}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

// ------------------------------------------------------------------ #10 Chord

function ToolOutcomeChord({ data }: { data: Dataset }) {
  const { matrix, labels } = useMemo(() => {
    const tools = ["Edit", "Bash", "Read", "Write", "Grep"];
    const outs = ["fully", "mostly", "partial", "unclear", "none"];
    const labels = [...tools, ...outs];
    const idx = new Map(labels.map((l, i) => [l, i]));
    const m: number[][] = labels.map(() => labels.map(() => 0));
    for (const s of data.sessions) {
      for (const t of tools) {
        const used = s.tools[t] ?? 0;
        if (used === 0) continue;
        const a = idx.get(t)!;
        const b = idx.get(s.outcome)!;
        if (a == null || b == null) continue;
        m[a][b] += used;
        m[b][a] += used;
      }
    }
    return { matrix: m, labels };
  }, [data.sessions]);

  const w = 360;
  const h = 360;
  const r = w / 2 - 60;
  const inner = r - 14;
  const ch = chord().padAngle(0.04)(matrix);
  const arcGen = arc<{ startAngle: number; endAngle: number }>()
    .innerRadius(inner)
    .outerRadius(r);
  const ribGen = ribbon().radius(inner);

  const tools = new Set(["Edit", "Bash", "Read", "Write", "Grep"]);
  const groupColor = (name: string) =>
    tools.has(name) ? COOL : OUTCOME_COLOR[name] ?? INK3;

  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: "100%", height: "auto" }}>
      <g transform={`translate(${w / 2},${h / 2})`}>
        {ch.groups.map((g, i) => (
          <g key={i}>
            <path d={arcGen(g) ?? ""} fill={groupColor(labels[i])} />
            <text
              transform={`rotate(${
                ((g.startAngle + g.endAngle) / 2) * (180 / Math.PI) - 90
              }) translate(${r + 6}) ${
                (g.startAngle + g.endAngle) / 2 > Math.PI ? "rotate(180)" : ""
              }`}
              textAnchor={
                (g.startAngle + g.endAngle) / 2 > Math.PI ? "end" : "start"
              }
              dominantBaseline="middle"
              fontSize="10"
              fill={INK}
              fontFamily="Geist Mono"
            >
              {labels[i]}
            </text>
          </g>
        ))}
        {ch.map((d, i) => (
          <path
            key={i}
            d={
              ribGen(
                d as unknown as Parameters<typeof ribGen>[0],
              ) as unknown as string
            }
            fill={groupColor(labels[d.source.index])}
            fillOpacity={0.35}
            stroke={groupColor(labels[d.source.index])}
            strokeOpacity={0.6}
          />
        ))}
      </g>
    </svg>
  );
}

// ------------------------------------------------------------------ #11 Diverging

function DivergingBar({ data }: { data: Dataset }) {
  const rows = useMemo(() => {
    return [...data.users]
      .map((u) => ({
        u,
        productive: Math.max(0, u.totalCostUsd - u.totalWasteUsd),
        wasted: u.totalWasteUsd,
      }))
      .sort((a, b) => b.productive + b.wasted - (a.productive + a.wasted));
  }, [data.users]);

  const w = 640;
  const rowH = 36;
  const h = rows.length * rowH + 30;
  const labelW = 110;
  const cx = (w + labelW) / 2;
  const halfW = (w - labelW) / 2 - 20;
  const maxAbs = Math.max(
    max(rows, (r) => r.productive) ?? 1,
    max(rows, (r) => r.wasted) ?? 1,
  );
  const x = scaleLinear().domain([0, maxAbs]).range([0, halfW]);

  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: "100%", height: "auto" }}>
      <line
        x1={cx}
        x2={cx}
        y1={20}
        y2={h - 6}
        stroke={INK3}
        strokeWidth={1}
      />
      <text
        x={cx - 10}
        y={14}
        textAnchor="end"
        fontSize="10"
        fill={WARM}
        fontFamily="Geist"
        style={{ letterSpacing: "0.14em", textTransform: "uppercase" }}
      >
        wasted
      </text>
      <text
        x={cx + 10}
        y={14}
        fontSize="10"
        fill={POSITIVE}
        fontFamily="Geist"
        style={{ letterSpacing: "0.14em", textTransform: "uppercase" }}
      >
        productive
      </text>
      {rows.map((r, i) => {
        const cy = 24 + i * rowH;
        return (
          <g key={r.u.id}>
            <text
              x={labelW - 10}
              y={cy + rowH / 2}
              textAnchor="end"
              dominantBaseline="middle"
              fontSize="11.5"
              fill={INK}
              fontFamily="Geist"
            >
              {r.u.displayName}
            </text>
            <rect
              x={cx - x(r.wasted)}
              y={cy + 6}
              width={x(r.wasted)}
              height={rowH - 14}
              fill={WARM}
              opacity={0.85}
              rx={1.5}
            />
            <rect
              x={cx}
              y={cy + 6}
              width={x(r.productive)}
              height={rowH - 14}
              fill={POSITIVE}
              opacity={0.55}
              rx={1.5}
            />
            <text
              x={cx - x(r.wasted) - 6}
              y={cy + rowH / 2}
              textAnchor="end"
              dominantBaseline="middle"
              fontSize="10"
              fill={WARM}
              fontFamily="Geist Mono"
            >
              {r.wasted > 0 ? formatUsd(r.wasted, { decimals: 0 }) : ""}
            </text>
            <text
              x={cx + x(r.productive) + 6}
              y={cy + rowH / 2}
              dominantBaseline="middle"
              fontSize="10"
              fill={POSITIVE}
              fontFamily="Geist Mono"
            >
              {formatUsd(r.productive, { decimals: 0 })}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// ------------------------------------------------------------------ #12 Hexbin

function Hexbin({ data }: { data: Dataset }) {
  const [ref, size] = useSize();
  const w = size.w;
  const h = 320;
  const pad = { l: 40, r: 16, t: 16, b: 32 };
  const xMax = max(data.sessions, (s) => s.costUsd) ?? 1;
  const yMax = max(data.sessions, (s) => s.durationMinutes) ?? 1;
  const x = scaleLinear().domain([0, xMax]).range([pad.l, w - pad.r]);
  const y = scaleLinear()
    .domain([0, yMax])
    .range([h - pad.b, pad.t]);

  const points: [number, number][] = data.sessions.map((s) => [
    x(s.costUsd),
    y(s.durationMinutes),
  ]);

  const hb = hexbinGen<[number, number]>()
    .x((d) => d[0])
    .y((d) => d[1])
    .radius(12)
    .extent([
      [pad.l, pad.t],
      [w - pad.r, h - pad.b],
    ]);
  const bins = hb(points);
  const maxCount = max(bins, (b) => b.length) ?? 1;
  const color = scaleSequential(
    interpolateRgbBasis(["#f1f4f8", "#bbd1f8", COOL]),
  ).domain([0, maxCount]);

  return (
    <div ref={ref} style={{ width: "100%" }}>
      <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h}>
        <line
          x1={pad.l}
          x2={w - pad.r}
          y1={h - pad.b}
          y2={h - pad.b}
          stroke={RULE}
        />
        <line x1={pad.l} x2={pad.l} y1={pad.t} y2={h - pad.b} stroke={RULE} />
        {bins.map((b, i) => (
          <path
            key={i}
            d={hb.hexagon()}
            transform={`translate(${b.x},${b.y})`}
            fill={color(b.length)}
            stroke="#fff"
            strokeWidth={0.5}
          />
        ))}
        {x.ticks(5).map((t) => (
          <text
            key={t}
            x={x(t)}
            y={h - pad.b + 14}
            textAnchor="middle"
            fontSize="10"
            fill={INK3}
            fontFamily="Geist Mono"
          >
            {formatUsd(t, { decimals: 0 })}
          </text>
        ))}
        {y.ticks(5).map((t) => (
          <text
            key={t}
            x={pad.l - 6}
            y={y(t)}
            textAnchor="end"
            dominantBaseline="middle"
            fontSize="10"
            fill={INK3}
            fontFamily="Geist Mono"
          >
            {t}m
          </text>
        ))}
        <text
          x={pad.l}
          y={pad.t - 4}
          fontSize="9.5"
          fill={INK3}
          fontFamily="Geist"
          style={{ letterSpacing: "0.18em", textTransform: "uppercase" }}
        >
          Duration
        </text>
        <text
          x={w - pad.r}
          y={h - pad.b + 28}
          textAnchor="end"
          fontSize="9.5"
          fill={INK3}
          fontFamily="Geist"
          style={{ letterSpacing: "0.18em", textTransform: "uppercase" }}
        >
          Cost
        </text>
      </svg>
    </div>
  );
}
