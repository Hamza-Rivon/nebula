import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api, type SessionRow } from "../api";
import { EmptyState } from "../components/EmptyState";
import { fmt } from "../format";

const CURL_DEMO = `curl http://localhost:8080/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "x-nebula-session: demo-1" \\
  -d '{"model":"openai/gpt-4o-mini",
       "messages":[{"role":"user","content":"Hello, Nebula!"}]}'`;

export function SessionsPage() {
  const [rows, setRows] = useState<SessionRow[]>([]);
  const [total, setTotal] = useState(0);
  const [q, setQ] = useState("");
  const seen = useRef<Set<string>>(new Set());
  const [newIds, setNewIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    let alive = true;
    const tick = () =>
      api.sessions(100).then((r) => {
        if (!alive) return;
        if (seen.current.size > 0) {
          const fresh = new Set<string>();
          for (const s of r.sessions) {
            if (!seen.current.has(s.id)) fresh.add(s.id);
          }
          if (fresh.size) {
            setNewIds(fresh);
            setTimeout(() => alive && setNewIds(new Set()), 700);
          }
        }
        seen.current = new Set(r.sessions.map((x) => x.id));
        setRows(r.sessions);
        setTotal(r.total);
      });
    tick();
    const t = setInterval(tick, 4000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const filtered = rows.filter((r) =>
    !q ||
    r.id.toLowerCase().includes(q.toLowerCase()) ||
    (r.user_id ?? "").toLowerCase().includes(q.toLowerCase()),
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="font-display text-2xl font-bold">Sessions</h2>
        <span className="nb-chip" style={{ background: "var(--color-mint)" }}>
          {total} total
        </span>
        <input
          className="nb-input ml-auto max-w-xs"
          placeholder="filter by id or user…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      <div className="nb-card overflow-hidden">
        <table className="nb-table">
          <thead>
            <tr>
              <th>Session</th>
              <th>User</th>
              <th className="text-right">Requests</th>
              <th className="text-right">Tokens</th>
              <th className="text-right">Cost</th>
              <th>Last activity</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((s) => (
              <tr key={s.id} className={newIds.has(s.id) ? "nb-flash" : ""}>
                <td>
                  <Link className="nb-tag" to={`/sessions/${encodeURIComponent(s.id)}`}>
                    {s.id}
                  </Link>
                </td>
                <td className="opacity-80">{s.user_id ?? <span className="opacity-40">—</span>}</td>
                <td className="text-right tabular-nums">{fmt.num(s.request_count)}</td>
                <td className="text-right tabular-nums">
                  {fmt.num(s.total_input_tokens + s.total_output_tokens)}
                </td>
                <td className="text-right tabular-nums">{fmt.cost(s.total_cost)}</td>
                <td>
                  <span className="opacity-80">{fmt.rel(s.updated_at)}</span>
                </td>
              </tr>
            ))}
            {!filtered.length && (
              <tr>
                <td colSpan={6}>
                  <EmptyState
                    title="No sessions yet"
                    hint="Send a request to /v1/chat/completions to bootstrap your first session."
                    curl={CURL_DEMO}
                    illustration="session"
                  />
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
