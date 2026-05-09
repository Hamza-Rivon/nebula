interface Props {
  values: number[];
  width?: number;
  height?: number;
  stroke?: string;
  fill?: string;
  domain?: [number, number];
}

export default function Sparkline({
  values,
  width = 80,
  height = 22,
  stroke = "#2D5F8E",
  fill,
  domain,
}: Props) {
  if (values.length === 0) {
    return (
      <svg width={width} height={height} className="sparkline">
        <line
          x1={0}
          y1={height / 2}
          x2={width}
          y2={height / 2}
          stroke="#e6e2d7"
          strokeWidth={1}
        />
      </svg>
    );
  }

  const min = domain?.[0] ?? Math.min(...values);
  const max = domain?.[1] ?? Math.max(...values);
  const range = max - min || 1;

  const step = values.length > 1 ? width / (values.length - 1) : width;
  const pad = 2;
  const inner = height - pad * 2;

  const pts = values.map((v, i) => {
    const x = i * step;
    const y = pad + (1 - (v - min) / range) * inner;
    return [x, y] as const;
  });

  const d = pts
    .map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`)
    .join(" ");

  const area = `${d} L${(pts.at(-1)?.[0] ?? 0).toFixed(2)} ${height} L0 ${height} Z`;

  return (
    <svg width={width} height={height} className="sparkline" aria-hidden>
      {fill && <path d={area} fill={fill} />}
      <path
        d={d}
        fill="none"
        stroke={stroke}
        strokeWidth={1.25}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {pts.length > 0 && (
        <circle
          cx={pts.at(-1)![0]}
          cy={pts.at(-1)![1]}
          r={1.6}
          fill={stroke}
        />
      )}
    </svg>
  );
}
