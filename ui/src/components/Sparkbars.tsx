type Bar = { label: string; value: number };
export function Sparkbars({ data, color = "var(--color-sky)" }: { data: Bar[]; color?: string }) {
  if (!data.length) {
    return <div className="text-sm opacity-60">No data yet — make your first proxy call.</div>;
  }
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <div className="flex h-32 items-end gap-1">
      {data.map((d, i) => {
        const h = Math.max(4, Math.round((d.value / max) * 100));
        return (
          <div key={i} className="flex flex-1 flex-col items-center gap-1">
            <div
              className="w-full rounded-t-md border-2 border-[var(--color-ink)]"
              style={{ height: `${h}%`, background: color }}
              title={`${d.label}: ${d.value}`}
            />
          </div>
        );
      })}
    </div>
  );
}
