import type { CSSProperties, ReactNode } from "react";

// Single horizontal row of metric chips that the engineer pages render
// above their long table. Designed to be loud-but-skimmable: a manager
// scanning the tab gets the headline without parsing the table.

export type Metric = {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  // Optional accent color. Defaults to the theme mist.
  bg?: string;
};

export function MetricChips({ items }: { items: Metric[] }) {
  return (
    <div className="metric-strip">
      {items.map((m, i) => (
        <Chip key={`${i}-${m.label}`} m={m} />
      ))}
    </div>
  );
}

function Chip({ m }: { m: Metric }) {
  const style: CSSProperties = m.bg ? { background: m.bg } : {};
  return (
    <div className="metric-chip" style={style}>
      <div className="metric-label">{m.label}</div>
      <div className="metric-value">{m.value}</div>
      {m.hint != null && <div className="metric-hint">{m.hint}</div>}
    </div>
  );
}
