import { useMemo } from "react";
import type { Dataset, User } from "../types";
import Avatar from "./Avatar";
import Sparkline from "./Sparkline";
import WizardRadar from "./WizardRadar";
import { formatUsd } from "../format";
import { deriveRadar, userSparkline } from "../derive";

interface Props {
  data: Dataset;
  selectedUserId: string | null;
  onSelectUser: (id: string) => void;
  onOpenUser: (id: string) => void;
}

export default function Leaderboard({
  data,
  selectedUserId,
  onSelectUser,
  onOpenUser,
}: Props) {
  const ranked = useMemo(() => {
    return [...data.users].sort((a, b) => b.wizardScore - a.wizardScore);
  }, [data.users]);

  const selected = useMemo<User | undefined>(() => {
    return ranked.find((u) => u.id === selectedUserId) ?? ranked[0];
  }, [ranked, selectedUserId]);

  return (
    <section className="panel leaderboard">
      <div className="panel-header">
        <div>
          <div className="panel-sub">Q1 — Who to back</div>
          <h3 className="panel-title">Consultant leaderboard</h3>
        </div>
        <div className="panel-meta">Wizard score · last 30 days</div>
      </div>
      <div className="panel-body">
        <table className="leader-table">
          <thead>
            <tr>
              <th>Consultant</th>
              <th className="right">Score</th>
              <th>Trend</th>
              <th className="right">Waste</th>
            </tr>
          </thead>
          <tbody>
            {ranked.map((u, i) => {
              const spark = userSparkline(u, data.sessions).map((p) => p.score);
              const isSel = (selected?.id ?? null) === u.id;
              const w = Math.round(
                Math.max(0, Math.min(1, u.wizardScore)) * 100,
              );
              return (
                <tr
                  key={u.id}
                  className={isSel ? "selected" : ""}
                  onClick={(e) => {
                    onSelectUser(u.id);
                    if (e.detail >= 2 || e.shiftKey) onOpenUser(u.id);
                  }}
                  onDoubleClick={() => onOpenUser(u.id)}
                  title="Click to select · double-click for full profile"
                >
                  <td>
                    <div className="consultant-cell">
                      <Avatar seed={u.avatarSeed} size={36} />
                      <div>
                        <div className="consultant-name">{u.displayName}</div>
                        <div className="consultant-meta">
                          {u.team.toLowerCase()} · #{i + 1} · {u.sessionCount} sess
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="right">
                    <div className="score-block">
                      <span className="score-num">{u.wizardScore.toFixed(2)}</span>
                      <div
                        className="score-bar"
                        style={
                          {
                            "--w": `${w}%`,
                          } as React.CSSProperties
                        }
                      />
                    </div>
                  </td>
                  <td>
                    <Sparkline
                      values={spark}
                      domain={[0, 1]}
                      stroke="#2D5F8E"
                      width={88}
                      height={22}
                    />
                  </td>
                  <td className="right">
                    <span
                      className={`waste-figure ${u.totalWasteUsd > 0 ? "" : "dim-empty"}`}
                    >
                      {u.totalWasteUsd > 0
                        ? formatUsd(u.totalWasteUsd, { decimals: 0 })
                        : "—"}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {selected && (
          <div className="signature">
            <WizardRadar user={selected} sessions={data.sessions} size={220} />
            <div className="signature-meta">
              <div className="eyebrow">Wizard signature</div>
              <h3>{selected.displayName}</h3>
              <div className="dim" style={{ fontSize: 12.5 }}>
                {selected.team}
              </div>
              <SignatureAxes user={selected} sessions={data.sessions} />
              <button
                className="btn-link"
                onClick={() => onOpenUser(selected.id)}
              >
                Open full profile
                <span aria-hidden style={{ color: "var(--ink-3)" }}>→</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function SignatureAxes({
  user,
  sessions,
}: {
  user: User;
  sessions: Dataset["sessions"];
}) {
  const r = deriveRadar(user, sessions);
  const rows: [string, number][] = [
    ["Throughput", r.throughput],
    ["First-shot", r.firstShot],
    ["Cache hit", r.cacheHit],
    ["Edit precision", r.editEfficiency],
    ["Model IQ", r.modelIQ],
  ];
  return (
    <div className="signature-axes">
      {rows.map(([k, v]) => (
        <div className="axis-row" key={k}>
          <span>{k}</span>
          <span className="v">{v.toFixed(2)}</span>
        </div>
      ))}
    </div>
  );
}
