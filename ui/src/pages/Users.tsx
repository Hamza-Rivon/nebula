import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { EmptyState } from "../components/EmptyState";
import { MetricChips } from "../components/MetricChips";
import { Drawer } from "../components/insights/Drawer";
import { fmt } from "../format";
import { formatUsd, titleCase, truncate } from "../insights/format";
import {
  flattenUsers,
  userInsightsQuery,
  usersAggQuery,
  usersListQuery,
} from "../queries";
import { useInfiniteScroll } from "../useInfiniteScroll";

const CURL_DEMO = `curl http://localhost:8080/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "x-nebula-user: alice" \\
  -d '{"model":"openai/gpt-4o-mini",
       "messages":[{"role":"user","content":"Hello!"}]}'`;

export function UsersPage() {
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState("");
  const friction = params.get("friction") ?? "";
  const openUserId = params.get("user") ?? "";

  const filters = useMemo(
    () => ({ q: q.trim() || undefined, friction: friction || undefined }),
    [q, friction],
  );

  const { data: agg } = useQuery(usersAggQuery());

  const list = useInfiniteQuery(usersListQuery(filters));
  const { rows, total } = flattenUsers(list.data?.pages);
  const sentinelRef = useInfiniteScroll(
    () => list.fetchNextPage(),
    list.hasNextPage && !list.isFetchingNextPage,
  );
  const loading = list.isLoading || list.isFetchingNextPage;
  const done = !list.hasNextPage;

  const setFriction = (next: string | null) => {
    const p = new URLSearchParams(params);
    if (next) p.set("friction", next);
    else p.delete("friction");
    setParams(p, { replace: true });
  };
  const openUser = (id: string) => {
    const p = new URLSearchParams(params);
    p.set("user", id);
    setParams(p, { replace: false });
  };
  const closeUser = () => {
    const p = new URLSearchParams(params);
    p.delete("user");
    setParams(p, { replace: false });
  };

  // wizard = top user by requests with low error rate
  const wizardId = useMemo(() => {
    if (!rows.length) return null;
    const ranked = [...rows]
      .filter((u) => u.request_count >= 1)
      .sort((a, b) => {
        const aErr = a.errors / Math.max(1, a.request_count);
        const bErr = b.errors / Math.max(1, b.request_count);
        if (aErr !== bErr) return aErr - bErr;
        return b.request_count - a.request_count;
      });
    return ranked[0]?.user_id ?? null;
  }, [rows]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline gap-3">
        <h2 className="font-display text-2xl font-bold">Users</h2>
        <span className="nb-chip" style={{ background: "var(--color-lime)" }}>
          {fmt.num(total)} matching
        </span>
      </div>

      <MetricChips
        items={[
          {
            label: "Active users",
            value: fmt.num(agg?.active ?? 0),
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
            label: "Top user",
            value: agg?.top_user_id ?? "—",
            hint: agg?.top_user_id ? `${fmt.cost(agg.top_user_cost)} this period` : null,
            bg: "var(--color-butter)",
          },
        ]}
      />

      <div className="filter-row">
        <input
          className="nb-input grow"
          placeholder="search by user id…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        {friction && (
          <span
            className="friction-chip active"
            onClick={() => setFriction(null)}
            title="clear friction filter"
          >
            friction · {titleCase(friction)}{" "}
            <span className="friction-chip-x">×</span>
          </span>
        )}
        {(q || friction) && (
          <button
            className="nb-chip"
            onClick={() => {
              setQ("");
              setFriction(null);
            }}
          >
            clear
          </button>
        )}
      </div>

      {rows.length === 0 && !loading ? (
        <div className="nb-card p-5">
          <EmptyState
            title="No tagged users yet"
            hint="Add x-nebula-user to your proxy calls to start segmenting."
            curl={CURL_DEMO}
            illustration="users"
          />
        </div>
      ) : (
        <div className="nb-card overflow-hidden">
          <table className="nb-table">
            <thead>
              <tr>
                <th>User</th>
                <th className="text-right">Sessions</th>
                <th className="text-right">Requests</th>
                <th className="text-right">Tokens</th>
                <th className="text-right">Cost</th>
                <th className="text-right">Avg latency</th>
                <th className="text-right">Errors</th>
                <th>Last seen</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((u) => (
                <tr key={u.user_id} onClick={() => openUser(u.user_id)}>
                  <td>
                    <span className="nb-tag">{u.user_id}</span>
                    {u.user_id === wizardId && (
                      <span
                        className="nb-chip ml-2"
                        style={{ background: "var(--color-butter)" }}
                        title="Top user · low error rate"
                      >
                        wizard
                      </span>
                    )}
                  </td>
                  <td className="text-right tabular-nums">{fmt.num(u.session_count)}</td>
                  <td className="text-right tabular-nums">{fmt.num(u.request_count)}</td>
                  <td className="text-right tabular-nums">{fmt.num(u.tokens)}</td>
                  <td className="text-right tabular-nums">{fmt.cost(u.cost)}</td>
                  <td className="text-right tabular-nums">
                    {Math.round(u.avg_latency_ms || 0)}ms
                  </td>
                  <td className="text-right tabular-nums">
                    <span
                      className="nb-chip"
                      style={{
                        background:
                          u.errors > 0 ? "var(--color-rose)" : "var(--color-mint)",
                      }}
                    >
                      {u.errors}
                    </span>
                  </td>
                  <td className="opacity-80">{fmt.rel(u.last_seen)}</td>
                </tr>
              ))}
              {!done && rows.length > 0 && (
                <tr>
                  <td colSpan={8} className="table-loadmore">
                    <div ref={sentinelRef} className="infinite-sentinel" />
                    {loading ? "loading more…" : `${rows.length} of ${total} loaded`}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <UserDrawer
        userId={openUserId || null}
        friction={friction || null}
        onClose={closeUser}
        onSetFriction={setFriction}
      />
    </div>
  );
}

function UserDrawer({
  userId,
  friction,
  onClose,
  onSetFriction,
}: {
  userId: string | null;
  friction: string | null;
  onClose: () => void;
  onSetFriction: (f: string | null) => void;
}) {
  const query = useQuery(userInsightsQuery(userId ?? "", friction));
  const bundle = query.data ?? null;
  const loading = query.isLoading && !!userId;

  const u = bundle?.user ?? null;
  const sessions = bundle?.sessions ?? [];
  const allFrictions = useMemo(() => {
    if (!u) return [];
    return Object.entries(u.topFrictions ?? {})
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12);
  }, [u]);

  return (
    <Drawer
      open={!!userId}
      onClose={onClose}
      eyebrow={u ? "Engineer profile" : "User"}
      title={u?.displayName ?? userId ?? ""}
      subtitle={
        u
          ? `${u.team} · ${u.sessionCount} sessions · ${formatUsd(u.totalCostUsd)}`
          : userId
            ? "no insights yet — re-analyze to populate"
            : ""
      }
    >
      {loading && <div className="opacity-70">Loading…</div>}
      {!loading && !u && userId && (
        <div className="opacity-70">
          No analyzed insights yet for <span className="nb-tag">{userId}</span>. Trigger an
          analyze pass from the sidebar.
        </div>
      )}
      {u && (
        <>
          <div className="space-y-1">
            <div className="text-xs uppercase tracking-wider opacity-60">Win rate</div>
            <div className="text-2xl font-bold">{Math.round((u.winRate ?? 0) * 100)}%</div>
            <div className="text-xs opacity-60">
              {u.outcomes.fully} fully · {u.outcomes.mostly} mostly · {u.outcomes.partial} partial
              · {u.outcomes.none} none
            </div>
          </div>
          <div className="mt-4">
            <div className="text-xs uppercase tracking-wider opacity-60">Top frictions</div>
            <div className="mt-2 flex flex-wrap gap-2">
              {allFrictions.length === 0 && <span className="opacity-50">—</span>}
              {allFrictions.map(([tag, n]) => (
                <span
                  key={tag}
                  className={`friction-chip ${friction === tag ? "active" : ""}`}
                  onClick={() => onSetFriction(friction === tag ? null : tag)}
                  title="click to filter sessions"
                >
                  {titleCase(tag)} <span className="opacity-60">· {n}</span>
                </span>
              ))}
            </div>
          </div>

          <div className="mt-5">
            <div className="text-xs uppercase tracking-wider opacity-60 mb-2">
              Sessions {friction && <>matching <b>{titleCase(friction)}</b></>} ({sessions.length})
            </div>
            {sessions.length === 0 ? (
              <div className="opacity-50 text-sm">
                No sessions{friction ? " match this friction tag" : ""}.
              </div>
            ) : (
              <ul className="space-y-2">
                {sessions.map((s) => (
                  <li key={s.sessionId} className="nb-card-flat p-3">
                    <div className="flex items-baseline gap-2">
                      <Link
                        to={`/sessions/${encodeURIComponent(s.sessionId)}`}
                        className="nb-tag"
                      >
                        {s.sessionId.slice(0, 12)}
                      </Link>
                      <span className="text-xs opacity-60">
                        {new Date(s.startedAt).toLocaleString()}
                      </span>
                      <span className="ml-auto nb-chip" style={{ background: outcomeColor(s.outcome) }}>
                        {s.outcome}
                      </span>
                    </div>
                    {s.goal && (
                      <div className="mt-1 text-sm">{truncate(s.goal, 140)}</div>
                    )}
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {s.friction.map((f) => (
                        <span
                          key={f}
                          className={`friction-chip ${friction === f ? "active" : ""}`}
                          onClick={() => onSetFriction(friction === f ? null : f)}
                        >
                          {titleCase(f)}
                        </span>
                      ))}
                      <span className="ml-auto text-xs opacity-60 tabular-nums">
                        {formatUsd(s.costUsd)} · {s.turns} turns
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </Drawer>
  );
}

function outcomeColor(o: string): string {
  switch (o) {
    case "fully":
      return "var(--color-mint)";
    case "mostly":
      return "var(--color-lime)";
    case "partial":
      return "var(--color-butter)";
    case "none":
      return "var(--color-rose)";
    default:
      return "var(--color-mist)";
  }
}
