import { useMemo, useState } from "react";
import * as d3 from "d3";
import { useChartSize } from "./useChartSize";
import { PortalTooltip } from "../components/PortalTooltip";

type Datum = { name: string; count: number; fill: string };

type Props = {
  data: Datum[];
  height?: number;
  rotateLabels?: boolean;
};

export function BarChart({ data, height = 280, rotateLabels = false }: Props) {
  const { ref, width } = useChartSize();
  const [hover, setHover] = useState<{ idx: number; vx: number; vy: number } | null>(
    null,
  );

  const PAD = {
    top: 8,
    right: 12,
    bottom: rotateLabels ? 60 : 24,
    left: 36,
  };

  const w = Math.max(width, 0);
  const h = height;
  const innerW = Math.max(w - PAD.left - PAD.right, 0);
  const innerH = Math.max(h - PAD.top - PAD.bottom, 0);

  const xScale = useMemo(
    () =>
      d3
        .scaleBand<string>()
        .domain(data.map((d) => d.name))
        .range([0, innerW])
        .padding(0.2),
    [data, innerW],
  );

  const yMax = useMemo(() => d3.max(data, (d) => d.count) ?? 0, [data]);
  const yScale = useMemo(
    () =>
      d3
        .scaleLinear()
        .domain([0, yMax || 1])
        .nice()
        .range([innerH, 0]),
    [yMax, innerH],
  );
  const yTicks = yScale.ticks(4).filter((t) => Number.isInteger(t));

  return (
    <div ref={ref} className="relative h-full w-full">
      {w > 0 && (
        <svg width={w} height={h} style={{ display: "block" }}>
          <g transform={`translate(${PAD.left},${PAD.top})`}>
            {yTicks.map((t) => (
              <g key={t} transform={`translate(0,${yScale(t)})`}>
                <line x1={0} x2={innerW} stroke="var(--color-ink)" strokeOpacity={0.12} />
                <text x={-6} dy="0.32em" textAnchor="end" fontSize={10} fill="var(--color-ink)" opacity={0.6}>
                  {fmtTick(t)}
                </text>
              </g>
            ))}
            {data.map((d, i) => {
              const x = xScale(d.name) ?? 0;
              const bw = xScale.bandwidth();
              const y = yScale(d.count);
              const bh = innerH - y;
              return (
                <rect
                  key={d.name}
                  x={x}
                  y={y}
                  width={bw}
                  height={bh}
                  fill={d.fill}
                  stroke="var(--color-ink)"
                  strokeWidth={2}
                  onMouseEnter={() => {
                    const host = ref.current;
                    if (!host) return;
                    const rect = host.getBoundingClientRect();
                    setHover({
                      idx: i,
                      vx: rect.left + PAD.left + x + bw / 2,
                      vy: rect.top + PAD.top + y,
                    });
                  }}
                  onMouseLeave={() => setHover(null)}
                />
              );
            })}
            {data.map((d) => {
              const cx = (xScale(d.name) ?? 0) + xScale.bandwidth() / 2;
              return (
                <text
                  key={d.name}
                  x={cx}
                  y={innerH + 14}
                  textAnchor={rotateLabels ? "end" : "middle"}
                  transform={rotateLabels ? `rotate(-25, ${cx}, ${innerH + 14})` : undefined}
                  fontSize={10}
                  fill="var(--color-ink)"
                  opacity={0.7}
                >
                  {truncate(d.name, 14)}
                </text>
              );
            })}
          </g>
        </svg>
      )}
      {hover && data[hover.idx] && (
        <PortalTooltip x={hover.vx} y={hover.vy} maxWidth={200}>
          <div className="font-bold">{data[hover.idx]!.name}</div>
          <div className="flex items-center gap-2">
            <span
              className="inline-block h-2 w-2 border border-[var(--color-ink)]"
              style={{ background: data[hover.idx]!.fill }}
            />
            <span className="opacity-70">count</span>
            <span className="ml-auto tabular-nums">{data[hover.idx]!.count}</span>
          </div>
        </PortalTooltip>
      )}
    </div>
  );
}

function fmtTick(n: number): string {
  if (n === 0) return "0";
  if (Math.abs(n) >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}
