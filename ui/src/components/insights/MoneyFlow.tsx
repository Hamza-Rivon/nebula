import { useEffect, useMemo, useRef, useState } from "react";
import { scaleLinear } from "d3-scale";
import {
  sankey as makeSankey,
  sankeyLinkHorizontal,
  sankeyLeft,
  type SankeyGraph,
  type SankeyNode,
  type SankeyLink,
} from "d3-sankey";
import type { Dataset, User } from "../../insights/types";
import { formatUsd, wasteTypeLabel } from "../../insights/format";

type Lens = "reason" | "team" | "engineer" | "outcome";

interface Props {
  data: Dataset;
  onOpenWaste: (type: string) => void;
  onOpenUser: (id: string) => void;
}

interface NodeDatum {
  key: string;
  label: string;
  category: "total" | "productive" | "wasted" | "split";
  splitKind?: "waste" | "productive";
  payload?: { wasteType?: string; userId?: string };
}
interface LinkDatum {
  source: string;
  target: string;
  value: number;
  kind: "productive" | "wasted";
}

const COLORS = {
  total: "#111111",
  productive: "#1F7A3A",
  wasted: "#B23A1F",
  productiveSoft: "#B8F5C9",
  wastedSoft: "#FFB7A8",
};

export function MoneyFlow({ data, onOpenWaste, onOpenUser }: Props) {
  const [lens, setLens] = useState<Lens>("reason");
  const a = data.aggregates;
  const total = a.totalCostUsd;
  const wasted = a.totalWasteUsd;
  const productive = Math.max(0, total - wasted);

  const byUserId = useMemo(() => {
    const m = new Map<string, User>();
    for (const u of data.users) m.set(u.id, u);
    return m;
  }, [data.users]);

  const graph = useMemo(() => {
    const nodes: NodeDatum[] = [
      { key: "total", label: "Total spend", category: "total" },
      { key: "productive", label: "Productive", category: "productive" },
      { key: "wasted", label: "Wasted", category: "wasted" },
    ];
    const links: LinkDatum[] = [
      {
        source: "total",
        target: "productive",
        value: productive,
        kind: "productive",
      },
      { source: "total", target: "wasted", value: wasted, kind: "wasted" },
    ];

    const splits = lensSplits(lens, data, byUserId);
    for (const s of splits) {
      nodes.push({
        key: `split:${s.key}`,
        label: s.label,
        category: "split",
        splitKind: s.kind,
        payload: s.payload,
      });
      links.push({
        source: s.kind === "waste" ? "wasted" : "productive",
        target: `split:${s.key}`,
        value: Math.max(0.0001, s.usd),
        kind: s.kind === "waste" ? "wasted" : "productive",
      });
    }
    return { nodes, links };
  }, [lens, data, byUserId, productive, wasted]);

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(960);
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const ro = new ResizeObserver(() => {
      setWidth(wrap.getBoundingClientRect().width);
    });
    ro.observe(wrap);
    return () => ro.disconnect();
  }, []);

  const splitsCount = graph.nodes.filter((n) => n.category === "split").length;
  const height = Math.max(320, splitsCount * 38 + 80);

  const layout = useMemo(() => {
    if (total <= 0 || width <= 0) return null;
    type SN = SankeyNode<NodeDatum, LinkDatum>;
    type SL = SankeyLink<NodeDatum, LinkDatum>;

    const nodeMap = new Map(graph.nodes.map((n, i) => [n.key, i]));
    const ng = {
      nodes: graph.nodes.map((n) => ({ ...n })),
      links: graph.links.map((l) => ({
        source: nodeMap.get(l.source)!,
        target: nodeMap.get(l.target)!,
        value: l.value,
        kind: l.kind,
      })),
    } as unknown as SankeyGraph<NodeDatum, LinkDatum>;

    const sk = makeSankey<NodeDatum, LinkDatum>()
      .nodeWidth(20)
      .nodePadding(14)
      .nodeAlign(sankeyLeft)
      .extent([
        [16, 16],
        [width - 16, height - 16],
      ]);

    return sk(ng) as { nodes: SN[]; links: SL[] };
  }, [graph, width, height, total]);

  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <div className="panel-sub">Q2 — Where the money goes</div>
          <h3 className="panel-title">Spend flow</h3>
        </div>
        <div className="lens-switch">
          {(["reason", "team", "engineer", "outcome"] as Lens[]).map((l) => (
            <button
              key={l}
              className={`lens-pill ${lens === l ? "active" : ""}`}
              onClick={() => setLens(l)}
            >
              by {l}
            </button>
          ))}
        </div>
      </div>
      <div className="panel-body" style={{ paddingBottom: 24 }}>
        <div className="flow-wrap" ref={wrapRef}>
          {layout && (
            <svg
              width={width}
              height={height}
              viewBox={`0 0 ${width} ${height}`}
              style={{ display: "block" }}
            >
              <g fill="none">
                {layout.links.map((link, i) => {
                  const path = sankeyLinkHorizontal()(
                    link as unknown as Parameters<
                      ReturnType<typeof sankeyLinkHorizontal>
                    >[0],
                  );
                  const stroke =
                    link.kind === "wasted"
                      ? COLORS.wasted
                      : COLORS.productive;
                  return (
                    <path
                      key={i}
                      d={path ?? ""}
                      stroke={stroke}
                      strokeOpacity={link.kind === "wasted" ? 0.32 : 0.22}
                      strokeWidth={Math.max(1, link.width ?? 1)}
                    />
                  );
                })}
              </g>
              <g>
                {layout.nodes.map((n) => {
                  const x0 = n.x0 ?? 0;
                  const x1 = n.x1 ?? 0;
                  const y0 = n.y0 ?? 0;
                  const y1 = n.y1 ?? 0;
                  const w = x1 - x0;
                  const h = Math.max(2, y1 - y0);
                  const fill =
                    n.category === "total"
                      ? COLORS.total
                      : n.category === "productive"
                        ? COLORS.productive
                        : n.category === "wasted"
                          ? COLORS.wasted
                          : n.splitKind === "waste"
                            ? COLORS.wastedSoft
                            : COLORS.productiveSoft;
                  const interactable =
                    n.category === "split" &&
                    ((lens === "reason" && n.splitKind === "waste") ||
                      lens === "engineer");
                  const onClick = () => {
                    if (!n.payload) return;
                    if (lens === "reason" && n.payload.wasteType)
                      onOpenWaste(n.payload.wasteType);
                    else if (lens === "engineer" && n.payload.userId)
                      onOpenUser(n.payload.userId);
                  };
                  return (
                    <g
                      key={n.key}
                      style={{ cursor: interactable ? "pointer" : "default" }}
                      onClick={interactable ? onClick : undefined}
                    >
                      <rect
                        x={x0}
                        y={y0}
                        width={w}
                        height={h}
                        fill={fill}
                        stroke="#111"
                        strokeWidth={2}
                        rx={3}
                      />
                      <NodeLabel node={n} x0={x0} x1={x1} y0={y0} h={h} />
                    </g>
                  );
                })}
              </g>
            </svg>
          )}
        </div>
      </div>
    </section>
  );
}

