import { useMemo } from "react";
import type { Dataset } from "../../insights/types";
import { formatUsd } from "../../insights/format";
import { firmRiskExposure } from "../../insights/risk";

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
  // Forensics framing: the headline is "spend at risk" — the share of
  // dollars sitting in sessions our pipeline would flag for a manager to
  // glance at. Replaces the previous "% wasted" tile, which read as
  // accounting truth despite being derived from LLM heuristics.
  const risk = useMemo(() => firmRiskExposure(data.sessions), [data.sessions]);
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
        label="Spend at risk"
        value={`${risk.pct}%`}
        sub={`${formatUsd(risk.spendAtRisk, { decimals: 0 })} across ${risk.flaggedSessions} flagged session${risk.flaggedSessions === 1 ? "" : "s"}`}
        accent={risk.pct >= 25 ? "warm" : risk.pct >= 10 ? undefined : "good"}
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
