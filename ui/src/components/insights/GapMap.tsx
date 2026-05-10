import { useEffect, useMemo, useRef, useState } from "react";
import { scaleLinear, scaleSqrt } from "d3-scale";
import { extent } from "d3-array";
import { interpolateRgb } from "d3-interpolate";
import {
  forceSimulation,
  forceX,
  forceY,
  forceCollide,
  forceManyBody,
  type SimulationNodeDatum,
} from "d3-force";
import { select } from "d3-selection";
import { zoom, zoomIdentity, type ZoomBehavior } from "d3-zoom";
import type { Cluster, Dataset } from "../../insights/types";
import { affectedUserCount, topUnresolvedCluster } from "../../insights/derive";
import { truncate } from "../../insights/format";
import { PALETTE } from "../../insights/palette";
import { PortalTooltip } from "../PortalTooltip";

interface Props {
  data: Dataset;
  onSelect: (cluster: Cluster) => void;
  selectedId?: string | null;
  anonymized?: boolean;
}

interface Bubble extends SimulationNodeDatum {
  cluster: Cluster;
  x: number;
  y: number;
  r: number;
  color: string;
  // Target seed position from UMAP centroid (post-scaling). Acts as the
  // attractor for forceX/forceY so similar clusters drift toward each other
  // without the raw min→max stretch that previously slammed everything
  // into opposite corners.
  tx: number;
  ty: number;
}

const PAD = { top: 36, right: 36, bottom: 36, left: 36 };

