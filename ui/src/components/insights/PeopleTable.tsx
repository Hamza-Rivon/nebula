import { useMemo, useState } from "react";
import type {
  Dataset,
  Persona,
  SessionMeta,
  User,
} from "../../insights/types";
import { formatUsd } from "../../insights/format";
import { Avatar } from "./Avatar";
import { Sparkline } from "../Sparkline";

interface Props {
  data: Dataset;
  selectedUserId: string | null;
  onSelectUser: (id: string) => void;
  onOpenUser: (id: string) => void;
}

type SortKey =
  | "persona"
  | "name"
  | "trend"
  | "winRate"
  | "spend"
  | "waste"
  | "costPerWin";

const PERSONA_RANK: Record<Persona, number> = {
  power: 0,
  active: 1,
  stuck: 2,
  misuser: 3,
  lurker: 4,
};

const PERSONA_LABEL: Record<Persona, string> = {
  power: "Power user",
  active: "Active",
  stuck: "Stuck",
  misuser: "Misuser",
  lurker: "Lurker",
};

export function PeopleTable({
  data,
  selectedUserId,
  onSelectUser,
  onOpenUser,
}: Props) {
  const [sortKey, setSortKey] = useState<SortKey>("persona");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const trendByUser = useMemo(() => {
    const byUser = new Map<string, SessionMeta[]>();
    for (const s of data.sessions) {
      const arr = byUser.get(s.userId) ?? [];
      arr.push(s);
      byUser.set(s.userId, arr);
    }
    const out = new Map<string, number[]>();
    const end = new Date(data.aggregates.dateRange.end).getTime();
    const start = new Date(data.aggregates.dateRange.start).getTime();
    const span = Math.max(1, end - start);
    const buckets = 8;
    for (const [uid, sess] of byUser) {
      const counts = new Array(buckets).fill(0);
      for (const s of sess) {
        const t = new Date(s.startedAt).getTime();
        const idx = Math.min(
          buckets - 1,
          Math.max(0, Math.floor(((t - start) / span) * buckets)),
        );
        counts[idx]++;
      }
      out.set(uid, counts);
    }
    return out;
  }, [data.sessions, data.aggregates.dateRange]);

  const rows = useMemo(() => {
    const rs = data.users.map((u) => ({
      user: u,
      trend: trendByUser.get(u.id) ?? [],
    }));
    rs.sort((a, b) => {
      const cmp = compare(sortKey, a.user, b.user);
      return sortDir === "asc" ? cmp : -cmp;
    });
    return rs;
  }, [data.users, trendByUser, sortKey, sortDir]);

  const handleSort = (k: SortKey) => {
    if (sortKey === k) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(k);
      setSortDir(k === "persona" || k === "name" ? "asc" : "desc");
    }
  };

  const arrow = (k: SortKey) =>
    sortKey === k ? (sortDir === "asc" ? "↑" : "↓") : "";

  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <div className="panel-sub">Q1 — Who to back, who to coach</div>
          <h3 className="panel-title">Engineers</h3>
        </div>
        <div className="panel-meta">
          {data.users.length} tracked · click a row to focus
        </div>
      </div>
      <div className="people-table-wrap">
        <table className="people-table">
          <thead>
            <tr>
              <th onClick={() => handleSort("persona")} className="sortable">
                Persona <span className="sort-arrow">{arrow("persona")}</span>
              </th>
              <th onClick={() => handleSort("name")} className="sortable">
                Engineer <span className="sort-arrow">{arrow("name")}</span>
              </th>
              <th onClick={() => handleSort("trend")} className="sortable">
                Sessions/wk <span className="sort-arrow">{arrow("trend")}</span>
              </th>
              <th onClick={() => handleSort("winRate")} className="sortable right">
                Win rate <span className="sort-arrow">{arrow("winRate")}</span>
              </th>
              <th onClick={() => handleSort("spend")} className="sortable right">
                Spend <span className="sort-arrow">{arrow("spend")}</span>
              </th>
              <th onClick={() => handleSort("waste")} className="sortable right">
                Waste <span className="sort-arrow">{arrow("waste")}</span>
              </th>
              <th onClick={() => handleSort("costPerWin")} className="sortable right">
                $/win <span className="sort-arrow">{arrow("costPerWin")}</span>
              </th>
              <th>Top friction</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ user, trend }) => {
              const isSel = user.id === selectedUserId;
              return (
                <tr
                  key={user.id}
                  className={isSel ? "selected" : ""}
                  onClick={() => onSelectUser(user.id)}
                  onDoubleClick={() => onOpenUser(user.id)}
                >
                  <td>
                    <PersonaChip persona={user.persona} />
                  </td>
                  <td>
                    <div className="consultant-cell">
                      <Avatar seed={user.avatarSeed} size={32} />
                      <div>
                        <div className="consultant-name">{user.displayName}</div>
                        <div className="consultant-meta">
                          {user.team} · {user.sessionCount} sess
                        </div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <div className="trend-cell">
                      <Sparkline values={trend} width={80} height={22} />
                      <span className="mono dim-2" style={{ fontSize: 11 }}>
                        {user.sessionsLast7d}/wk
                      </span>
                    </div>
                  </td>
                  <td className="right mono">
                    <span
                      className={
                        user.winRate >= 0.6
                          ? "tnum positive"
                          : user.winRate < 0.35
                            ? "tnum warm"
                            : "tnum"
                      }
                    >
                      {Math.round(user.winRate * 100)}%
                    </span>
                  </td>
                  <td className="right mono">
                    {formatUsd(user.totalCostUsd, { decimals: 0 })}
                  </td>
                  <td className="right mono">
                    {user.totalWasteUsd > 0 ? (
                      <span className="warm">
                        {formatUsd(user.totalWasteUsd, { decimals: 0 })}
                      </span>
                    ) : (
                      <span className="dim-2">—</span>
                    )}
                  </td>
                  <td className="right mono">
                    {user.costPerWin > 0 && isFinite(user.costPerWin) ? (
                      formatUsd(user.costPerWin, { decimals: 0 })
                    ) : (
                      <span className="dim-2">—</span>
                    )}
                  </td>
                  <td className="friction-cell">
                    <span className="dim">{user.topFrictionLabel}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function compare(k: SortKey, a: User, b: User): number {
  switch (k) {
    case "persona":
      return PERSONA_RANK[a.persona] - PERSONA_RANK[b.persona];
    case "name":
      return a.displayName.localeCompare(b.displayName);
    case "trend":
      return a.sessionsLast7d - b.sessionsLast7d;
    case "winRate":
      return a.winRate - b.winRate;
    case "spend":
      return a.totalCostUsd - b.totalCostUsd;
    case "waste":
      return a.totalWasteUsd - b.totalWasteUsd;
    case "costPerWin":
      return a.costPerWin - b.costPerWin;
  }
}

function PersonaChip({ persona }: { persona: Persona }) {
  return (
    <span className={`persona-chip persona-${persona}`}>
      <span className="persona-dot" />
      {PERSONA_LABEL[persona]}
    </span>
  );
}
