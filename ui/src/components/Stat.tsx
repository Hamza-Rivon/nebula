type Props = {
  label: string;
  value: string | number;
  hint?: string;
  color?: string;
};

export function Stat({ label, value, hint, color = "var(--color-butter)" }: Props) {
  return (
    <div className="nb-card p-5" style={{ background: color }}>
      <div className="text-xs font-semibold uppercase tracking-wider opacity-70">
        {label}
      </div>
      <div className="mt-1 font-display text-3xl font-bold tabular-nums">
        {value}
      </div>
      {hint && <div className="mt-1 text-xs opacity-60">{hint}</div>}
    </div>
  );
}
