import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { EmptyState } from "../components/EmptyState";
import { fmt } from "../format";
import { searchQuery } from "../queries";

export function SearchPage() {
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const [draft, setDraft] = useState(q);

  useEffect(() => {
    setDraft(q);
  }, [q]);

  const search = useQuery(searchQuery(q));
  const rows = search.data?.requests ?? [];
  const loading = search.isLoading && !!q.trim();
  const err = search.error ? String(search.error) : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline gap-3">
        <h2 className="font-display text-2xl font-bold">Search</h2>
        {q && (
          <span className="nb-chip" style={{ background: "var(--color-lavender)" }}>
            “{q}”
          </span>
        )}
        {q && !loading && (
          <span className="nb-chip">{rows.length} matches</span>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const next = draft.trim();
            if (!next) return;
            setParams({ q: next });
          }}
          className="ml-auto flex items-center gap-2"
        >
          <input
            className="nb-input"
            style={{ width: 280 }}
            placeholder="search prompts, tools, responses…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <button type="submit" className="nb-btn">go</button>
        </form>
      </div>

      {err && (
        <div className="nb-card p-5" style={{ background: "var(--color-rose)" }}>
          {err}
        </div>
      )}

      {!q.trim() ? (
        <div className="nb-card p-5">
          <EmptyState
            title="Search across all captured traffic"
            hint="LIKE-style fulltext over request and response JSON. Try a model name, a phrase from a prompt, or a tool name."
            illustration="search"
          />
        </div>
      ) : loading ? (
        <div className="nb-card p-5">Searching…</div>
      ) : rows.length === 0 ? (
        <div className="nb-card p-5">
          <EmptyState
            title={`No matches for “${q}”`}
            hint="Try a shorter or different keyword."
            illustration="search"
          />
        </div>
      ) : (
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
                <th>Status</th>
                <th>When</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Link className="nb-tag" to={`/requests/${encodeURIComponent(r.id)}`}>
                      {r.id.slice(0, 10)}
                    </Link>
                  </td>
                  <td>
                    <Link
                      className="nb-tag"
                      to={`/sessions/${encodeURIComponent(r.session_id)}`}
                    >
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
                  <td className="opacity-80">{fmt.rel(r.started_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
