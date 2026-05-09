type Props = {
  values: number[];
  color?: string;
  height?: number;
  width?: number;
};

// Tiny inline sparkline rendered as SVG. No axes, no chrome.
export function Sparkline({ values, color = "var(--color-ink)", height = 28, width = 110 }: Props) {
  if (!values.length) {
    return (
      <div
        className="rounded border-2 border-[var(--color-ink)]/20"
        style={{ height, width }}
      />
    );
  }
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const stepX = values.length > 1 ? width / (values.length - 1) : width;
  const pts = values
    .map((v, i) => {
      const x = i * stepX;
      const y = height - ((v - min) / range) * (height - 4) - 2;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <polyline
        fill="none"
        stroke={color}
        strokeWidth={2.5}
        strokeLinejoin="round"
        strokeLinecap="round"
        points={pts}
      />
    </svg>
  );
}
