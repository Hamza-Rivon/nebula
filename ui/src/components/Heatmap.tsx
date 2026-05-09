import type { HeatmapCell } from "../api";

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Color ramp from --color-mint -> butter -> peach -> rose
const RAMP = [
  "#FFFBF2", // empty
  "#B8F5C9",
  "#FFE066",
  "#FFB7A8",
  "#FF8FB1",
];

function rampFor(v: number, max: number): string {
  if (v <= 0 || max <= 0) return RAMP[0];
  const t = v / max;
  if (t < 0.05) return RAMP[0];
  if (t < 0.25) return RAMP[1];
  if (t < 0.55) return RAMP[2];
  if (t < 0.85) return RAMP[3];
  return RAMP[4];
}

export function Heatmap({ cells }: { cells: HeatmapCell[] }) {
  const grid: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
  let max = 0;
  for (const c of cells) {
    if (c.dow >= 0 && c.dow < 7 && c.hour >= 0 && c.hour < 24) {
      grid[c.dow][c.hour] = c.n;
      if (c.n > max) max = c.n;
    }
  }
  const empty = max === 0;

  return (
    <div className="overflow-x-auto">
      <table style={{ borderCollapse: "separate", borderSpacing: 2 }}>
        <thead>
          <tr>
            <th className="w-10" />
            {Array.from({ length: 24 }, (_, h) => (
              <th
                key={h}
                className="text-center font-mono text-[10px] font-semibold opacity-60"
                style={{ width: 18 }}
              >
                {h % 3 === 0 ? h : ""}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {DOW.map((label, d) => (
            <tr key={d}>
              <td className="pr-2 text-right font-mono text-[11px] font-semibold opacity-70">
                {label}
              </td>
              {Array.from({ length: 24 }, (_, h) => {
                const v = grid[d][h];
                return (
                  <td
                    key={h}
                    title={`${label} ${h}:00 — ${v} req`}
                    style={{
                      width: 18,
                      height: 18,
                      background: rampFor(v, max || 1),
                      border: "2px solid var(--color-ink)",
                      borderRadius: 3,
                    }}
                  />
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {empty && (
        <div className="mt-3 text-xs opacity-60">
          No traffic in the last 7 days yet.
        </div>
      )}
    </div>
  );
}
