import { useMemo } from "react";
import type { Dataset, SessionMeta } from "../types";
import {
  daysBetween,
  formatUsd,
  redactPrompt,
  truncate,
  wasteTypeLabel,
} from "../format";
import { dominantWasteType, topWasteSessions } from "../derive";
import Counter from "./Counter";

interface Props {
  data: Dataset;
  onOpenWaste: (type: string) => void;
  onOpenSession: (s: SessionMeta) => void;
}

// Single-hue waste palette tuned for the warm light theme.
const WASTE_PALETTE: Record<string, string> = {
  abandoned: "#C25A2C",
  retry_loop: "#A8482D",
  wrong_model: "#8E5237",
  context_bloat: "#7A5C46",
  redundant_prompt: "#605750",
};

export default function WhereToCut({ data, onOpenWaste, onOpenSession }: Props) {
  const a = data.aggregates;
  const days = daysBetween(a.dateRange.start, a.dateRange.end);
  const monthly = (a.totalWasteUsd / Math.max(1, days)) * 30;

  const segments = useMemo(() => {
    const total = Object.values(a.wasteByType).reduce(
      (acc, v) => acc + v.usd,
      0,
    );
    const entries = Object.entries(a.wasteByType).sort(
      (x, y) => y[1].usd - x[1].usd,
    );
    return entries.map(([type, v]) => ({
      type,
      usd: v.usd,
      sessions: v.sessions,
      pct: total > 0 ? v.usd / total : 0,
      color: WASTE_PALETTE[type] ?? "#605750",
    }));
  }, [a.wasteByType]);

  const offenders = topWasteSessions(data, undefined, 3);

  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <div className="panel-sub">Q2 — Where to cut</div>
          <h3 className="panel-title">Wasted spend</h3>
        </div>
        <div className="panel-meta">Normalized to monthly run-rate</div>
      </div>
      <div className="panel-body">
        <div className="leakage-headline">
          <Counter
            to={monthly}
            format={(v) => formatUsd(v, { decimals: 0 })}
            className="leakage-amount"
          />
          <span className="leakage-unit">/ month leakage</span>
        </div>
        <div className="leakage-caption">
          {formatUsd(a.totalWasteUsd, { decimals: 0 })} burned across{" "}
          {Object.values(a.wasteByType).reduce(
            (acc, v) => acc + v.sessions,
            0,
          )}{" "}
          sessions in the window — {Math.round(
            (a.totalWasteUsd / Math.max(a.totalCostUsd, 1)) * 100,
          )}% of firm spend. Click a band to inspect.
        </div>

        <div>
          <div className="stack-bar">
            {segments.map((s) => (
              <div
                key={s.type}
                className="stack-seg"
                style={{
                  flexBasis: `${s.pct * 100}%`,
                  background: s.color,
                }}
                onClick={() => onOpenWaste(s.type)}
                title={`${wasteTypeLabel(s.type)} · ${formatUsd(s.usd)}`}
              >
                {s.pct > 0.12 ? wasteTypeLabel(s.type) : ""}
              </div>
            ))}
          </div>
          <div className="stack-legend">
            {segments.map((s) => (
              <div
                key={s.type}
                className="legend-row"
                onClick={() => onOpenWaste(s.type)}
              >
                <span
                  className="legend-swatch"
                  style={{ background: s.color }}
                />
                <span>
                  {wasteTypeLabel(s.type)}
                  <span className="dim mono" style={{ marginLeft: 8 }}>
                    {s.sessions} sess
                  </span>
                </span>
                <span className="v">{formatUsd(s.usd, { decimals: 0 })}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="offenders">
          <h4>Top offenders</h4>
          {offenders.length === 0 ? (
            <div className="dim" style={{ fontSize: 12.5 }}>
              No sessions with measurable waste in this window.
            </div>
          ) : (
            offenders.map((s, i) => {
              const dom = dominantWasteType(s);
              return (
                <div
                  key={s.sessionId}
                  className="offender-row"
                  onClick={() => onOpenSession(s)}
                >
                  <div className="offender-rank">0{i + 1}</div>
                  <div>
                    <div className="offender-title">
                      <span>{s.projectName}</span>
                      {dom && <span className="tag">{wasteTypeLabel(dom)}</span>}
                    </div>
                    <div className="offender-summary">
                      {truncate(redactPrompt(s.briefSummary || s.goal, 200), 110)}
                    </div>
                  </div>
                  <div className="offender-amount">
                    {formatUsd(s.wasteUsd)}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </section>
  );
}
