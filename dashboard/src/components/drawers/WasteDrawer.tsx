import type { Dataset, SessionMeta } from "../../types";
import Clamp from "../Clamp";
import { formatDate, formatUsd, wasteTypeLabel } from "../../format";

interface Props {
  wasteType: string;
  data: Dataset;
  onOpenSession?: (s: SessionMeta) => void;
}

export default function WasteDrawer({ wasteType, data, onOpenSession }: Props) {
  const bucket = data.aggregates.wasteByType[wasteType];
  const offending = data.sessions
    .filter((s) => s.wasteFlags.some((f) => f.type === wasteType))
    .sort((a, b) => b.wasteUsd - a.wasteUsd);

  const pct =
    data.aggregates.totalCostUsd > 0
      ? ((bucket?.usd ?? 0) / data.aggregates.totalCostUsd) * 100
      : 0;

  return (
    <>
      <div className="stat-grid">
        <Stat label="Total burned" value={formatUsd(bucket?.usd ?? 0, { decimals: 0 })} tone="warn" />
        <Stat label="Sessions" value={String(bucket?.sessions ?? 0)} />
        <Stat label="% of firm spend" value={`${pct.toFixed(1)}%`} />
        <Stat
          label="Tokens"
          value={(bucket?.tokens ?? 0).toLocaleString()}
        />
      </div>

      <div>
        <h3 className="section-h">Diagnosis</h3>
        <div className="redacted-prompt">{diagnosisText(wasteType)}</div>
      </div>

      <div>
        <h3 className="section-h">Offending sessions</h3>
        {offending.map((s) => {
          const flag = s.wasteFlags.find((f) => f.type === wasteType);
          return (
            <div
              key={s.sessionId}
              className="session-row"
              style={{ cursor: onOpenSession ? "pointer" : undefined }}
              onClick={() => onOpenSession?.(s)}
            >
              <span className={`outcome-dot ${s.outcome}`} />
              <div>
                <div className="session-title">
                  {s.projectName}
                  <span className="dim mono" style={{ marginLeft: 10, fontSize: 11.5 }}>
                    {formatDate(s.startedAt)} · user {s.userId}
                  </span>
                </div>
                <div
                  className="session-meta"
                  style={{ color: "var(--ink-3)", whiteSpace: "normal" }}
                >
                  <Clamp
                    text={flag?.evidence || s.briefSummary || s.goal}
                    lines={2}
                  />
                </div>
              </div>
              <div className="session-amt" style={{ color: "var(--warm)" }}>
                {formatUsd(flag?.usdWasted ?? s.wasteUsd, { decimals: 1 })}
              </div>
            </div>
          );
        })}
        {offending.length === 0 && (
          <div className="dim">No offending sessions for {wasteTypeLabel(wasteType)}.</div>
        )}
      </div>
    </>
  );
}

function diagnosisText(t: string): string {
  switch (t) {
    case "wrong_model":
      return "Sessions where Opus-tier models were used for tasks a Haiku- or Sonnet-class model could have completed. Route by goal complexity, not by habit.";
    case "retry_loop":
      return "Multiple consecutive turns making the same tool call against the same target with no progress. A CLAUDE.md rule and a stop-condition on the agent fixes most.";
    case "abandoned":
      return "Long sessions ended without a clear deliverable. Usually a missing-context problem upstream — the prompt didn't tell the model what 'done' looks like.";
    case "context_bloat":
      return "Cache create costs dominating the run. Consider trimming attached files or splitting into focused sessions.";
    case "redundant_prompt":
      return "Prompts duplicated across sessions. A shared prompt template would cut firm-wide spend without changing behavior.";
    default:
      return "Investigate the offending sessions for shared root cause.";
  }
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "warn";
}) {
  return (
    <div className="stat-cell">
      <div className="stat-label">{label}</div>
      <div
        className="stat-value"
        style={tone === "warn" ? { color: "var(--warm)" } : undefined}
      >
        {value}
      </div>
    </div>
  );
}
