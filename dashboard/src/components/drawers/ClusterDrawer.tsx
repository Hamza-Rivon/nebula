import type { Cluster, Dataset } from "../../types";
import Avatar from "../Avatar";
import Clamp from "../Clamp";
import { formatDate, redactPrompt, titleCase } from "../../format";
import { suggestedAction } from "../../derive";

interface Props {
  cluster: Cluster;
  data: Dataset;
  onOpenSession?: (s: Dataset["sessions"][number]) => void;
  onOpenUser?: (id: string) => void;
}

export default function ClusterDrawer({
  cluster,
  data,
  onOpenSession,
  onOpenUser,
}: Props) {
  const memberSet = new Set(cluster.members);
  const memberSessions = data.sessions.filter((s) => memberSet.has(s.sessionId));
  const userIds = new Set(memberSessions.map((s) => s.userId));
  const affected = data.users.filter((u) => userIds.has(u.id));

  const severityColor =
    cluster.severity > 0.66
      ? "var(--warm)"
      : cluster.severity > 0.33
        ? "var(--warn)"
        : "var(--cool)";

  return (
    <>
      <div>
        <div
          style={{
            display: "flex",
            gap: 8,
            alignItems: "center",
            marginBottom: 6,
          }}
        >
          <span className="tag">{cluster.type}</span>
          <span className="tag">{cluster.domain}</span>
          <span className="tag mono">
            {cluster.sessionCount} sess · {cluster.userCount} consultants
          </span>
        </div>
        <div
          className="dim"
          style={{ fontSize: 13, marginTop: 8, lineHeight: 1.55 }}
        >
          {cluster.label}
        </div>
      </div>

      <div>
        <h3 className="section-h">Severity</h3>
        <div className="severity-meter">
          <div className="severity-track">
            <div
              className="severity-fill"
              style={{
                width: `${cluster.severity * 100}%`,
                background: severityColor,
              }}
            />
          </div>
          <div className="severity-num">{cluster.severity.toFixed(2)}</div>
        </div>
        {cluster.topFrictions.length > 0 && (
          <div
            style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 12 }}
          >
            {cluster.topFrictions.map((f) => (
              <span key={f} className="tag" style={{ color: "var(--warm)", borderColor: "#e8c8b8" }}>
                {titleCase(f)}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="suggested-action">
        <div className="eyebrow">Suggested action</div>
        <div className="action-text">{suggestedAction(cluster)}</div>
      </div>

      {affected.length > 0 && (
        <div>
          <h3 className="section-h">Affected consultants</h3>
          <div className="avatar-row">
            {affected.map((u) => (
              <button
                type="button"
                key={u.id}
                className="pill"
                onClick={() => onOpenUser?.(u.id)}
              >
                <Avatar seed={u.avatarSeed} size={22} />
                <span>{u.displayName}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div>
        <h3 className="section-h">
          Member sessions
          <span className="dim mono" style={{ marginLeft: 8, fontSize: 11 }}>
            {memberSessions.length}
          </span>
        </h3>
        {memberSessions.slice(0, 12).map((s) => {
          const matchingItems =
            cluster.type === "ask"
              ? s.asks.filter((a) => a.clusterId === cluster.id)
              : s.unresolved.filter((u) => u.clusterId === cluster.id);
          const text =
            matchingItems.length > 0
              ? cluster.type === "ask"
                ? (matchingItems[0] as { text?: string }).text ?? ""
                : (matchingItems[0] as { framing?: string; topic?: string })
                    .framing ??
                  (matchingItems[0] as { topic?: string }).topic ??
                  ""
              : s.firstPrompt;

          return (
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
                  <span
                    className="dim mono"
                    style={{ marginLeft: 10, fontSize: 11.5 }}
                  >
                    {formatDate(s.startedAt)}
                  </span>
                </div>
                <div
                  className="redacted-prompt"
                  style={{ marginTop: 6, fontSize: 12 }}
                >
                  <Clamp text={redactPrompt(text, 1200)} lines={3} />
                </div>
              </div>
            </div>
          );
        })}
        {memberSessions.length > 12 && (
          <div
            className="dim"
            style={{ fontSize: 11.5, marginTop: 10, textAlign: "center" }}
          >
            + {memberSessions.length - 12} more sessions
          </div>
        )}
      </div>
    </>
  );
}
