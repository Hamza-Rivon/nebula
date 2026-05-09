import { useMemo, useState } from "react";
import type { Dataset, SessionMeta } from "../types";
import Avatar from "../components/Avatar";
import {
  formatDateTime,
  formatInt,
  formatUsd,
  truncate,
} from "../format";

type SortKey =
  | "startedAt"
  | "consultant"
  | "project"
  | "outcome"
  | "tokens"
  | "cost"
  | "waste";
type SortDir = "asc" | "desc";

const OUTCOME_ORDER: Record<string, number> = {
  fully: 4,
  mostly: 3,
  partial: 2,
  unclear: 1,
  none: 0,
};

interface Props {
  data: Dataset;
  onOpenSession: (s: SessionMeta) => void;
}

export default function SessionsPage({ data, onOpenSession }: Props) {
  const [query, setQuery] = useState("");
  const [outcomeFilter, setOutcomeFilter] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("startedAt");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const userById = useMemo(() => {
    const m = new Map<string, Dataset["users"][number]>();
    for (const u of data.users) m.set(u.id, u);
    return m;
  }, [data.users]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return data.sessions.filter((s) => {
      if (outcomeFilter && s.outcome !== outcomeFilter) return false;
      if (!q) return true;
      const u = userById.get(s.userId);
      const hay = [
        s.projectName,
        s.goal,
        s.briefSummary,
        s.firstPrompt,
        u?.displayName ?? "",
        u?.team ?? "",
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [data.sessions, query, outcomeFilter, userById]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "startedAt":
          cmp = a.startedAt.localeCompare(b.startedAt);
          break;
        case "consultant": {
          const an = userById.get(a.userId)?.displayName ?? "";
          const bn = userById.get(b.userId)?.displayName ?? "";
          cmp = an.localeCompare(bn);
          break;
        }
        case "project":
          cmp = a.projectName.localeCompare(b.projectName);
          break;
        case "outcome":
          cmp =
            (OUTCOME_ORDER[a.outcome] ?? 0) - (OUTCOME_ORDER[b.outcome] ?? 0);
          break;
        case "tokens":
          cmp = a.tokens.input + a.tokens.output - (b.tokens.input + b.tokens.output);
          break;
        case "cost":
          cmp = a.costUsd - b.costUsd;
          break;
        case "waste":
          cmp = a.wasteUsd - b.wasteUsd;
          break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [filtered, sortKey, sortDir, userById]);

  const setSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir(key === "startedAt" ? "desc" : "desc");
    }
  };

  const arrow = (key: SortKey) =>
    key === sortKey ? (
      <span className="sort-arrow">{sortDir === "asc" ? "↑" : "↓"}</span>
    ) : null;

  const outcomeChips: { key: string | null; label: string }[] = [
    { key: null, label: "All" },
    { key: "fully", label: "Fully" },
    { key: "mostly", label: "Mostly" },
    { key: "partial", label: "Partial" },
    { key: "none", label: "None" },
    { key: "unclear", label: "Unclear" },
  ];

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="page-eyebrow">Observability</div>
          <h1 className="page-title">Sessions</h1>
          <p className="page-subtitle">
            Every Claude Code session captured by the proxy. Click a row to inspect
            the goal, asks, friction, and waste flags.
          </p>
        </div>
        <div className="daterange">
          <span className="daterange-dot" />
          <span>{sorted.length} of {data.sessions.length} sessions</span>
        </div>
      </div>

      <div className="sessions-toolbar">
        <div className="sessions-search">
          <SearchIcon />
          <input
            type="text"
            placeholder="Search consultant, project, goal…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {outcomeChips.map((c) => (
            <button
              key={c.label}
              className={`filter-chip ${outcomeFilter === c.key ? "active" : ""}`}
              onClick={() => setOutcomeFilter(c.key)}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      <div className="sessions-table-wrap">
        {sorted.length === 0 ? (
          <div className="session-empty">No sessions match the current filter.</div>
        ) : (
          <table className="sessions-table">
            <thead>
              <tr>
                <th onClick={() => setSort("startedAt")}>
                  Date {arrow("startedAt")}
                </th>
                <th onClick={() => setSort("consultant")}>
                  Consultant {arrow("consultant")}
                </th>
                <th onClick={() => setSort("project")}>
                  Project {arrow("project")}
                </th>
                <th>Goal</th>
                <th onClick={() => setSort("outcome")}>
                  Outcome {arrow("outcome")}
                </th>
                <th className="right" onClick={() => setSort("tokens")}>
                  Tokens {arrow("tokens")}
                </th>
                <th className="right" onClick={() => setSort("cost")}>
                  Cost {arrow("cost")}
                </th>
                <th className="right" onClick={() => setSort("waste")}>
                  Waste {arrow("waste")}
                </th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((s) => {
                const u = userById.get(s.userId);
                const totalTok = s.tokens.input + s.tokens.output;
                return (
                  <tr key={s.sessionId} onClick={() => onOpenSession(s)}>
                    <td className="mono">{formatDateTime(s.startedAt)}</td>
                    <td>
                      <div className="cell-consultant">
                        {u && <Avatar seed={u.avatarSeed} size={24} />}
                        <span>{u?.displayName ?? s.userId}</span>
                      </div>
                    </td>
                    <td>
                      <span className="cell-truncate" style={{ display: "inline-block" }}>
                        {s.projectName}
                      </span>
                    </td>
                    <td>
                      <span
                        className="cell-truncate"
                        style={{ display: "inline-block", color: "var(--ink-2)" }}
                        title={s.goal}
                      >
                        {truncate(s.goal || s.briefSummary || "—", 70)}
                      </span>
                    </td>
                    <td>
                      <span className={`outcome-pill ${s.outcome}`}>
                        <span className="outcome-dot" />
                        {s.outcome}
                      </span>
                    </td>
                    <td className="right mono" style={{ color: "var(--ink-2)" }}>
                      {formatInt(totalTok)}
                    </td>
                    <td className="right mono">
                      {formatUsd(s.costUsd, { decimals: 0 })}
                    </td>
                    <td
                      className="right mono"
                      style={{
                        color:
                          s.wasteUsd > 0 ? "var(--warm)" : "var(--ink-3)",
                      }}
                    >
                      {s.wasteUsd > 0 ? formatUsd(s.wasteUsd, { decimals: 0 }) : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function SearchIcon() {
  return (
    <svg
      className="sessions-search-icon"
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
    >
      <circle cx="6" cy="6" r="4" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M9.5 9.5L12 12"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}
