import { useMemo, useState } from "react";
import type { Dataset, SessionMeta } from "../../insights/types";
import { buildTeams, type TeamSummary } from "../../insights/teams";
import { formatUsd } from "../../insights/format";
import { Sparkline } from "../Sparkline";

interface Props {
  data: Dataset;
  onOpenTeam: (id: string) => void;
}

type SortKey =
  | "name"
  | "headcount"
  | "trend"
  | "winRate"
  | "spend"
  | "waste"
  | "costPerWin";

export function TeamsTable({ data, onOpenTeam }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>("spend");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const teams = useMemo(() => buildTeams(data), [data]);

  const trendByTeam = useMemo(() => {
    const teamByUser = new Map<string, string>();
    for (const u of data.users) teamByUser.set(u.id, u.team);
    const byTeam = new Map<string, SessionMeta[]>();
    for (const s of data.sessions) {
      const t = teamByUser.get(s.userId);
      if (!t) continue;
      const arr = byTeam.get(t) ?? [];
      arr.push(s);
      byTeam.set(t, arr);
    }
    const out = new Map<string, number[]>();
    const end = new Date(data.aggregates.dateRange.end).getTime();
    const start = new Date(data.aggregates.dateRange.start).getTime();
    const span = Math.max(1, end - start);
    const buckets = 8;
    for (const [team, sess] of byTeam) {
      const counts = new Array(buckets).fill(0);
      for (const s of sess) {
        const t = new Date(s.startedAt).getTime();
        const idx = Math.min(
          buckets - 1,
          Math.max(0, Math.floor(((t - start) / span) * buckets)),
        );
        counts[idx]++;
      }
      out.set(team, counts);
    }
    return out;
  }, [data.sessions, data.users, data.aggregates.dateRange]);

  const rows = useMemo(() => {
    const rs = teams.map((t) => ({
      team: t,
      trend: trendByTeam.get(t.id) ?? [],
    }));
    rs.sort((a, b) => {
      const cmp = compare(sortKey, a.team, b.team);
      return sortDir === "asc" ? cmp : -cmp;
    });
    return rs;
  }, [teams, trendByTeam, sortKey, sortDir]);

  const handleSort = (k: SortKey) => {
    if (sortKey === k) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(k);
      setSortDir(k === "name" ? "asc" : "desc");
    }
  };

  const arrow = (k: SortKey) =>
    sortKey === k ? (sortDir === "asc" ? "↑" : "↓") : "";

  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <div className="panel-sub">Q1 — Which teams are converting AI into outcomes</div>
          <h3 className="panel-title">Teams</h3>
        </div>
        <div className="panel-meta">
          {teams.length} teams · click a row to focus
        </div>
      </div>
      <div className="people-table-wrap">
        <table className="people-table">
          <thead>
            <tr>
              <th onClick={() => handleSort("name")} className="sortable">
                Team <span className="sort-arrow">{arrow("name")}</span>
              </th>
              <th onClick={() => handleSort("headcount")} className="sortable right">
                Headcount <span className="sort-arrow">{arrow("headcount")}</span>
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
            {rows.map(({ team, trend }) => (
              <tr key={team.id} onClick={() => onOpenTeam(team.id)}>
                <td>
                  <div className="team-cell">
                    <span className="team-badge">{teamInitials(team.name)}</span>
                    <div>
                      <div className="consultant-name">{team.name}</div>
                      <div className="consultant-meta">
                        {team.sessionCount} sess · {Math.round(team.totalTokens / 1000).toLocaleString()}k tok
                      </div>
                    </div>
                  </div>
                </td>
                <td className="right mono">{team.memberCount}</td>
                <td>
                  <div className="trend-cell">
                    <Sparkline values={trend} width={80} height={22} />
                    <span className="mono dim-2" style={{ fontSize: 11 }}>
                      {team.sessionsLast7d}/wk
                    </span>
                  </div>
                </td>
                <td className="right mono">
                  <span
                    className={
                      team.winRate >= 0.6
                        ? "tnum positive"
                        : team.winRate < 0.35
                          ? "tnum warm"
                          : "tnum"
                    }
                  >
                    {Math.round(team.winRate * 100)}%
                  </span>
                </td>
                <td className="right mono">
                  {formatUsd(team.totalCostUsd, { decimals: 0 })}
                </td>
                <td className="right mono">
                  {team.totalWasteUsd > 0 ? (
                    <span className="warm">
                      {formatUsd(team.totalWasteUsd, { decimals: 0 })}
                    </span>
                  ) : (
                    <span className="dim-2">—</span>
                  )}
                </td>
                <td className="right mono">
                  {team.costPerWin > 0 && isFinite(team.costPerWin) ? (
                    formatUsd(team.costPerWin, { decimals: 0 })
                  ) : (
                    <span className="dim-2">—</span>
                  )}
                </td>
                <td className="friction-cell">
                  <span className="dim">{team.topFrictionLabel}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function compare(k: SortKey, a: TeamSummary, b: TeamSummary): number {
  switch (k) {
    case "name":
      return a.name.localeCompare(b.name);
    case "headcount":
      return a.memberCount - b.memberCount;
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

function teamInitials(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "—";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0] + parts[1]![0]).toUpperCase();
}
