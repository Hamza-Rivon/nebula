import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api, type RequestRow } from "../api";
import { EmptyState } from "../components/EmptyState";
import { fmt } from "../format";

const CURL_DEMO = `curl http://localhost:8080/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -d '{"model":"openai/gpt-4o-mini",
       "messages":[{"role":"user","content":"Hello, Nebula!"}]}'`;

export function RequestsPage() {
  const [rows, setRows] = useState<RequestRow[]>([]);
  const [total, setTotal] = useState(0);
  const [model, setModel] = useState("");
  const [status, setStatus] = useState("");
  const seen = useRef<Set<string>>(new Set());
  const [newIds, setNewIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    let alive = true;
    const tick = () =>
      api
        .requests({ limit: 100, model: model || undefined, status: status || undefined })
        .then((r) => {
          if (!alive) return;
          if (seen.current.size > 0) {
            const fresh = new Set<string>();
            for (const row of r.requests) {
              if (!seen.current.has(row.id)) fresh.add(row.id);
            }
            if (fresh.size) {
              setNewIds(fresh);
              setTimeout(() => alive && setNewIds(new Set()), 700);
            }
          }
          seen.current = new Set(r.requests.map((x) => x.id));
          setRows(r.requests);
          setTotal(r.total);
        });
    tick();
    const t = setInterval(tick, 4000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [model, status]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="font-display text-2xl font-bold">Requests</h2>
        <span className="nb-chip" style={{ background: "var(--color-peach)" }}>
          {total} total
        </span>
        <input
          className="nb-input ml-auto max-w-xs"
          placeholder="filter by model…"
          value={model}
          onChange={(e) => setModel(e.target.value)}
        />
        <select
          className="nb-input max-w-[12rem]"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">all status</option>
          <option value="ok">ok</option>
          <option value="error">error</option>
        </select>
      </div>
      <div className="nb-card overflow-hidden">
        <table className="nb-table">
          <thead>
            <tr>
              <th>Request</th>
              <th>Session</th>
              <th>Model</th>
              <th className="text-right">Tokens</th>
              <th className="text-right">Cost</th>
              <th className="text-right">Latency</th>
              <th>Finish</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={newIds.has(r.id) ? "nb-flash" : ""}>
                <td>
                  <Link className="nb-tag" to={`/requests/${encodeURIComponent(r.id)}`}>
                    {r.id.slice(0, 10)}
                  </Link>
                  <div className="mt-1 text-xs opacity-60">{fmt.rel(r.started_at)}</div>
                </td>
                <td>
                  <Link className="nb-tag" to={`/sessions/${encodeURIComponent(r.session_id)}`}>
                    {r.session_id.slice(0, 10)}
                  </Link>
                </td>
                <td>
                  <span className="nb-tag">{r.model}</span>
                </td>
                <td className="text-right tabular-nums">
                  {fmt.num((r.input_tokens ?? 0) + (r.output_tokens ?? 0))}
                </td>
                <td className="text-right tabular-nums">{fmt.cost(r.cost)}</td>
                <td className="text-right tabular-nums">{fmt.ms(r.latency_ms)}</td>
                <td className="text-xs opacity-80">{r.finish_reason ?? "—"}</td>
                <td>
                  <span
                    className="nb-chip"
                    style={{
                      background:
                        r.status === "ok"
                          ? "var(--color-mint)"
                          : "var(--color-rose)",
                    }}
                  >
                    {r.status}
                  </span>
                </td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={8}>
                  <EmptyState
                    title="No requests match"
                    hint="Adjust the filters or send a fresh request."
                    curl={CURL_DEMO}
                    illustration="chart"
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
