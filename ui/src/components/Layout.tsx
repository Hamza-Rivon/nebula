import { useEffect, useState, type FormEvent } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { insightsApi } from "../insights/api";
import type { Job } from "../insights/types";
import { prefetchTab, type TabPath } from "../prefetch";
import { useLiveBridge } from "../liveBridge";
import { qk } from "../queries";

type NavItem = { to: TabPath; label: string; section: "manager" | "engineer" };

const NAV: NavItem[] = [
  { to: "/insights", label: "Insights", section: "manager" },
  { to: "/sessions", label: "Sessions", section: "engineer" },
  { to: "/requests", label: "Requests", section: "engineer" },
  { to: "/tools",    label: "Tools",    section: "engineer" },
  { to: "/users",    label: "Users",    section: "engineer" },
  { to: "/jobs",     label: "Jobs",     section: "engineer" },
];

export function Layout() {
  const navigate = useNavigate();
  const loc = useLocation();
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [jobId, setJobId] = useState<string | null>(null);

  // Stream every SSE event into the React Query cache as an invalidation pulse.
  useLiveBridge();

  const onSearch = (e: FormEvent) => {
    e.preventDefault();
    const term = q.trim();
    if (!term) return;
    navigate(`/search?q=${encodeURIComponent(term)}`);
  };

  // Poll the active job until it terminates. React Query handles the polling
  // cadence + cancellation; we just toggle refetchInterval based on status.
  const jobQuery = useQuery<Job | null>({
    queryKey: ["jobs", jobId],
    queryFn: () => (jobId ? insightsApi.getJob(jobId) : Promise.resolve(null)),
    enabled: !!jobId,
    refetchInterval: (q) => {
      const j = q.state.data;
      if (!j) return false;
      if (j.status === "done" || j.status === "error") return false;
      return 1500;
    },
  });
  const job = jobQuery.data ?? null;
  const analyzing = !!job && job.status !== "done" && job.status !== "error";

  // When the analyze pass finishes, force the insights dataset to refetch.
  useEffect(() => {
    if (job?.status === "done") {
      qc.invalidateQueries({ queryKey: qk.insights.root });
    }
  }, [job?.status, qc]);

  // Sidebar no longer triggers analysis directly. The auto-drain toggle on
  // the Jobs page is the single control: when ON, every captured live
  // request auto-enqueues AND auto-runs in the background; when OFF, the
  // queue grows passively. The sidebar still surfaces the active job's
  // progress chip below.

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
          </div>
        </div>

        <div className="sidebar-section-label">Manager</div>
        <nav className="sidebar-nav">
          {manager.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              onMouseEnter={() => prefetchTab(n.to)}
              onFocus={() => prefetchTab(n.to)}
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
              onMouseEnter={() => prefetchTab(n.to)}
              onFocus={() => prefetchTab(n.to)}
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
            className="nb-chip"
            style={{
              background: "var(--color-mint)",
              fontSize: ".68rem",
              width: "100%",
              justifyContent: "center",
            }}
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
