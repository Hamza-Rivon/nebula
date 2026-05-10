import { useMemo, useState } from "react";
import * as d3 from "d3";
import { useChartSize } from "./useChartSize";

type Datum = { name: string; count: number; fill: string };

type Props = {
  data: Datum[];
  height?: number;
  rotateLabels?: boolean;
};

export function BarChart({ data, height = 280, rotateLabels = false }: Props) {
  const { ref, width } = useChartSize();
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

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
                  onMouseEnter={() => setHoverIdx(i)}
                  onMouseLeave={() => setHoverIdx(null)}
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
      {hoverIdx != null && data[hoverIdx] && (
        <Tooltip
          x={(xScale(data[hoverIdx]!.name) ?? 0) + xScale.bandwidth() / 2 + PAD.left}
          y={PAD.top + yScale(data[hoverIdx]!.count) - 8}
          containerWidth={w}
        >
          <div className="font-bold">{data[hoverIdx]!.name}</div>
          <div className="flex items-center gap-2">
            <span
              className="inline-block h-2 w-2 border border-[var(--color-ink)]"
              style={{ background: data[hoverIdx]!.fill }}
            />
            <span className="opacity-70">count</span>
            <span className="ml-auto tabular-nums">{data[hoverIdx]!.count}</span>
          </div>
        </Tooltip>
      )}
    </div>
  );
}

function Tooltip({
  x,
  y,
  containerWidth,
  children,
}: {
  x: number;
  y: number;
  containerWidth: number;
  children: React.ReactNode;
}) {
  const W = 160;
  const left = Math.min(Math.max(x - W / 2, 4), Math.max(containerWidth - W - 4, 4));
  return (
    <div
      className="nb-card pointer-events-none absolute p-2 text-[11px]"
      style={{ left, top: Math.max(y - 50, 4), width: W, background: "white" }}
    >
      {children}
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
