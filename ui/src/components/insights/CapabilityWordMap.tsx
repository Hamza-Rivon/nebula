import { useEffect, useMemo, useRef, useState } from "react";
import { hierarchy, pack, type HierarchyCircularNode } from "d3-hierarchy";
import { interpolateRgb } from "d3-interpolate";
import { select } from "d3-selection";
import { zoom, zoomIdentity, type ZoomBehavior } from "d3-zoom";
import type { Cluster, Dataset } from "../../insights/types";
import { PALETTE } from "../../insights/palette";
import { truncate } from "../../insights/format";
import { PortalTooltip } from "../PortalTooltip";

interface Props {
  data: Dataset;
  onSelect: (cluster: Cluster) => void;
}

interface DomainNode {
  kind: "domain";
  name: string;
  children: ClusterNode[];
}
interface ClusterNode {
  kind: "cluster";
  cluster: Cluster;
  weight: number;
}
interface RootNode {
  kind: "root";
  children: DomainNode[];
}
type AnyNode = RootNode | DomainNode | ClusterNode;

const DOMAIN_LABEL: Record<string, string> = {
  strategy: "Strategy",
  code: "Code",
  research: "Research",
  writing: "Writing",
  data: "Data",
  ops: "Ops",
  other: "Other",
};

export function CapabilityWordMap({ data, onSelect }: Props) {
  const pal = PALETTE;
  const interpolator = useMemo(
    () => interpolateRgb(pal.gapmapLow, pal.gapmapHigh),
    [pal.gapmapLow, pal.gapmapHigh],
  );

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null);

  const [size, setSize] = useState<{ w: number; h: number }>({
    w: 800,
    h: 620,
  });
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

  // Scroll-to-zoom + drag-to-pan. Block dblclick zoom so cluster clicks land.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const z = zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.6, 8])
      .filter((event) => {
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
    select(svg).transition().duration(220).call(z.transform, zoomIdentity);
  };

  const root = useMemo(() => {
    const byDomain = new Map<string, ClusterNode[]>();
    for (const c of data.clusters) {
      const arr = byDomain.get(c.domain) ?? [];
      arr.push({
        kind: "cluster",
        cluster: c,
        weight: c.sessionCount * (0.4 + c.severity),
      });
      byDomain.set(c.domain, arr);
    }
    const domains: DomainNode[] = [...byDomain.entries()]
      .map(([name, children]) => ({
        kind: "domain" as const,
        name,
        children,
      }))
      .sort((a, b) => sumWeight(b) - sumWeight(a));
    return { kind: "root", children: domains } satisfies RootNode;
  }, [data.clusters]);

  const sevMax = Math.max(0.0001, ...data.clusters.map((c) => c.severity));

  const layout = useMemo(() => {
    if (size.w <= 0 || data.clusters.length === 0) return null;
    const h = Math.max(620, size.h);
    const root3 = hierarchy<AnyNode>(root, (n) =>
      n.kind === "cluster" ? null : n.children,
    ).sum((n) => (n.kind === "cluster" ? n.weight : 0));

    const packer = pack<AnyNode>().size([size.w, h]).padding((d) => {
      if (d.depth === 0) return 6;
      if (d.depth === 1) return 4;
      return 2;
    });
    return packer(root3);
  }, [root, size, data.clusters.length]);

  if (!layout) {
    return <div className="wordmap-wrap" ref={wrapRef} />;
  }

  const domainNodes = layout.children ?? [];
  const k = zoomT.k;

  return (
    <div className="wordmap-wrap" ref={wrapRef}>
      <button
        type="button"
        className="wordmap-zoom-btn"
        onClick={resetZoom}
        title="Reset zoom"
      >
        reset view
      </button>
      <svg
        ref={svgRef}
        className="wordmap-svg"
        width={size.w}
        height={Math.max(620, size.h)}
        style={{ display: "block" }}
      >
        {/* Bubbles + rings live inside the zoom-transformed group so they
            pan and scale. Labels live OUTSIDE this group, positioned in
            screen space, so their font size stays constant on zoom and
            stays readable as you zoom in. */}
        <g transform={`translate(${zoomT.x}, ${zoomT.y}) scale(${k})`}>
          {domainNodes.map((dn) => (
            <g key={`d-${(dn.data as DomainNode).name}`}>
              <circle
                cx={dn.x}
                cy={dn.y}
                r={dn.r}
                fill="rgba(17,17,17,0.03)"
                stroke="rgba(17,17,17,0.35)"
                strokeWidth={1.5 / Math.max(1, k)}
                strokeDasharray={`${4 / Math.max(1, k)} ${3 / Math.max(1, k)}`}
              />
              {(dn.children ?? []).map((cn) =>
                renderClusterShape(
                  cn as HierarchyCircularNode<AnyNode>,
                  interpolator,
                  sevMax,
                  k,
                  zoomT.x,
                  zoomT.y,
                  onSelect,
                  (vx, vy, c) => setHover({ cluster: c, vx, vy }),
                  () => setHover(null),
                  wrapRef,
                ),
              )}
            </g>
          ))}
        </g>
        {/* Constant-size labels overlay. Positions are mapped from layout
            space to screen space via the current zoom transform. */}
        <g pointerEvents="none">
          {domainNodes.map((dn) => {
            const node = dn.data as DomainNode;
            const lx = zoomT.x + dn.x * k;
            const ly = zoomT.y + (dn.y - dn.r) * k + 14;
            return (
              <text
                key={`dl-${node.name}`}
                x={lx}
                y={ly}
                textAnchor="middle"
                className="wordmap-domain-label"
              >
                {(DOMAIN_LABEL[node.name] ?? node.name).toUpperCase()}
              </text>
            );
          })}
          {domainNodes.flatMap((dn) =>
            (dn.children ?? []).map((cn) =>
              renderClusterLabel(cn as HierarchyCircularNode<AnyNode>, k, zoomT.x, zoomT.y),
            ),
          )}
        </g>
      </svg>
      {hover && (
        <PortalTooltip x={hover.vx} y={hover.vy}>
          <div className="gapmap-tip-label">
            {truncate(hover.cluster.label, 80)}
          </div>
          <div className="gapmap-tip-meta">
            {hover.cluster.type === "ask" ? "demand" : "gap"} ·{" "}
            {hover.cluster.sessionCount} sess · sev{" "}
            {hover.cluster.severity.toFixed(2)}
          </div>
        </PortalTooltip>
      )}
    </div>
  );
}

