import type { Dataset } from "../../insights/types";
import { formatUsd } from "../../insights/format";

export function PulseStrip({
  data,
  anonymized,
}: {
  data: Dataset;
  anonymized: boolean;
}) {
  const a = data.aggregates;
  const adoptionPct = Math.round(a.adoptionPct * 100);
  const teamCount = new Set(data.users.map((u) => u.team)).size;
  const winPct = Math.round(a.firmWinRate * 100);
  const wastePct =
    a.totalCostUsd > 0
      ? Math.round((a.totalWasteUsd / a.totalCostUsd) * 100)
      : 0;
  const delta =
    a.prevPeriodCostUsd != null ? a.totalCostUsd - a.prevPeriodCostUsd : null;
  const landed = data.sessions.filter(
    (s) => s.outcome === "fully" || s.outcome === "mostly",
  ).length;

  return (
    <div className="pulse-strip">
      <PulseTile
        label="Adoption"
        value={`${adoptionPct}%`}
        sub={
          anonymized
            ? `${teamCount} teams tracked`
            : `${a.totalUsers} engineers tracked`
        }
        accent={adoptionPct >= 60 ? "good" : adoptionPct >= 30 ? undefined : "warm"}
      />
      <PulseTile
        label="Win rate"
        value={`${winPct}%`}
        sub={`${landed}/${data.sessions.length} sessions landed`}
        accent={winPct >= 65 ? "good" : winPct >= 40 ? undefined : "warm"}
      />
      <PulseTile
        label="Spend"
        value={formatUsd(a.totalCostUsd, { decimals: 0 })}
        sub={
          delta != null
            ? `${delta >= 0 ? "+" : ""}${formatUsd(delta, { decimals: 0 })} vs last`
            : "in window"
        }
      />
      <PulseTile
        label="Waste"
        value={`${wastePct}%`}
        sub={`${formatUsd(a.totalWasteUsd, { decimals: 0 })} of spend`}
        accent="warm"
      />
    </div>
  );
}

function PulseTile({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub: string;
  accent?: "good" | "warm";
}) {
  return (
    <div className="pulse-tile">
      <div className="pulse-label">{label}</div>
      <div
        className={`pulse-value ${
          accent === "warm" ? "warm" : accent === "good" ? "good" : ""
        }`}
      >
        {value}
      </div>
      <div className="pulse-sub">{sub}</div>
    </div>
  );
}
