import { useEffect, useMemo, useRef, useState } from "react";
import { scaleLinear, scaleSqrt } from "d3-scale";
import { extent } from "d3-array";
import { interpolateRgb } from "d3-interpolate";
import type { Cluster, Dataset } from "../../insights/types";
import { affectedUserCount, topUnresolvedCluster } from "../../insights/derive";
import { truncate } from "../../insights/format";
import { PALETTE } from "../../insights/palette";

interface Props {
  data: Dataset;
  onSelect: (cluster: Cluster) => void;
  selectedId?: string | null;
}

interface BubblePos {
  cluster: Cluster;
  x: number;
  y: number;
  r: number;
  color: string;
}

const PADDING = { top: 36, right: 36, bottom: 36, left: 36 };

export function GapMap({ data, onSelect, selectedId }: Props) {
  const pal = PALETTE;
  const interpolator = useMemo(
    () => interpolateRgb(pal.gapmapLow, pal.gapmapHigh),
    [pal.gapmapLow, pal.gapmapHigh],
  );
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 800, h: 480 });
  const [hover, setHover] = useState<{
    cluster: Cluster;
    x: number;
    y: number;
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

  const bubbles = useMemo<BubblePos[]>(() => {
    if (data.clusters.length === 0) return [];
    const xs = data.clusters.map((c) => c.centroid3d[0]);
    const ys = data.clusters.map((c) => c.centroid3d[1]);
    const [xmin, xmax] = extent(xs) as [number, number];
    const [ymin, ymax] = extent(ys) as [number, number];

    const xScale = scaleLinear()
      .domain([xmin, xmax])
      .range([PADDING.left, Math.max(PADDING.left + 1, size.w - PADDING.right)]);
    const yScale = scaleLinear()
      .domain([ymin, ymax])
      .range([PADDING.top, Math.max(PADDING.top + 1, size.h - PADDING.bottom)]);

    const counts = data.clusters.map((c) => c.sessionCount);
    const cmin = Math.min(...counts);
    const cmax = Math.max(...counts);
    const rScale = scaleSqrt().domain([cmin, cmax]).range([10, 42]);

    const sevMax = Math.max(0.0001, ...data.clusters.map((c) => c.severity));

    return data.clusters.map((c) => ({
      cluster: c,
      x: xScale(c.centroid3d[0]),
      y: yScale(c.centroid3d[1]),
      r: rScale(c.sessionCount),
      color: interpolator(c.severity / sevMax),
    }));
  }, [data.clusters, size, interpolator]);

  const labeledIds = useMemo(() => {
    return [...data.clusters]
      .sort(
        (a, b) =>
          b.sessionCount * (0.4 + b.severity) -
          a.sessionCount * (0.4 + a.severity),
      )
      .slice(0, 4)
      .map((c) => c.id);
  }, [data.clusters]);

  return (
    <div className="gapmap-wrap" ref={wrapRef}>
      <svg
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
        <g className="gapmap-axes">
          <line
            x1={PADDING.left}
            x2={size.w - PADDING.right}
            y1={size.h / 2}
            y2={size.h / 2}
            strokeDasharray="2 4"
          />
          <line
            x1={size.w / 2}
            x2={size.w / 2}
            y1={PADDING.top}
            y2={size.h - PADDING.bottom}
            strokeDasharray="2 4"
          />
        </g>
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
              onMouseEnter={() =>
                setHover({ cluster: b.cluster, x: b.x, y: b.y })
              }
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
              y={b.y - b.r - 8}
              textAnchor="middle"
            >
              {truncate(b.cluster.label, 28)}
            </text>
          ))}
      </svg>
      {hover && (
        <div className="gapmap-tip" style={{ left: hover.x, top: hover.y }}>
          <div className="gapmap-tip-label">
            {truncate(hover.cluster.label, 80)}
          </div>
          <div className="gapmap-tip-meta">
            {hover.cluster.type === "ask" ? "demand" : "gap"} ·{" "}
            {hover.cluster.sessionCount} sess · {hover.cluster.userCount} eng ·
            sev {hover.cluster.severity.toFixed(2)}
          </div>
        </div>
      )}
    </div>
  );
}

export function GapMapCaption({ data }: { data: Dataset }) {
  const kicker = topUnresolvedCluster(data.clusters);
  const affected = affectedUserCount(data);
  return (
    <div className="gapmap-caption">
      <div className="gapmap-caption-text">
        {kicker ? (
          <>
            <strong>
              {affected} of your {data.users.length} engineers
            </strong>{" "}
            hit the same wall:{" "}
            <span className="underline">{truncate(kicker.label, 80)}</span>.
          </>
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
