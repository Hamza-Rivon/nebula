import { useEffect, useRef, useState, type FormEvent } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { insightsApi } from "../insights/api";
import type { Job } from "../insights/types";

type NavItem = { to: string; label: string; section: "manager" | "engineer" };

const NAV: NavItem[] = [
  { to: "/insights",  label: "Insights",  section: "manager" },
  { to: "/sessions",  label: "Sessions",  section: "engineer" },
  { to: "/requests",  label: "Requests",  section: "engineer" },
  { to: "/tools",     label: "Tools",     section: "engineer" },
  { to: "/users",     label: "Users",     section: "engineer" },
  { to: "/providers", label: "Providers", section: "engineer" },
];

export function Layout() {
  const navigate = useNavigate();
  const loc = useLocation();
  const [q, setQ] = useState("");
  const [job, setJob] = useState<Job | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const pollRef = useRef<number | null>(null);

  const onSearch = (e: FormEvent) => {
    e.preventDefault();
    const term = q.trim();
    if (!term) return;
    navigate(`/search?q=${encodeURIComponent(term)}`);
  };

  // Poll active job until done.
  useEffect(() => {
    if (!job || job.status === "done" || job.status === "error") return;
    const tick = async () => {
      try {
        const j = await insightsApi.getJob(job.id);
        setJob(j);
        if (j.status === "done" || j.status === "error") {
          setAnalyzing(false);
        }
      } catch {
        /* keep trying */
      }
    };
    pollRef.current = window.setInterval(tick, 1500);
    return () => {
      if (pollRef.current != null) clearInterval(pollRef.current);
    };
  }, [job]);

  const onAnalyze = async () => {
    if (analyzing) return;
    setAnalyzing(true);
    try {
      const j = await insightsApi.postAnalyze({ all: true });
      setJob(j);
    } catch (e) {
      setAnalyzing(false);
      alert(`Failed to start analyze: ${String(e)}`);
    }
  };

  const manager = NAV.filter((n) => n.section === "manager");
  const engineer = NAV.filter((n) => n.section === "engineer");

  return (
    <div className="sidebar-app">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <Logo />
          <div className="leading-tight">
            <div className="font-display text-lg font-bold tracking-tight">
              Nebula
            </div>
            <div className="text-[11px] opacity-60">session intel</div>
          </div>
        </div>

        <div className="sidebar-section-label">Manager</div>
        <nav className="sidebar-nav">
          {manager.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              className={({ isActive }) =>
                `sidebar-link ${isActive || loc.pathname.startsWith(n.to) ? "active" : ""}`
              }
            >
              <span className="sidebar-link-bullet" />
              {n.label}
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-section-label">Engineer</div>
        <nav className="sidebar-nav">
          {engineer.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              className={({ isActive }) =>
                `sidebar-link ${isActive || loc.pathname.startsWith(n.to) ? "active" : ""}`
              }
            >
              <span className="sidebar-link-bullet" />
              {n.label}
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-footer">
          <form onSubmit={onSearch}>
            <input
              className="nb-input"
              style={{ padding: ".4rem .7rem", fontSize: ".85rem" }}
              placeholder="search prompts, tools…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </form>

          <button
            className="nb-btn"
            disabled={analyzing}
            onClick={onAnalyze}
            style={{ width: "100%", justifyContent: "center" }}
          >
            {analyzing ? "Analyzing…" : "Re-analyze"}
          </button>

          {job && (
            <div className="nb-card-flat px-2 py-1.5 text-xs">
              <div className="flex items-center gap-2">
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{
                    background:
                      job.status === "done"
                        ? "var(--color-ok)"
                        : job.status === "error"
                          ? "var(--color-err)"
                          : "var(--color-warn)",
                  }}
                />
                <span className="font-mono uppercase">{job.status}</span>
                {job.stage && (
                  <span className="ml-auto opacity-70 truncate">{job.stage}</span>
                )}
              </div>
              {job.total != null && job.done != null && (
                <div className="mt-1 h-1.5 w-full border border-[var(--color-ink)] bg-white">
                  <div
                    style={{
                      width: `${Math.min(100, Math.round(((job.done ?? 0) / Math.max(1, job.total)) * 100))}%`,
                      height: "100%",
                      background: "var(--color-mint)",
                    }}
                  />
                </div>
              )}
              {job.error && (
                <div className="mt-1 warm" style={{ fontSize: 11 }}>
                  {job.error}
                </div>
              )}
            </div>
          )}

          <span
            className="nb-chip self-start"
            style={{ background: "var(--color-mint)", fontSize: ".68rem" }}
          >
            <span className="inline-block h-2 w-2 rounded-full bg-[var(--color-ok)] nb-pulse" />
            proxy live
          </span>
        </div>
      </aside>

      <main className="p-6">
        <Outlet />
      </main>
    </div>
  );
}

function Logo() {
  return (
    <div
      className="nb-card-flat grid h-10 w-10 place-items-center"
      style={{ background: "var(--color-lavender)" }}
      aria-hidden
    >
      <svg viewBox="0 0 32 32" width="22" height="22">
        <circle cx="16" cy="16" r="6" fill="#111" />
        <circle cx="24" cy="9" r="2" fill="#111" />
        <circle cx="9" cy="22" r="1.4" fill="#111" />
        <path
          d="M4 16 a12 12 0 0 1 24 0"
          stroke="#111"
          strokeWidth="2"
          fill="none"
        />
      </svg>
    </div>
  );
}
