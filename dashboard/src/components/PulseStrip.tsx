import type { Dataset } from "../types";
import { formatUsd } from "../format";

interface Props {
  data: Dataset;
}

// Four numbers a partner reads in five seconds.
export default function PulseStrip({ data }: Props) {
  const a = data.aggregates;
  const adoptionPct = Math.round(a.adoptionPct * 100);
  const winPct = Math.round(a.firmWinRate * 100);
  const wastePct = a.totalCostUsd > 0
    ? Math.round((a.totalWasteUsd / a.totalCostUsd) * 100)
    : 0;
  const delta = a.prevPeriodCostUsd != null
    ? a.totalCostUsd - a.prevPeriodCostUsd
    : null;

  return (
    <div className="pulse-strip">
      <PulseTile
        label="Adoption"
        value={`${adoptionPct}%`}
        sub={`${a.totalUsers} consultants tracked`}
        accent={adoptionPct >= 60 ? "good" : adoptionPct >= 30 ? undefined : "warm"}
      />
      <PulseTile
        label="Win rate"
        value={`${winPct}%`}
        sub={`${data.sessions.filter(s => s.outcome === "fully" || s.outcome === "mostly").length}/${data.sessions.length} sessions landed`}
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
