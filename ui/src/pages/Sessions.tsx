import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { EmptyState } from "../components/EmptyState";
import { MetricChips } from "../components/MetricChips";
import { fmt } from "../format";
import {
  flattenSessions,
  sessionsAggQuery,
  sessionsListQuery,
} from "../queries";
import { useInfiniteScroll } from "../useInfiniteScroll";
import { pickSessionId, useFreshIds } from "../liveBridge";

const CURL_DEMO = `curl http://localhost:8080/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "x-nebula-session: demo-1" \\
  -d '{"model":"openai/gpt-4o-mini",
       "messages":[{"role":"user","content":"Hello, Nebula!"}]}'`;

export function SessionsPage() {
  const [q, setQ] = useState("");
  const [user, setUser] = useState("");

  const filters = useMemo(
    () => ({
      q: q.trim() || undefined,
      user: user.trim() || undefined,
    }),
    [q, user],
  );

  const { data: agg } = useQuery(sessionsAggQuery(filters));

  const list = useInfiniteQuery(sessionsListQuery(filters));
  const { rows, total } = flattenSessions(list.data?.pages);
  const sentinelRef = useInfiniteScroll(
    () => list.fetchNextPage(),
    list.hasNextPage && !list.isFetchingNextPage,
  );
  const loading = list.isLoading || list.isFetchingNextPage;
  const done = !list.hasNextPage;
  const freshIds = useFreshIds(pickSessionId);

  const navigate = useNavigate();
  const goToSession = (id: string) =>
    navigate(`/sessions/${encodeURIComponent(id)}`);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline gap-3">
        <h2 className="font-display text-2xl font-bold">Sessions</h2>
        <span className="nb-chip" style={{ background: "var(--color-mint)" }}>
          {fmt.num(total)} matching
        </span>
      </div>

      <MetricChips
        items={[
          {
            label: "Sessions",
            value: fmt.num(agg?.count ?? 0),
            bg: "var(--color-mist)",
          },
          {
            label: "Total spend",
            value: fmt.cost(agg?.total_cost ?? 0),
            bg: "var(--color-lime)",
          },
          {
            label: "Total tokens",
            value: fmt.num(agg?.total_tokens ?? 0),
            bg: "var(--color-sky)",
          },
          {
            label: "Avg requests / session",
            value: (agg?.avg_requests_per_session ?? 0).toFixed(1),
            bg: "var(--color-butter)",
          },
          {
            label: "Top model",
            value: agg?.top_model ?? "—",
            hint: agg?.top_model ? "across matched sessions" : null,
            bg: "var(--color-lavender)",
          },
        ]}
      />

      <div className="filter-row">
        <input
          className="nb-input grow"
          placeholder="filter by session id or user…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <input
          className="nb-input"
          placeholder="user id"
          value={user}
          onChange={(e) => setUser(e.target.value)}
          style={{ maxWidth: "10rem" }}
        />
        {(q || user) && (
          <button
            className="nb-chip"
            onClick={() => {
              setQ("");
              setUser("");
            }}
          >
            clear
          </button>
        )}
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
            {rows.map((s) => (
              <tr
                key={s.id}
                onClick={() => goToSession(s.id)}
                className={freshIds.has(s.id) ? "nb-flash" : undefined}
              >
                <td>
                  <Link
                    className="nb-tag"
                    to={`/sessions/${encodeURIComponent(s.id)}`}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {s.id}
                  </Link>
                </td>
                <td className="opacity-80">
                  {s.user_id ?? <span className="opacity-40">—</span>}
                </td>
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
            {!loading && !rows.length && (
              <tr>
                <td colSpan={6}>
                  <EmptyState
                    title="No sessions match"
                    hint="Adjust the filters or send a fresh request to /v1/chat/completions."
                    curl={CURL_DEMO}
                    illustration="session"
                  />
                </td>
              </tr>
            )}
            {!done && rows.length > 0 && (
              <tr>
                <td colSpan={6} className="table-loadmore">
                  <div ref={sentinelRef} className="infinite-sentinel" />
                  {loading ? "loading more…" : `${rows.length} of ${total} loaded`}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
