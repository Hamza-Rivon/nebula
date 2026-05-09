import { Link } from "react-router-dom";
import type { Cluster, Dataset } from "../../../insights/types";
import { formatUsd, truncate } from "../../../insights/format";

interface Props {
  cluster: Cluster;
  data: Dataset;
}

export function ClusterDrawer({ cluster, data }: Props) {
  const memberSet = new Set(cluster.members);
  const sessions = data.sessions.filter((s) => memberSet.has(s.sessionId));
  const usersById = new Map(data.users.map((u) => [u.id, u] as const));
  const involvedUserIds = Array.from(new Set(sessions.map((s) => s.userId)));

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-3 gap-2">
        <Stat label="Sessions" value={String(cluster.sessionCount)} />
        <Stat label="Engineers" value={String(cluster.userCount)} />
        <Stat
          label="Severity"
          value={cluster.severity.toFixed(2)}
          tone={cluster.severity > 0.6 ? "warn" : undefined}
        />
      </div>

      {cluster.topFrictions.length > 0 && (
        <div>
          <SectionTitle>Top frictions</SectionTitle>
          <div className="flex flex-wrap gap-1.5">
            {cluster.topFrictions.map((f) => (
              <span key={f} className="nb-tag" style={{ background: "var(--color-peach)" }}>
                {f.replace(/_/g, " ")}
              </span>
            ))}
          </div>
        </div>
      )}

      <div>
        <SectionTitle>Engineers in this cluster</SectionTitle>
        <div className="flex flex-wrap gap-2">
          {involvedUserIds.map((uid) => {
            const u = usersById.get(uid);
            if (!u) return null;
            return (
              <span key={uid} className="nb-chip">
                {u.displayName}
              </span>
            );
          })}
        </div>
      </div>

      <div>
        <SectionTitle>Member sessions</SectionTitle>
        <ul className="space-y-2">
          {sessions.slice(0, 12).map((s) => {
            const u = usersById.get(s.userId);
            return (
              <li key={s.sessionId} className="nb-card-flat p-2">
                <Link
                  to={`/sessions/${encodeURIComponent(s.sessionId)}`}
                  className="flex items-start gap-3"
                >
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold truncate">
                      {truncate(s.goal || s.projectName, 60)}
                    </div>
                    <div className="text-xs opacity-70">
                      {u?.displayName ?? "—"} ·{" "}
                      <span className="mono">{s.outcome}</span>
                    </div>
                  </div>
                  <div className="mono text-sm">
                    {formatUsd(s.costUsd, { decimals: 1 })}
                  </div>
                </Link>
              </li>
            );
          })}
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
  tone?: "warn";
}) {
  return (
    <div className="nb-card-flat p-2">
      <div className="text-[10px] font-bold uppercase tracking-widest opacity-60">
        {label}
      </div>
      <div className={`text-xl font-bold tabular-nums ${tone === "warn" ? "warm" : ""}`}>
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
