import { Link } from "react-router-dom";
import type { Dataset, SessionMeta, User } from "../../../insights/types";
import { formatDate, formatUsd } from "../../../insights/format";
import { teamSessions, type TeamSummary } from "../../../insights/teams";

interface Props {
  team: TeamSummary;
  data: Dataset;
}

export function TeamDrawer({ team, data }: Props) {
  const sessions = teamSessions(data, team.id).sort(
    (a, b) =>
      new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
  );

  const personaTotal =
    team.personaMix.power +
    team.personaMix.active +
    team.personaMix.stuck +
    team.personaMix.misuser +
    team.personaMix.lurker;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-2">
        <Stat label="Headcount" value={String(team.memberCount)} />
        <Stat label="Sessions" value={String(team.sessionCount)} />
        <Stat label="Spend" value={formatUsd(team.totalCostUsd, { decimals: 0 })} />
        <Stat
          label="Exposure"
          value={formatUsd(team.totalWasteUsd, { decimals: 0 })}
          tone={team.totalWasteUsd > 0 ? "warn" : undefined}
        />
        <Stat
          label="Win rate"
          value={`${Math.round(team.winRate * 100)}%`}
          tone={team.winRate >= 0.6 ? "good" : team.winRate < 0.35 ? "warn" : undefined}
        />
        <Stat
          label="$/win"
          value={
            team.costPerWin > 0 && isFinite(team.costPerWin)
              ? formatUsd(team.costPerWin, { decimals: 0 })
              : "—"
          }
        />
      </div>

      <div>
        <SectionTitle>Outcomes</SectionTitle>
        <OutcomeBar outcomes={team.outcomes} />
      </div>

      {personaTotal > 0 && (
        <div>
          <SectionTitle>Persona mix</SectionTitle>
          <PersonaBar mix={team.personaMix} total={personaTotal} />
        </div>
      )}

      {Object.keys(team.topTools).length > 0 && (
        <div>
          <SectionTitle>Top tools</SectionTitle>
          <ChipList map={team.topTools} max={10} />
        </div>
      )}

      {Object.keys(team.topFrictions).length > 0 && (
        <div>
          <SectionTitle>Top frictions</SectionTitle>
          <ChipList map={team.topFrictions} max={10} tone="warn" />
        </div>
      )}

      <div>
        <SectionTitle>Recent sessions</SectionTitle>
        <ul className="space-y-2">
          {sessions.slice(0, 12).map((s) => (
            <SessionRow key={s.sessionId} s={s} />
          ))}
          {sessions.length === 0 && (
            <li className="dim text-sm">No sessions in this window.</li>
          )}
        </ul>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "good" | "warn";
}) {
  return (
    <div className="nb-card-flat p-2">
      <div className="text-[10px] font-bold uppercase tracking-widest opacity-60">
        {label}
      </div>
      <div
        className={`text-xl font-bold tabular-nums ${
          tone === "warn" ? "warm" : tone === "good" ? "positive" : ""
        }`}
      >
        {value}
      </div>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-1.5 text-[10px] font-bold uppercase tracking-widest opacity-60">
      {children}
    </div>
  );
}

function ChipList({
  map,
  tone,
  max,
}: {
  map: Record<string, number>;
  tone?: "warn";
  max?: number;
}) {
  const entries = Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .slice(0, max ?? Infinity);
  return (
    <div className="flex flex-wrap gap-1.5">
      {entries.map(([k, v]) => (
        <span
          key={k}
          className="nb-tag"
          style={tone === "warn" ? { background: "var(--color-peach)" } : undefined}
        >
          {k.replace(/_/g, " ")}{" "}
          <span style={{ opacity: 0.6 }}>{v}</span>
        </span>
      ))}
    </div>
  );
}

function OutcomeBar({ outcomes }: { outcomes: User["outcomes"] }) {
  const total =
    outcomes.fully + outcomes.mostly + outcomes.partial + outcomes.none + outcomes.unclear;
  if (total === 0) return <div className="dim text-sm">No outcomes recorded.</div>;
  const segs: { k: keyof User["outcomes"]; color: string }[] = [
    { k: "fully", color: "#1F7A3A" },
    { k: "mostly", color: "#86c5a3" },
    { k: "partial", color: "#FFB54E" },
    { k: "none", color: "#B23A1F" },
    { k: "unclear", color: "#888" },
  ];
  return (
    <>
      <div className="flex h-2.5 overflow-hidden border-2 border-[var(--color-ink)] rounded">
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
      <div className="mt-2 flex flex-wrap gap-3 text-[11px] opacity-70 mono">
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
              {outcomes[s.k]} {s.k}
            </span>
          ))}
      </div>
    </>
  );
}

function PersonaBar({
  mix,
  total,
}: {
  mix: TeamSummary["personaMix"];
  total: number;
}) {
  const segs: { k: keyof TeamSummary["personaMix"]; color: string }[] = [
    { k: "power", color: "#1F7A3A" },
    { k: "active", color: "#2C68C8" },
    { k: "stuck", color: "#B47A12" },
    { k: "misuser", color: "#B23A1F" },
    { k: "lurker", color: "#777" },
  ];
  return (
    <>
      <div className="flex h-2.5 overflow-hidden border-2 border-[var(--color-ink)] rounded">
        {segs.map((s) => {
          const v = mix[s.k];
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
      <div className="mt-2 flex flex-wrap gap-3 text-[11px] opacity-70 mono">
        {segs
          .filter((s) => mix[s.k] > 0)
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
              {mix[s.k]} {s.k}
            </span>
          ))}
      </div>
    </>
  );
}

function SessionRow({ s }: { s: SessionMeta }) {
  return (
    <li className="nb-card-flat p-2">
      <Link
        to={`/sessions/${encodeURIComponent(s.sessionId)}`}
        className="flex items-start gap-3"
      >
        <span
          className="mt-1 inline-block h-2 w-2 rounded-full"
          style={{ background: outcomeColor(s.outcome) }}
        />
        <div className="flex-1 min-w-0">
          <div className="font-semibold truncate">
            {s.projectName}
            <span className="ml-2 mono dim text-[11px]">
              {formatDate(s.startedAt)}
            </span>
          </div>
          <div className="text-xs opacity-70 line-clamp-2">
            {s.briefSummary || s.goal}
          </div>
        </div>
        <div className="text-right">
          <div className="mono text-sm">
            {formatUsd(s.costUsd, { decimals: 1 })}
          </div>
          {s.wasteUsd > 0 && (
            <div className="mono text-[11px] warm">
              {formatUsd(s.wasteUsd, { decimals: 1 })} wasted
            </div>
          )}
        </div>
      </Link>
    </li>
  );
}

function outcomeColor(o: SessionMeta["outcome"]): string {
  switch (o) {
    case "fully":
      return "#1F7A3A";
    case "mostly":
      return "#86c5a3";
    case "partial":
      return "#FFB54E";
    case "none":
      return "#B23A1F";
    default:
      return "#888";
  }
}
