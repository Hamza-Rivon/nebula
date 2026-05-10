import { useMemo, useState } from "react";
import * as d3 from "d3";
import { useChartSize } from "./useChartSize";
import { PortalTooltip } from "../components/PortalTooltip";

export type AreaSeries = { key: string; fill: string; label?: string };

type Props = {
  data: Array<Record<string, number | string>>;
  xKey: string;
  series: AreaSeries[];
  height?: number;
  stack?: boolean;
  yAllowDecimals?: boolean;
};

const PAD = { top: 8, right: 12, bottom: 24, left: 36 };

export function AreaChart({ data, xKey, series, height = 280, stack = false, yAllowDecimals = true }: Props) {
  const { ref, width } = useChartSize();
  const [hover, setHover] = useState<{ idx: number; vx: number; vy: number } | null>(
    null,
  );
  const hoverIdx = hover?.idx ?? null;

  const w = Math.max(width, 0);
  const h = height;
  const innerW = Math.max(w - PAD.left - PAD.right, 0);
  const innerH = Math.max(h - PAD.top - PAD.bottom, 0);

  const xScale = useMemo(
    () =>
      d3
        .scalePoint<string>()
        .domain(data.map((d) => String(d[xKey])))
        .range([0, innerW])
        .padding(0),
    [data, xKey, innerW],
  );

  const stacked = useMemo(() => {
    if (!stack) return null;
    return d3
      .stack<Record<string, number | string>>()
      .keys(series.map((s) => s.key))
      .value((d, k) => Number(d[k] ?? 0))(data);
  }, [data, series, stack]);

  const yMax = useMemo(() => {
    if (stacked) {
      let m = 0;
      for (const layer of stacked) for (const [, top] of layer) if (top > m) m = top;
      return m;
    }
    let m = 0;
    for (const d of data)
      for (const s of series) {
        const v = Number(d[s.key] ?? 0);
        if (v > m) m = v;
      }
    return m;
  }, [data, series, stacked]);

  const yScale = useMemo(
    () =>
      d3
        .scaleLinear()
        .domain([0, yMax || 1])
        .nice()
        .range([innerH, 0]),
    [yMax, innerH],
  );

  const yTicks = yScale.ticks(4).filter((t) => yAllowDecimals || Number.isInteger(t));
  const xTicks = data.map((d) => String(d[xKey]));
  const xTickStride = Math.max(1, Math.ceil(xTicks.length / 8));

  const areaGen = d3
    .area<Record<string, number | string>>()
    .x((d) => xScale(String(d[xKey])) ?? 0)
    .y0(innerH)
    .y1((d) => yScale(Number(d[series[0]?.key ?? ""] ?? 0)))
    .curve(d3.curveMonotoneX);

  function stackedArea(layer: d3.Series<Record<string, number | string>, string>): string {
    const gen = d3
      .area<d3.SeriesPoint<Record<string, number | string>>>()
      .x((d) => xScale(String(d.data[xKey])) ?? 0)
      .y0((d) => yScale(d[0]))
      .y1((d) => yScale(d[1]))
      .curve(d3.curveMonotoneX);
    return gen(layer) ?? "";
  }

  function onMove(e: React.MouseEvent<SVGSVGElement>) {
    if (!data.length) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left - PAD.left;
    const step = innerW / Math.max(data.length - 1, 1);
    const idx = Math.max(0, Math.min(data.length - 1, Math.round(x / step)));
    const localX = (xScale(String(data[idx]?.[xKey])) ?? 0) + PAD.left;
    setHover({ idx, vx: rect.left + localX, vy: rect.top + PAD.top });
  }

  return (
    <div ref={ref} className="relative h-full w-full">
      {w > 0 && (
        <svg
          width={w}
          height={h}
          onMouseMove={onMove}
          onMouseLeave={() => setHover(null)}
          style={{ display: "block" }}
        >
          <g transform={`translate(${PAD.left},${PAD.top})`}>
            {yTicks.map((t) => (
              <g key={t} transform={`translate(0,${yScale(t)})`}>
                <line x1={0} x2={innerW} stroke="var(--color-ink)" strokeOpacity={0.12} />
                <text x={-6} dy="0.32em" textAnchor="end" fontSize={10} fill="var(--color-ink)" opacity={0.6}>
                  {fmtTick(t)}
                </text>
              </g>
            ))}
            {stacked
              ? stacked.map((layer, i) => (
                  <path
                    key={layer.key}
                    d={stackedArea(layer)}
                    fill={series[i]!.fill}
                    stroke="var(--color-ink)"
                    strokeWidth={3}
                  />
                ))
              : series.map((s) => (
                  <path
                    key={s.key}
                    d={
                      areaGen
                        .y1((d) => yScale(Number(d[s.key] ?? 0)))(data) ?? ""
                    }
                    fill={s.fill}
                    stroke="var(--color-ink)"
                    strokeWidth={3}
                  />
                ))}
            {xTicks.map((t, i) =>
              i % xTickStride === 0 ? (
                <text
                  key={`${t}-${i}`}
                  x={xScale(t) ?? 0}
                  y={innerH + 14}
                  textAnchor="middle"
                  fontSize={10}
                  fill="var(--color-ink)"
                  opacity={0.6}
                >
                  {t}
                </text>
              ) : null,
            )}
            {hoverIdx != null && (
              <line
                x1={xScale(String(data[hoverIdx]?.[xKey])) ?? 0}
                x2={xScale(String(data[hoverIdx]?.[xKey])) ?? 0}
                y1={0}
                y2={innerH}
                stroke="var(--color-ink)"
                strokeWidth={1}
                strokeDasharray="3 3"
              />
            )}
          </g>
        </svg>
      )}
      {hover && data[hover.idx] && (
        <PortalTooltip x={hover.vx} y={hover.vy} maxWidth={200}>
          <div className="font-bold">{String(data[hover.idx]![xKey])}</div>
          {series.map((s) => (
            <div key={s.key} className="flex items-center gap-2">
              <span className="inline-block h-2 w-2 border border-[var(--color-ink)]" style={{ background: s.fill }} />
              <span className="opacity-70">{s.label ?? s.key}</span>
              <span className="ml-auto tabular-nums">{fmtTick(Number(data[hover.idx]![s.key] ?? 0))}</span>
            </div>
          ))}
        </PortalTooltip>
      )}
    </div>
  );
}

function fmtTick(n: number): string {
  if (n === 0) return "0";
  const abs = Math.abs(n);
  if (abs >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  if (abs < 1 && abs > 0) return n.toFixed(3);
  return String(Math.round(n * 100) / 100);
}
