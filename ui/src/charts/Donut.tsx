import { useMemo, useState } from "react";
import * as d3 from "d3";
import { useChartSize } from "./useChartSize";

type Datum = { name: string; value: number; fill: string };

type Props = {
  data: Datum[];
  height?: number;
  innerRadius?: number;
  outerRadius?: number;
};

export function Donut({ data, height = 200, innerRadius, outerRadius }: Props) {
  const { ref, width } = useChartSize();
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const w = Math.max(width, 0);
  const h = height;
  const r = Math.min(w, h) / 2;
  const ro = outerRadius ?? Math.max(r - 4, 30);
  const ri = innerRadius ?? Math.max(ro * 0.55, 0);

  const pieGen = useMemo(
    () =>
      d3
        .pie<Datum>()
        .value((d) => d.value)
        .sort(null),
    [],
  );
  const arcGen = useMemo(
    () => d3.arc<d3.PieArcDatum<Datum>>().innerRadius(ri).outerRadius(ro),
    [ri, ro],
  );
  const arcs = useMemo(() => pieGen(data), [pieGen, data]);
  const total = useMemo(() => data.reduce((s, d) => s + d.value, 0), [data]);

  return (
    <div ref={ref} className="relative h-full w-full">
      {w > 0 && (
        <svg width={w} height={h} style={{ display: "block" }}>
          <g transform={`translate(${w / 2},${h / 2})`}>
            {arcs.map((a, i) => (
              <path
                key={i}
                d={arcGen(a) ?? ""}
                fill={data[i]!.fill}
                stroke="var(--color-ink)"
                strokeWidth={3}
                onMouseEnter={() => setHoverIdx(i)}
                onMouseLeave={() => setHoverIdx(null)}
              />
            ))}
          </g>
        </svg>
      )}
      {hoverIdx != null && data[hoverIdx] && (
        <div
          className="nb-card pointer-events-none absolute p-2 text-[11px]"
          style={{
            left: w / 2 - 70,
            top: h / 2 - 24,
            width: 140,
            background: "white",
          }}
        >
          <div className="font-bold">{data[hoverIdx]!.name}</div>
          <div className="flex items-center gap-2">
            <span
              className="inline-block h-2 w-2 border border-[var(--color-ink)]"
              style={{ background: data[hoverIdx]!.fill }}
            />
            <span className="ml-auto tabular-nums">
              {data[hoverIdx]!.value} ({total > 0 ? Math.round((data[hoverIdx]!.value / total) * 100) : 0}%)
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