function NodeLabel({
  node,
  x0,
  x1,
  y0,
  h,
}: {
  node: SankeyNode<NodeDatum, LinkDatum>;
  x0: number;
  x1: number;
  y0: number;
  h: number;
}) {
  const value = node.value ?? 0;
  if (node.category === "total") {
    return (
      <g pointerEvents="none">
        <text
          x={x1 + 10}
          y={y0 + 16}
          fill="#111"
          fontSize="10"
          fontWeight={700}
          style={{ letterSpacing: "0.18em", textTransform: "uppercase" }}
        >
          Total spend
        </text>
        <text
          x={x1 + 10}
          y={y0 + 38}
          fill="#111"
          fontSize="20"
          fontWeight={700}
        >
          {formatUsd(value, { decimals: 0 })}
        </text>
      </g>
    );
  }
  if (node.category === "productive" || node.category === "wasted") {
    const isWaste = node.category === "wasted";
    const color = isWaste ? "#B23A1F" : "#1F7A3A";
    return (
      <g pointerEvents="none">
        <text
          x={x1 + 10}
          y={y0 + 14}
          fill="#111"
          fontSize="10"
          fontWeight={700}
          style={{ letterSpacing: "0.18em", textTransform: "uppercase" }}
        >
          {isWaste ? "Wasted" : "Productive"}
        </text>
        <text
          x={x1 + 10}
          y={y0 + Math.min(34, h - 4)}
          fill={color}
          fontSize="16"
          fontWeight={700}
        >
          {formatUsd(value, { decimals: 0 })}
        </text>
      </g>
    );
  }
  const labelY = y0 + Math.min(h / 2 + 4, 16);
  return (
    <g pointerEvents="none">
      <text
        x={x0 - 8}
        y={labelY}
        textAnchor="end"
        fill="#111"
        fontSize="12"
        fontWeight={600}
      >
        {node.label}
      </text>
      <text
        x={x0 - 8}
        y={labelY + 13}
        textAnchor="end"
        fill="#11111199"
        fontSize="10.5"
        style={{ fontFeatureSettings: '"tnum"' }}
      >
        {formatUsd(value, { decimals: 0 })}
      </text>
    </g>
  );
}

