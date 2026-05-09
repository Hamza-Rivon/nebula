import type { Dataset, User } from "../../types";
import Avatar from "../Avatar";
import Clamp from "../Clamp";
import { formatDate, formatInt, formatUsd } from "../../format";

interface Props {
  user: User;
  data: Dataset;
  onOpenSession?: (s: Dataset["sessions"][number]) => void;
}

export default function UserDrawer({ user, data, onOpenSession }: Props) {
  const sessions = data.sessions
    .filter((s) => s.userId === user.id)
    .sort(
      (a, b) =>
        new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
    );

  return (
    <>
      <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
        <Avatar seed={user.avatarSeed} size={56} />
        <div>
          <div className="dim" style={{ fontSize: 12 }}>
            {user.team} team
          </div>
          <div style={{ fontSize: 17, fontWeight: 500 }}>{user.displayName}</div>
        </div>
      </div>

      <div className="stat-grid">
        <Stat label="Sessions" value={formatInt(user.sessionCount)} />
        <Stat
          label="Wizard score"
          value={user.wizardScore.toFixed(2)}
          tone={user.wizardScore > 0.5 ? "positive" : undefined}
        />
        <Stat label="Spend" value={formatUsd(user.totalCostUsd, { decimals: 0 })} />
        <Stat
          label="Waste"
          value={formatUsd(user.totalWasteUsd, { decimals: 0 })}
          tone={user.totalWasteUsd > 0 ? "warn" : undefined}
        />
      </div>

      <div>
        <h3 className="section-h">Outcomes</h3>
        <OutcomeBar outcomes={user.outcomes} />
      </div>

      <div>
        <h3 className="section-h">Top tools</h3>
        <ChipList map={user.topTools} />
      </div>

      {Object.keys(user.topFrictions).length > 0 && (
        <div>
          <h3 className="section-h">Top frictions</h3>
          <ChipList map={user.topFrictions} tone="warn" />
        </div>
      )}

      <div>
        <h3 className="section-h">Recent sessions</h3>
        {sessions.slice(0, 12).map((s) => (
          <div
            key={s.sessionId}
            className="session-row"
            onClick={() => onOpenSession?.(s)}
            role={onOpenSession ? "button" : undefined}
          >
            <span className={`outcome-dot ${s.outcome}`} />
            <div>
              <div className="session-title">
                {s.projectName}
                <span className="dim mono" style={{ marginLeft: 10, fontSize: 11.5 }}>
                  {formatDate(s.startedAt)}
                </span>
              </div>
              <div className="session-meta" style={{ whiteSpace: "normal" }}>
                <Clamp text={s.briefSummary || s.goal} lines={2} />
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div className="session-amt">
                {formatUsd(s.costUsd, { decimals: 1 })}
              </div>
              {s.wasteUsd > 0 && (
                <div
                  className="mono"
                  style={{ color: "var(--warm)", fontSize: 11 }}
                >
                  {formatUsd(s.wasteUsd, { decimals: 1 })} wasted
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "warn" | "positive";
}) {
  const color =
    tone === "warn"
      ? "var(--warm)"
      : tone === "positive"
        ? "var(--positive)"
        : undefined;
  return (
    <div className="stat-cell">
      <div className="stat-label">{label}</div>
      <div className="stat-value" style={color ? { color } : undefined}>
        {value}
      </div>
    </div>
  );
}

function ChipList({
  map,
  tone,
}: {
  map: Record<string, number>;
  tone?: "warn";
}) {
  const entries = Object.entries(map).sort((a, b) => b[1] - a[1]);
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
      {entries.map(([k, v]) => (
        <span
          key={k}
          className="tag"
          style={tone === "warn" ? { color: "var(--warm)", borderColor: "#e8c8b8" } : undefined}
        >
          {k.replace(/_/g, " ")} <span style={{ opacity: 0.6 }}>{v}</span>
        </span>
      ))}
    </div>
  );
}

function OutcomeBar({ outcomes }: { outcomes: User["outcomes"] }) {
  const total =
    outcomes.fully +
    outcomes.mostly +
    outcomes.partial +
    outcomes.none +
    outcomes.unclear;
  if (total === 0) return <div className="dim">No outcomes recorded.</div>;
  const segs: { k: keyof User["outcomes"]; color: string; label: string }[] = [
    { k: "fully", color: "var(--positive)", label: "fully" },
    { k: "mostly", color: "#84c8a8", label: "mostly" },
    { k: "partial", color: "var(--warn)", label: "partial" },
    { k: "none", color: "var(--warm)", label: "none" },
    { k: "unclear", color: "var(--ink-3)", label: "unclear" },
  ];
  return (
    <>
      <div
        style={{
          display: "flex",
          height: 8,
          overflow: "hidden",
          border: "1px solid var(--rule)",
        }}
      >
        {segs.map((s) => {
          const v = outcomes[s.k];
          if (v === 0) return null;
          return (
            <div
              key={s.k}
              style={{
                flexBasis: `${(v / total) * 100}%`,
                background: s.color,
              }}
            />
          );
        })}
      </div>
      <div
        className="dim mono"
        style={{
          display: "flex",
          gap: 12,
          marginTop: 6,
          fontSize: 11,
          flexWrap: "wrap",
        }}
      >
        {segs
          .filter((s) => outcomes[s.k] > 0)
          .map((s) => (
            <span key={s.k}>
              <span
                style={{
                  display: "inline-block",
                  width: 8,
                  height: 8,
                  background: s.color,
                  marginRight: 5,
                  verticalAlign: -1,
                }}
              />
              {outcomes[s.k]} {s.label}
            </span>
          ))}
      </div>
    </>
  );
}