export function GapMap({ data, onSelect, selectedId, anonymized }: Props) {
  const teamsAffected = useMemo(() => {
    const teamByUser = new Map(data.users.map((u) => [u.id, u.team] as const));
    const counts = new Map<string, Set<string>>();
    for (const c of data.clusters) {
      const teams = new Set<string>();
      const memberSet = new Set(c.members);
      for (const s of data.sessions) {
        if (!memberSet.has(s.sessionId)) continue;
        const t = teamByUser.get(s.userId);
        if (t) teams.add(t);
      }
      counts.set(c.id, teams);
    }
    return counts;
  }, [data]);
  const pal = PALETTE;
  const interpolator = useMemo(
    () => interpolateRgb(pal.gapmapLow, pal.gapmapHigh),
    [pal.gapmapLow, pal.gapmapHigh],
  );

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null);

  const [size, setSize] = useState<{ w: number; h: number }>({ w: 800, h: 480 });
  const [zoomT, setZoomT] = useState({ k: 1, x: 0, y: 0 });
  const [hover, setHover] = useState<{
    cluster: Cluster;
    vx: number;
    vy: number;
  } | null>(null);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const ro = new ResizeObserver(() => {
      const rect = wrap.getBoundingClientRect();
      setSize({ w: rect.width, h: rect.height });
    });
    ro.observe(wrap);
    return () => ro.disconnect();
  }, []);

  // Run a one-shot d3-force simulation each time clusters or canvas size
  // changes. The result is a stable bubble layout where similar clusters
  // sit next to each other and nothing overlaps.
  const bubbles = useMemo<Bubble[]>(() => {
    if (data.clusters.length === 0 || size.w === 0) return [];
    const { w, h } = size;

    const xs = data.clusters.map((c) => c.centroid3d[0]);
    const ys = data.clusters.map((c) => c.centroid3d[1]);
    const [xmin, xmax] = extent(xs) as [number, number];
    const [ymin, ymax] = extent(ys) as [number, number];

    // Compress the centroid range to ~55% of the inner canvas, centered,
    // so two-extreme UMAP outputs don't fill the whole panel. Force layout
    // does the rest of the spacing.
    const innerW = Math.max(1, w - PAD.left - PAD.right);
    const innerH = Math.max(1, h - PAD.top - PAD.bottom);
    const cx = w / 2;
    const cy = h / 2;
    const spreadX = innerW * 0.275;
    const spreadY = innerH * 0.275;
    const xScale = scaleLinear()
      .domain([xmin, xmax === xmin ? xmin + 1 : xmax])
      .range([cx - spreadX, cx + spreadX]);
    const yScale = scaleLinear()
      .domain([ymin, ymax === ymin ? ymin + 1 : ymax])
      .range([cy - spreadY, cy + spreadY]);

    const counts = data.clusters.map((c) => c.sessionCount);
    const cmin = Math.min(...counts);
    const cmax = Math.max(...counts);
    const rScale = scaleSqrt()
      .domain([cmin, cmax === cmin ? cmin + 1 : cmax])
      .range([14, 34]);
    const sevMax = Math.max(0.0001, ...data.clusters.map((c) => c.severity));

    const nodes: Bubble[] = data.clusters.map((c) => {
      const tx = xScale(c.centroid3d[0]);
      const ty = yScale(c.centroid3d[1]);
      return {
        cluster: c,
        x: tx,
        y: ty,
        tx,
        ty,
        r: rScale(c.sessionCount),
        color: interpolator(c.severity / sevMax),
      };
    });

    const sim = forceSimulation<Bubble>(nodes)
      .force("x", forceX<Bubble>((d) => d.tx).strength(0.18))
      .force("y", forceY<Bubble>((d) => d.ty).strength(0.18))
      .force("charge", forceManyBody<Bubble>().strength(-14))
      .force(
        "collide",
        forceCollide<Bubble>((d) => d.r + 3).iterations(3),
      )
      .stop();

    for (let i = 0; i < 240; i++) sim.tick();

    for (const n of nodes) {
      n.x = Math.max(PAD.left + n.r + 2, Math.min(w - PAD.right - n.r - 2, n.x));
      n.y = Math.max(PAD.top + n.r + 2, Math.min(h - PAD.bottom - n.r - 2, n.y));
    }
    return nodes;
  }, [data.clusters, size, interpolator]);

  const labeledIds = useMemo(() => {
    return [...data.clusters]
      .sort(
        (a, b) =>
          b.sessionCount * (0.4 + b.severity) -
          a.sessionCount * (0.4 + a.severity),
      )
      .slice(0, 5)
      .map((c) => c.id);
  }, [data.clusters]);

  // d3-zoom: panning + scroll-wheel zoom. Bubbles + labels live in a
  // transformed group; the grid stays static so the world doesn't feel
  // like it's sliding under us.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const z = zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.6, 6])
      .filter((event) => {
        // Block double-click zoom so it doesn't fight cluster selection.
        if (event.type === "dblclick") return false;
        return !event.button;
      })
      .on("zoom", (event) => {
        const t = event.transform;
        setZoomT({ k: t.k, x: t.x, y: t.y });
      });
    zoomRef.current = z;
    select(svg).call(z).on("dblclick.zoom", null);
    return () => {
      select(svg).on(".zoom", null);
    };
  }, []);

  const resetZoom = () => {
    const svg = svgRef.current;
    const z = zoomRef.current;
    if (!svg || !z) return;
    select(svg)
      .transition()
      .duration(220)
      .call(z.transform, zoomIdentity);
  };

  return (
    <div className="gapmap-wrap" ref={wrapRef}>
      <div className="gapmap-overlay-tl">
        <div className="gapmap-axis-pill">
          <span className="gapmap-axis-arrow">↔</span>
          <span>topic similarity (UMAP of cluster embeddings)</span>
        </div>
      </div>
      <div className="gapmap-overlay-tr">
        <div className="gapmap-legend-inline">
          <span className="gapmap-legend-swatch ask" /> demand
          <span className="gapmap-legend-swatch gap" /> gap
        </div>
        <button
          type="button"
          className="gapmap-zoom-btn"
          onClick={resetZoom}
          title="Reset zoom"
        >
          reset view
        </button>
      </div>

      <svg
        ref={svgRef}
        className="gapmap-svg"
        width={size.w}
        height={size.h}
        viewBox={`0 0 ${size.w} ${size.h}`}
      >
        <defs>
          <pattern
            id="gapmap-grid"
            width="40"
            height="40"
            patternUnits="userSpaceOnUse"
          >
            <path
              d="M 40 0 L 0 0 0 40"
              fill="none"
              stroke={pal.gridLine}
              strokeWidth="0.5"
            />
          </pattern>
        </defs>
        <rect width={size.w} height={size.h} fill="url(#gapmap-grid)" />
        <g
          transform={`translate(${zoomT.x}, ${zoomT.y}) scale(${zoomT.k})`}
        >
          {bubbles.map((b) => {
            const isSel = selectedId === b.cluster.id;
            return (
              <circle
                key={b.cluster.id}
                cx={b.x}
                cy={b.y}
                r={b.r}
                fill={b.color}
                className={`gapmap-bubble ${b.cluster.type} ${isSel ? "selected" : ""}`}
                onMouseEnter={() => {
                  const wrap = wrapRef.current;
                  if (!wrap) return;
                  const rect = wrap.getBoundingClientRect();
                  setHover({
                    cluster: b.cluster,
                    // Anchor in viewport space — apply current zoom to
                    // map svg coords back to screen.
                    vx: rect.left + zoomT.x + b.x * zoomT.k,
                    vy: rect.top + zoomT.y + (b.y - b.r) * zoomT.k,
                  });
                }}
                onMouseLeave={() => setHover(null)}
                onClick={() => onSelect(b.cluster)}
              />
            );
          })}
          {bubbles
            .filter((b) => labeledIds.includes(b.cluster.id))
            .map((b) => (
              <text
                key={`lbl-${b.cluster.id}`}
                className="gapmap-label"
                x={b.x}
                y={b.y - b.r - 6}
                textAnchor="middle"
              >
                {truncate(b.cluster.label, 28)}
              </text>
            ))}
        </g>
      </svg>

      <div className="gapmap-howto">
        <strong>How to read.</strong> Bubbles cluster by topic similarity ·
        size = sessions · color = severity · dashed = open demand, solid =
        unresolved gap. Scroll to zoom, drag to pan.
      </div>

      {hover && (
        <PortalTooltip x={hover.vx} y={hover.vy}>
          <div className="gapmap-tip-label">
            {truncate(hover.cluster.label, 80)}
          </div>
          <div className="gapmap-tip-meta">
            {hover.cluster.type === "ask" ? "demand" : "gap"} ·{" "}
            {hover.cluster.sessionCount} sess ·{" "}
            {anonymized
              ? `${teamsAffected.get(hover.cluster.id)?.size ?? 0} teams`
              : `${hover.cluster.userCount} eng`}{" "}
            · sev {hover.cluster.severity.toFixed(2)}
          </div>
        </PortalTooltip>
      )}
    </div>
  );
}