function lensSplits(
  lens: Lens,
  data: Dataset,
  byUserId: Map<string, User>,
): {
  key: string;
  label: string;
  usd: number;
  kind: "waste" | "productive";
  payload?: { wasteType?: string; userId?: string };
}[] {
  const a = data.aggregates;
  if (lens === "reason") {
    return Object.entries(a.wasteByType)
      .map(([k, v]) => ({
        key: k,
        label: wasteTypeLabel(k),
        usd: v.usd,
        kind: "waste" as const,
        payload: { wasteType: k },
      }))
      .filter((s) => s.usd > 0)
      .sort((x, y) => y.usd - x.usd);
  }
  if (lens === "team") {
    const map = new Map<string, number>();
    for (const s of data.sessions) {
      const team = byUserId.get(s.userId)?.team ?? "—";
      map.set(team, (map.get(team) ?? 0) + s.wasteUsd);
    }
    return [...map.entries()]
      .map(([team, usd]) => ({
        key: `team:${team}`,
        label: team,
        usd,
        kind: "waste" as const,
      }))
      .filter((s) => s.usd > 0)
      .sort((x, y) => y.usd - x.usd);
  }
  if (lens === "engineer") {
    return data.users
      .map((u) => ({
        key: u.id,
        label: u.displayName,
        usd: u.totalWasteUsd,
        kind: "waste" as const,
        payload: { userId: u.id },
      }))
      .filter((s) => s.usd > 0)
      .sort((x, y) => y.usd - x.usd);
  }
  const map: Record<string, number> = {};
  for (const s of data.sessions) {
    const productivePart = Math.max(0, s.costUsd - s.wasteUsd);
    map[s.outcome] = (map[s.outcome] ?? 0) + productivePart;
  }
  const order = ["fully", "mostly", "partial", "unclear", "none"];
  return order
    .filter((k) => map[k] && map[k]! > 0)
    .map((k) => ({
      key: `outcome:${k}`,
      label: k,
      usd: map[k] ?? 0,
      kind:
        k === "none" || k === "partial" ? ("waste" as const) : ("productive" as const),
    }));
}

// ---------- Spend-vs-win-rate scatter ----------

