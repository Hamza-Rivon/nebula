import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { EmptyState } from "../components/EmptyState";
import { MetricChips } from "../components/MetricChips";
import { fmt } from "../format";
import {
  flattenRequests,
  requestsAggQuery,
  requestsListQuery,
} from "../queries";
import { useInfiniteScroll } from "../useInfiniteScroll";
import { pickRequestId, useFreshIds } from "../liveBridge";

const CURL_DEMO = `curl http://localhost:8080/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -d '{"model":"openai/gpt-4o-mini",
       "messages":[{"role":"user","content":"Hello, Nebula!"}]}'`;

export function RequestsPage() {
  const [model, setModel] = useState("");
  const [status, setStatus] = useState("");

  const filters = useMemo(
    () => ({
      model: model.trim() || undefined,
      status: status || undefined,
    }),
    [model, status],
  );

  const { data: agg } = useQuery(requestsAggQuery(filters));

  const list = useInfiniteQuery(requestsListQuery(filters));
  const { rows, total } = flattenRequests(list.data?.pages);
  const sentinelRef = useInfiniteScroll(
    () => list.fetchNextPage(),
    list.hasNextPage && !list.isFetchingNextPage,
  );
  const loading = list.isLoading || list.isFetchingNextPage;
  const done = !list.hasNextPage;
  const freshIds = useFreshIds(pickRequestId);

  const navigate = useNavigate();
  const goToRequest = (id: string) =>
    navigate(`/requests/${encodeURIComponent(id)}`);

  const errorRatePct = agg ? Math.round(agg.error_rate * 1000) / 10 : 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline gap-3">
        <h2 className="font-display text-2xl font-bold">Requests</h2>
        <span className="nb-chip" style={{ background: "var(--color-peach)" }}>
          {fmt.num(total)} matching
        </span>
      </div>

      <MetricChips
        items={[
          {
            label: "Requests",
            value: fmt.num(agg?.count ?? 0),
            bg: "var(--color-mist)",
          },
          {
            label: "Total spend",
            value: fmt.cost(agg?.total_cost ?? 0),
            bg: "var(--color-lime)",
          },
          {
            label: "Avg latency",
            value: `${Math.round(agg?.avg_latency_ms ?? 0)}ms`,
            bg: "var(--color-sky)",
          },
          {
            label: "p95 latency",
            value: `${Math.round(agg?.p95_latency_ms ?? 0)}ms`,
            bg: "var(--color-butter)",
          },
          {
            label: "Error rate",
            value: `${errorRatePct}%`,
            hint: `${fmt.num(agg?.error_count ?? 0)} errors`,
            bg: errorRatePct > 5 ? "var(--color-rose)" : "var(--color-mint)",
          },
        ]}
      />

      <div className="filter-row">
        <input
          className="nb-input grow"
          placeholder="filter by model…"
          value={model}
          onChange={(e) => setModel(e.target.value)}
        />
        <select
          className="nb-input"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          style={{ maxWidth: "9rem" }}
        >
          <option value="">all status</option>
          <option value="ok">ok</option>
          <option value="error">error</option>
        </select>
        {(model || status) && (
          <button
            className="nb-chip"
            onClick={() => {
              setModel("");
              setStatus("");
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
              <th>Request</th>
              <th>Session</th>
              <th>User</th>
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
              <tr
                key={r.id}
                onClick={() => goToRequest(r.id)}
                className={freshIds.has(r.id) ? "nb-flash" : undefined}
              >
                <td>
                  <Link
                    className="nb-tag"
                    to={`/requests/${encodeURIComponent(r.id)}`}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {r.id.slice(0, 10)}
                  </Link>
                  <div className="mt-1 text-xs opacity-60">{fmt.rel(r.started_at)}</div>
                </td>
                <td>
                  <Link
                    className="nb-tag"
                    to={`/sessions/${encodeURIComponent(r.session_id)}`}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {r.session_id.slice(0, 10)}
                  </Link>
                </td>
                <td className="opacity-80">
                  {r.user_id ?? <span className="opacity-40">—</span>}
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
                        r.status === "ok" ? "var(--color-mint)" : "var(--color-rose)",
                    }}
                  >
                    {r.status}
                  </span>
                </td>
              </tr>
            ))}
            {!loading && !rows.length && (
              <tr>
                <td colSpan={9}>
                  <EmptyState
                    title="No requests match"
                    hint="Adjust the filters or send a fresh request."
                    curl={CURL_DEMO}
                    illustration="chart"
                  />
                </td>
              </tr>
            )}
            {!done && rows.length > 0 && (
              <tr>
                <td colSpan={9} className="table-loadmore">
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