export function GapMapCaption({
  data,
  anonymized,
}: {
  data: Dataset;
  anonymized?: boolean;
}) {
  const kicker = topUnresolvedCluster(data.clusters);
  const affected = affectedUserCount(data);
  const teamCount = new Set(data.users.map((u) => u.team)).size;
  const teamsAffected = useMemo(() => {
    if (!kicker) return 0;
    const teamByUser = new Map(data.users.map((u) => [u.id, u.team] as const));
    const memberSet = new Set(kicker.members);
    const teams = new Set<string>();
    for (const s of data.sessions) {
      if (!memberSet.has(s.sessionId)) continue;
      const t = teamByUser.get(s.userId);
      if (t) teams.add(t);
    }
    return teams.size;
  }, [data, kicker]);
  return (
    <div className="gapmap-caption">
      <div className="gapmap-caption-text">
        {kicker ? (
          anonymized ? (
            <>
              <strong>
                {teamsAffected} of your {teamCount} teams
              </strong>{" "}
              hit the same wall:{" "}
              <span className="underline">{truncate(kicker.label, 80)}</span>.
            </>
          ) : (
            <>
              <strong>
                {affected} of your {data.users.length} engineers
              </strong>{" "}
              hit the same wall:{" "}
              <span className="underline">{truncate(kicker.label, 80)}</span>.
            </>
          )
        ) : (
          <>No unresolved clusters in this window.</>
        )}
      </div>
      <div className="gapmap-legend">
        <div>severity</div>
        <div className="gapmap-legend-grad" />
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            width: 140,
            marginLeft: "auto",
          }}
        >
          <span>low</span>
          <span>high</span>
        </div>
      </div>
    </div>
  );
}