function renderClusterShape(
  cn: HierarchyCircularNode<AnyNode>,
  interp: (t: number) => string,
  sevMax: number,
  k: number,
  zx: number,
  zy: number,
  onSelect: (c: Cluster) => void,
  onHover: (vx: number, vy: number, c: Cluster) => void,
  onLeave: () => void,
  wrapRef: React.RefObject<HTMLDivElement | null>,
) {
  if (cn.data.kind !== "cluster") return null;
  const c = cn.data.cluster;
  const fill = interp(c.severity / sevMax);
  return (
    <g
      key={`c-${c.id}`}
      style={{ cursor: "pointer" }}
      onClick={() => onSelect(c)}
      onMouseEnter={() => {
        const wrap = wrapRef.current;
        if (!wrap) return;
        const rect = wrap.getBoundingClientRect();
        onHover(
          rect.left + zx + cn.x * k,
          rect.top + zy + (cn.y - cn.r) * k,
          c,
        );
      }}
      onMouseLeave={onLeave}
    >
      <circle
        cx={cn.x}
        cy={cn.y}
        r={cn.r}
        fill={fill}
        fillOpacity={0.85}
        stroke="var(--color-ink)"
        strokeWidth={2 / Math.max(1, k)}
        strokeDasharray={
          c.type === "ask" ? `${4 / Math.max(1, k)} ${3 / Math.max(1, k)}` : undefined
        }
      />
    </g>
  );
}

function renderClusterLabel(
  cn: HierarchyCircularNode<AnyNode>,
  k: number,
  zx: number,
  zy: number,
) {
  if (cn.data.kind !== "cluster") return null;
  const c = cn.data.cluster;
  // Effective on-screen radius — used to decide whether a label fits and
  // how many characters of it we keep. Zooming in grows `eff` and reveals
  // labels on smaller bubbles.
  const eff = cn.r * k;
  if (eff < 22) return null;
  const fontSize = clusterFontSize(eff);
  // Roughly two characters per (visible) radius unit at our font scale.
  const charBudget = Math.max(4, Math.floor((eff * 1.7) / fontSize));
  const label = truncate(c.label, charBudget);
  // Project layout-space center to screen space. Constant font size means
  // text appears the same size regardless of zoom — so it gets *easier*
  // to read as you zoom in, not bigger.
  const sx = zx + cn.x * k;
  const sy = zy + cn.y * k + fontSize / 3;
  return (
    <text
      key={`cl-${c.id}`}
      x={sx}
      y={sy}
      textAnchor="middle"
      className="wordmap-cluster-label"
      style={{ fontSize }}
    >
      {label}
    </text>
  );
}

function clusterFontSize(effR: number): number {
  // Picked off the on-screen (effective) radius. Clamped so even very
  // small bubbles, when zoomed, get readable labels.
  if (effR >= 80) return 14;
  if (effR >= 56) return 13;
  if (effR >= 40) return 12;
  if (effR >= 30) return 11;
  return 10;
}

function sumWeight(d: DomainNode): number {
  let s = 0;
  for (const c of d.children) s += c.weight;
  return s;
}
