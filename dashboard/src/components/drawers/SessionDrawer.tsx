import type { Cluster, Dataset, SessionMeta } from "../../types";
import Avatar from "../Avatar";
import Clamp from "../Clamp";
import {
  formatDateTime,
  formatInt,
  formatUsd,
  redactPrompt,
  titleCase,
  wasteTypeLabel,
} from "../../format";

interface Props {
  session: SessionMeta;
  data: Dataset;
  onOpenUser?: (id: string) => void;
  onOpenCluster?: (c: Cluster) => void;
  onOpenTranscript?: (s: SessionMeta) => void;
}

export default function SessionDrawer({
  session: s,
  data,
  onOpenUser,
  onOpenCluster,
  onOpenTranscript,
}: Props) {
  const user = data.users.find((u) => u.id === s.userId);
  const clustersById = new Map(data.clusters.map((c) => [c.id, c]));
  const linkedClusters: Cluster[] = [];
  const seen = new Set<string>();
  for (const a of s.asks) {
    if (a.clusterId && !seen.has(a.clusterId)) {
      const c = clustersById.get(a.clusterId);
      if (c) {
        linkedClusters.push(c);
        seen.add(a.clusterId);
      }
    }
  }
  for (const u of s.unresolved) {
    if (u.clusterId && !seen.has(u.clusterId)) {
      const c = clustersById.get(u.clusterId);
      if (c) {
        linkedClusters.push(c);
        seen.add(u.clusterId);
      }
    }
  }

  return (
    <>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 8,
          alignItems: "center",
        }}
      >
        {user && onOpenUser && (
          <button
            type="button"
            className="backlink"
            onClick={() => onOpenUser(user.id)}
          >
            <Avatar seed={user.avatarSeed} size={20} />
            <span>{user.displayName}</span>
            <span className="dim mono" style={{ fontSize: 11 }}>
              {user.team}
            </span>
            <span className="backlink-arrow">→</span>
          </button>
        )}
        {onOpenTranscript && (
          <button
            type="button"
            className="btn-link"
            style={{ marginTop: 0 }}
            onClick={() => onOpenTranscript(s)}
          >
            View full session
            <span className="backlink-arrow">→</span>
          </button>
        )}
      </div>

      <div className="stat-grid">
        <Stat label="Cost" value={formatUsd(s.costUsd, { decimals: 1 })} />
        <Stat
          label="Waste"
          value={
            s.wasteUsd > 0 ? formatUsd(s.wasteUsd, { decimals: 1 }) : "—"
          }
          tone={s.wasteUsd > 0 ? "warn" : undefined}
        />
        <Stat label="Duration" value={`${s.durationMinutes}m`} />
        <Stat label="Wizard" value={s.wizardScore.toFixed(2)} />
      </div>

      <dl className="kv">
        <dt>Project</dt>
        <dd>{s.projectName}</dd>
        <dt>Started</dt>
        <dd className="mono">{formatDateTime(s.startedAt)}</dd>
        <dt>Outcome</dt>
        <dd>
          <span className={`outcome-pill ${s.outcome}`}>
            <span className="outcome-dot" />
            {s.outcome}
          </span>
        </dd>
        <dt>Type</dt>
        <dd>{titleCase(s.sessionType)}</dd>
        <dt>Lines</dt>
        <dd className="mono">
          +{formatInt(s.linesAdded)} / -{formatInt(s.linesRemoved)} ·{" "}
          {s.filesModified} files
        </dd>
      </dl>

      {s.firstPrompt && (
        <div>
          <h3 className="section-h">First prompt</h3>
          <div className="redacted-prompt">
            <Clamp text={redactPrompt(s.firstPrompt, 2000)} lines={4} />
          </div>
        </div>
      )}

      {s.briefSummary && (
        <div>
          <h3 className="section-h">Summary</h3>
          <div style={{ fontSize: 13.5, color: "var(--ink-2)", lineHeight: 1.55 }}>
            <Clamp text={s.briefSummary} lines={3} />
          </div>
        </div>
      )}

      {linkedClusters.length > 0 && onOpenCluster && (
        <div>
          <h3 className="section-h">Linked clusters</h3>
          <div style={{ display: "flex", flexWrap: "wrap" }}>
            {linkedClusters.map((c) => (
              <button
                type="button"
                key={c.id}
                className={`cluster-pill ${c.type}`}
                onClick={() => onOpenCluster(c)}
                title={`${c.type === "ask" ? "Demand" : "Gap"} cluster`}
              >
                <span className="dot" />
                <span>{c.label}</span>
                <span className="backlink-arrow">→</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {s.wasteFlags.length > 0 && (
        <div>
          <h3 className="section-h">Waste flags</h3>
          {s.wasteFlags.map((f, i) => (
            <div key={i} className="session-row" style={{ cursor: "default" }}>
              <span className="outcome-dot none" />
              <div>
                <div className="session-title">{wasteTypeLabel(f.type)}</div>
                {f.evidence && (
                  <div className="session-meta">{f.evidence}</div>
                )}
              </div>
              <div className="session-amt" style={{ color: "var(--warm)" }}>
                {formatUsd(f.usdWasted, { decimals: 1 })}
              </div>
            </div>
          ))}
        </div>
      )}

      {s.friction.length > 0 && (
        <div>
          <h3 className="section-h">Friction</h3>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {s.friction.map((f) => (
              <span
                key={f}
                className="tag"
                style={{ color: "var(--warm)", borderColor: "#e8c8b8" }}
              >
                {titleCase(f)}
              </span>
            ))}
          </div>
        </div>
      )}
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