export function SpendWinScatter({
  data,
  onOpenUser,
}: {
  data: Dataset;
  onOpenUser: (id: string) => void;
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 900, h: 360 });
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const rect = el.getBoundingClientRect();
      setSize({ w: rect.width, h: 360 });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { w, h } = size;
  const pad = { l: 64, r: 32, t: 24, b: 48 };

  const xMax = Math.max(1, ...data.users.map((u) => u.totalCostUsd));
  const xScale = scaleLinear()
    .domain([0, xMax])
    .nice()
    .range([pad.l, w - pad.r]);
  const yScale = scaleLinear().domain([0, 1]).range([h - pad.b, pad.t]);
  const rScale = scaleLinear()
    .domain([0, Math.max(1, ...data.users.map((u) => u.sessionCount))])
    .range([8, 18]);

  const xTicks = xScale.ticks(5);
  const yTicks = [0, 0.25, 0.5, 0.75, 1];
  const innerW = w - pad.l - pad.r;
  const xMid = pad.l + innerW / 2;

  const personaColor = (p: string) =>
    p === "power"
      ? "#1F7A3A"
      : p === "active"
        ? "#2C68C8"
        : p === "stuck"
          ? "#B47A12"
          : p === "misuser"
            ? "#B23A1F"
            : "#888";

  return (
    <div className="scatter-card" ref={wrapRef}>
      <svg
        width={w}
        height={h}
        viewBox={`0 0 ${w} ${h}`}
        style={{ display: "block" }}
      >
        {yTicks.map((v) => (
          <line
            key={`gy-${v}`}
            x1={pad.l}
            x2={w - pad.r}
            y1={yScale(v)}
            y2={yScale(v)}
            stroke="rgba(17,17,17,0.08)"
            strokeWidth={1}
          />
        ))}
        <line
          x1={pad.l}
          x2={w - pad.r}
          y1={h - pad.b}
          y2={h - pad.b}
          stroke="#111"
          strokeWidth={2}
        />
        <line x1={pad.l} x2={pad.l} y1={pad.t} y2={h - pad.b} stroke="#111" strokeWidth={2} />
        {yTicks.map((v) => (
          <text
            key={`y-${v}`}
            x={pad.l - 10}
            y={yScale(v)}
            textAnchor="end"
            dominantBaseline="middle"
            fontSize="10.5"
            fill="#111"
            opacity={0.65}
          >
            {Math.round(v * 100)}%
          </text>
        ))}
        {xTicks.map((v) => (
          <text
            key={`x-${v}`}
            x={xScale(v)}
            y={h - pad.b + 18}
            textAnchor="middle"
            fontSize="10.5"
            fill="#111"
            opacity={0.65}
          >
            {formatUsd(v, { decimals: 0 })}
          </text>
        ))}
        <text
          transform={`translate(${pad.l - 44}, ${(pad.t + h - pad.b) / 2}) rotate(-90)`}
          textAnchor="middle"
          fontSize="10"
          fill="#111"
          fontWeight={700}
          style={{ letterSpacing: "0.22em", textTransform: "uppercase" }}
        >
          Win rate
        </text>
        <text
          x={xMid}
          y={h - 10}
          textAnchor="middle"
          fontSize="10"
          fill="#111"
          fontWeight={700}
          style={{ letterSpacing: "0.22em", textTransform: "uppercase" }}
        >
          Spend
        </text>
        {data.users.map((u) => {
          const cx = xScale(u.totalCostUsd);
          const cy = yScale(u.winRate);
          const r = rScale(u.sessionCount);
          const color = personaColor(u.persona);
          const flipLeft = cx > w - pad.r - 140;
          const tx = flipLeft ? cx - r - 8 : cx + r + 8;
          return (
            <g
              key={u.id}
              style={{ cursor: "pointer" }}
              onClick={() => onOpenUser(u.id)}
            >
              <circle
                cx={cx}
                cy={cy}
                r={r}
                fill={color}
                fillOpacity={0.85}
                stroke="#111"
                strokeWidth={2}
              />
              <text
                x={tx}
                y={cy - 1}
                textAnchor={flipLeft ? "end" : "start"}
                fontSize="12"
                fill="#111"
                fontWeight={600}
              >
                {u.displayName}
              </text>
              <text
                x={tx}
                y={cy + 13}
                textAnchor={flipLeft ? "end" : "start"}
                fontSize="10.5"
                fill="#111"
                opacity={0.6}
                style={{ fontFeatureSettings: '"tnum"' }}
              >
                {Math.round(u.winRate * 100)}% · {formatUsd(u.totalCostUsd, { decimals: 0 })}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
