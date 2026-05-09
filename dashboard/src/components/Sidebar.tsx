import type { Dataset } from "../types";
import { formatDateRange } from "../format";

export type Page = "insights" | "sessions" | "lab";

interface Props {
  data: Dataset;
  page: Page;
  onNavigate: (p: Page) => void;
}

export default function Sidebar({ data, page, onNavigate }: Props) {
  const a = data.aggregates;
  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <div className="brand-mark">
          <svg width="26" height="26" viewBox="0 0 26 26" fill="none">
            <defs>
              <radialGradient id="nb-light" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="#C25A2C" />
                <stop offset="55%" stopColor="#2D5F8E" />
                <stop offset="100%" stopColor="#0E1116" />
              </radialGradient>
            </defs>
            <circle cx="13" cy="13" r="11" fill="url(#nb-light)" opacity="0.9" />
            <circle
              cx="13"
              cy="13"
              r="11.5"
              stroke="#cdc7b6"
              strokeWidth="0.5"
              fill="none"
            />
            <circle cx="9" cy="9" r="0.9" fill="#fff" opacity="0.85" />
            <circle cx="18" cy="11" r="0.6" fill="#fff" opacity="0.6" />
            <circle cx="14" cy="17" r="0.5" fill="#fff" opacity="0.5" />
          </svg>
        </div>
        <div>
          <div className="brand-name">Nebula</div>
          <div className="brand-sub">Capability Intel</div>
        </div>
      </div>

      <nav className="sidebar-section">
        <h4>Workspace</h4>
        <button
          className={`nav-item ${page === "insights" ? "active" : ""}`}
          onClick={() => onNavigate("insights")}
        >
          <InsightsIcon />
          <span>Insights</span>
        </button>
        <button
          className={`nav-item ${page === "sessions" ? "active" : ""}`}
          onClick={() => onNavigate("sessions")}
        >
          <SessionsIcon />
          <span>Sessions</span>
          <span className="nav-count">{a.totalSessions}</span>
        </button>
        <button
          className={`nav-item ${page === "lab" ? "active" : ""}`}
          onClick={() => onNavigate("lab")}
        >
          <LabIcon />
          <span>Lab</span>
          <span className="nav-count">12</span>
        </button>
      </nav>

      <dl className="sidebar-context">
        <dt>Firm</dt>
        <dd>Helix Strategy Group</dd>
        <dt>Partner</dt>
        <dd>M. Dubois</dd>
        <dt>Window</dt>
        <dd className="mono">
          {formatDateRange(a.dateRange.start, a.dateRange.end)}
        </dd>
        <dt>Coverage</dt>
        <dd className="mono">
          {a.totalUsers} consultants · {a.totalSessions} sessions
        </dd>
      </dl>

      <div className="sidebar-foot">v0.1 · prototype</div>
    </aside>
  );
}

function InsightsIcon() {
  return (
    <svg
      className="nav-icon"
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
    >
      <path
        d="M2 11V8M5.5 11V4M9 11V6.5M12 11V2"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

function LabIcon() {
  return (
    <svg
      className="nav-icon"
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
    >
      <path
        d="M5 2v3.2L2.4 11a1 1 0 0 0 .9 1.5h7.4a1 1 0 0 0 .9-1.5L9 5.2V2M4 2h6"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SessionsIcon() {
  return (
    <svg
      className="nav-icon"
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
    >
      <path
        d="M2 3.5h10M2 7h10M2 10.5h6"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}
