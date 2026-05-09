import { useState, type FormEvent } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";

const NAV: { to: string; label: string; color: string }[] = [
  { to: "/overview",  label: "Overview",  color: "var(--color-butter)"   },
  { to: "/sessions",  label: "Sessions",  color: "var(--color-mint)"     },
  { to: "/requests",  label: "Requests",  color: "var(--color-peach)"    },
  { to: "/tools",     label: "Tools",     color: "var(--color-rose)"     },
  { to: "/users",     label: "Users",     color: "var(--color-lime)"     },
  { to: "/providers", label: "Providers", color: "var(--color-lavender)" },
];

export function Layout() {
  const loc = useLocation();
  const navigate = useNavigate();
  const [q, setQ] = useState("");

  const onSearch = (e: FormEvent) => {
    e.preventDefault();
    const term = q.trim();
    if (!term) return;
    navigate(`/search?q=${encodeURIComponent(term)}`);
  };

  return (
    <div className="min-h-full">
      <header className="px-6 pt-6">
        <div className="nb-card flex flex-wrap items-center gap-4 px-5 py-3">
          <Logo />
          <div className="leading-tight">
            <div className="font-display text-xl font-bold tracking-tight">Nebula</div>
            <div className="text-xs opacity-60">LLM gateway · session intelligence</div>
          </div>
          <nav className="ml-2 flex flex-wrap gap-2">
            {NAV.map((n) => {
              const active = loc.pathname.startsWith(n.to);
              return (
                <NavLink
                  key={n.to}
                  to={n.to}
                  className="nb-chip"
                  style={{
                    background: active ? n.color : "#fff",
                    transform: active ? "translate(-1px,-1px)" : "none",
                    boxShadow: active ? "3px 3px 0 0 var(--color-ink)" : "none",
                  }}
                >
                  {n.label}
                </NavLink>
              );
            })}
          </nav>
          <form
            onSubmit={onSearch}
            className="ml-auto flex items-center gap-2"
          >
            <input
              className="nb-input"
              style={{ width: 220, padding: ".4rem .7rem", fontSize: ".85rem" }}
              placeholder="search prompts, tools…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <span className="nb-chip" style={{ background: "var(--color-mint)" }}>
              <span className="inline-block h-2 w-2 rounded-full bg-[var(--color-ok)] nb-pulse" />
              proxy live
            </span>
          </form>
        </div>
      </header>
      <main className="p-6">
        <Outlet />
      </main>
    </div>
  );
}

function Logo() {
  return (
    <div
      className="nb-card-flat grid h-12 w-12 place-items-center"
      style={{ background: "var(--color-lavender)" }}
      aria-hidden
    >
      <svg viewBox="0 0 32 32" width="28" height="28">
        <circle cx="16" cy="16" r="6" fill="#111" />
        <circle cx="24" cy="9"  r="2" fill="#111" />
        <circle cx="9"  cy="22" r="1.4" fill="#111" />
        <path d="M4 16 a12 12 0 0 1 24 0" stroke="#111" strokeWidth="2" fill="none" />
      </svg>
    </div>
  );
}
