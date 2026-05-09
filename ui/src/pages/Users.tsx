import { useEffect, useMemo, useState } from "react";
import { api, type UserUsage } from "../api";
import { EmptyState } from "../components/EmptyState";
import { fmt } from "../format";

type SortKey =
  | "user_id"
  | "request_count"
  | "session_count"
  | "tokens"
  | "cost"
  | "avg_latency_ms"
  | "errors"
  | "last_seen";

type SortDir = "asc" | "desc";

const CURL_DEMO = `curl http://localhost:8080/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "x-nebula-user: alice" \\
  -d '{"model":"openai/gpt-4o-mini",
       "messages":[{"role":"user","content":"Hello!"}]}'`;

export function UsersPage() {
  const [users, setUsers] = useState<UserUsage[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [sort, setSort] = useState<SortKey>("request_count");
  const [dir, setDir] = useState<SortDir>("desc");

  useEffect(() => {
    let alive = true;
    const tick = () =>
      api
        .users()
        .then((r) => alive && setUsers(r.users))
        .catch((e) => alive && setErr(String(e)));
    tick();
    const id = setInterval(tick, 6000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const sorted = useMemo(() => {
    const cp = [...users];
    cp.sort((a, b) => {
      const av = a[sort];
      const bv = b[sort];
      if (typeof av === "number" && typeof bv === "number") {
        return dir === "asc" ? av - bv : bv - av;
      }
      const as = String(av ?? "");
      const bs = String(bv ?? "");
      return dir === "asc" ? as.localeCompare(bs) : bs.localeCompare(as);
    });
    return cp;
  }, [users, sort, dir]);

  // wizard = top user by requests with low error rate
  const wizardId = useMemo(() => {
    if (!users.length) return null;
    const ranked = [...users]
      .filter((u) => u.request_count >= 1)
      .sort((a, b) => {
        const aErr = a.errors / Math.max(1, a.request_count);
        const bErr = b.errors / Math.max(1, b.request_count);
        if (aErr !== bErr) return aErr - bErr;
        return b.request_count - a.request_count;
      });
    return ranked[0]?.user_id ?? null;
  }, [users]);

  const setSortKey = (k: SortKey) => {
    if (k === sort) setDir(dir === "asc" ? "desc" : "asc");
    else {
      setSort(k);
      setDir("desc");
    }
  };

  const sortIndicator = (k: SortKey) => (sort === k ? (dir === "asc" ? "↑" : "↓") : "");

  if (err)
    return (
      <div className="nb-card p-5" style={{ background: "var(--color-rose)" }}>
        Couldn't load users: {err}
      </div>
    );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline gap-3">
        <h2 className="font-display text-2xl font-bold">Users</h2>
        <span className="nb-chip" style={{ background: "var(--color-lime)" }}>
          {users.length} active
        </span>
        <p className="ml-2 text-sm opacity-70">
          Tagged via the <code className="nb-tag">x-nebula-user</code> header.
        </p>
      </div>

      {users.length === 0 ? (
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
                <Th onClick={() => setSortKey("user_id")}>User {sortIndicator("user_id")}</Th>
                <Th right onClick={() => setSortKey("session_count")}>
                  Sessions {sortIndicator("session_count")}
                </Th>
                <Th right onClick={() => setSortKey("request_count")}>
                  Requests {sortIndicator("request_count")}
                </Th>
                <Th right onClick={() => setSortKey("tokens")}>
                  Tokens {sortIndicator("tokens")}
                </Th>
                <Th right onClick={() => setSortKey("cost")}>
                  Cost {sortIndicator("cost")}
                </Th>
                <Th right onClick={() => setSortKey("avg_latency_ms")}>
                  Avg latency {sortIndicator("avg_latency_ms")}
                </Th>
                <Th right onClick={() => setSortKey("errors")}>
                  Errors {sortIndicator("errors")}
                </Th>
                <Th onClick={() => setSortKey("last_seen")}>
                  Last seen {sortIndicator("last_seen")}
                </Th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((u) => (
                <tr key={u.user_id}>
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
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Th({
  children,
  right,
  onClick,
}: {
  children: React.ReactNode;
  right?: boolean;
  onClick: () => void;
}) {
  return (
    <th
      onClick={onClick}
      className={right ? "cursor-pointer text-right" : "cursor-pointer"}
      style={{ userSelect: "none" }}
    >
      {children}
    </th>
  );
}
