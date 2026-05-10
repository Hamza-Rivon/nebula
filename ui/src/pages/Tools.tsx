import { useMemo, useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { BarChart } from "../charts/BarChart";
import { type ToolUsage } from "../api";
import { EmptyState } from "../components/EmptyState";
import { MetricChips } from "../components/MetricChips";
import { fmt } from "../format";
import { flattenTools, toolsAggQuery, toolsListQuery } from "../queries";
import { useInfiniteScroll } from "../useInfiniteScroll";

const PALETTE = [
  "var(--color-rose)",
  "var(--color-butter)",
  "var(--color-mint)",
  "var(--color-lavender)",
  "var(--color-sky)",
  "var(--color-peach)",
  "var(--color-lime)",
];

const CURL_DEMO = `curl http://localhost:8080/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -d '{
    "model":"openai/gpt-4o-mini",
    "messages":[{"role":"user","content":"What is the weather in Paris?"}],
    "tools":[{"type":"function","function":{"name":"get_weather",
      "parameters":{"type":"object","properties":{"city":{"type":"string"}}}}}]
  }'`;

export function ToolsPage() {
  const [q, setQ] = useState("");
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [open, setOpen] = useState<Set<string>>(new Set());

  const filters = useMemo(
    () => ({ q: q.trim() || undefined, errorsOnly: errorsOnly || undefined }),
    [q, errorsOnly],
  );

  const { data: agg } = useQuery(toolsAggQuery());

  const list = useInfiniteQuery(toolsListQuery(filters));
  const { rows, total } = flattenTools(list.data?.pages);
  const sentinelRef = useInfiniteScroll(
    () => list.fetchNextPage(),
    list.hasNextPage && !list.isFetchingNextPage,
  );
  const loading = list.isLoading || list.isFetchingNextPage;
  const done = !list.hasNextPage;

  const toggle = (n: string) => {
    setOpen((s) => {
      const next = new Set(s);
      if (next.has(n)) next.delete(n);
      else next.add(n);
      return next;
    });
  };

  const top = rows.slice(0, 10).map((t, i) => ({
    name: t.name,
    count: t.count,
    fill: PALETTE[i % PALETTE.length]!,
  }));

  const errPct = agg ? Math.round(agg.error_rate * 1000) / 10 : 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline gap-3">
        <h2 className="font-display text-2xl font-bold">Tools</h2>
        <span className="nb-chip" style={{ background: "var(--color-rose)" }}>
          {fmt.num(total)} matching
        </span>
      </div>

      <MetricChips
        items={[
          {
            label: "Unique tools",
            value: fmt.num(agg?.count ?? 0),
            bg: "var(--color-mist)",
          },
          {
            label: "Total calls",
            value: fmt.num(agg?.total_calls ?? 0),
            bg: "var(--color-lavender)",
          },
          {
            label: "Tool spend",
            value: fmt.cost(agg?.total_cost ?? 0),
            hint: "estimated, distributed across calls",
            bg: "var(--color-lime)",
          },
          {
            label: "Error rate",
            value: `${errPct}%`,
            bg: errPct > 5 ? "var(--color-rose)" : "var(--color-mint)",
          },
        ]}
      />

      <div className="filter-row">
        <input
          className="nb-input grow"
          placeholder="search tool name…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <label className="nb-chip" style={{ cursor: "pointer", userSelect: "none" }}>
          <input
            type="checkbox"
            checked={errorsOnly}
            onChange={(e) => setErrorsOnly(e.target.checked)}
            style={{ marginRight: ".4rem" }}
          />
          errors only
        </label>
        {(q || errorsOnly) && (
          <button
            className="nb-chip"
            onClick={() => {
              setQ("");
              setErrorsOnly(false);
            }}
          >
            clear
          </button>
        )}
      </div>

      {top.length > 0 && (
        <div className="nb-card nb-hover p-5">
          <h3 className="font-display text-lg font-bold">Top tools by call count</h3>
          <div className="mt-3" style={{ height: 320 }}>
            <BarChart data={top} height={320} rotateLabels />
          </div>
        </div>
      )}

      <div className="nb-card overflow-hidden">
        <table className="nb-table">
          <thead>
            <tr>
              <th>Tool</th>
              <th className="text-right">Calls</th>
              <th className="text-right">Avg latency</th>
              <th className="text-right">Cost</th>
              <th className="text-right">Error rate</th>
              <th>Top model</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => (
              <Row key={t.name} t={t} open={open.has(t.name)} onToggle={() => toggle(t.name)} />
            ))}
            {!loading && !rows.length && (
              <tr>
                <td colSpan={7}>
                  <EmptyState
                    title="No tools match"
                    hint="Send a request whose model invokes a function, or clear the filter."
                    curl={CURL_DEMO}
                    illustration="tools"
                  />
                </td>
              </tr>
            )}
            {!done && rows.length > 0 && (
              <tr>
                <td colSpan={7} className="table-loadmore">
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

function Row({ t, open, onToggle }: { t: ToolUsage; open: boolean; onToggle: () => void }) {
  const errPct = (t.error_rate * 100).toFixed(1);
  return (
    <>
      <tr onClick={onToggle}>
        <td>
          <span className="nb-tag">{t.name}</span>
        </td>
        <td className="text-right tabular-nums">{fmt.num(t.count)}</td>
        <td className="text-right tabular-nums">{Math.round(t.avg_latency_ms || 0)}ms</td>
        <td className="text-right tabular-nums">{fmt.cost(t.cost)}</td>
        <td className="text-right tabular-nums">
          <span
            className="nb-chip"
            style={{
              background:
                t.error_rate > 0.1
                  ? "var(--color-rose)"
                  : t.error_rate > 0
                    ? "var(--color-butter)"
                    : "var(--color-mint)",
            }}
          >
            {errPct}%
          </span>
        </td>
        <td>
          {t.top_model ? (
            <span className="nb-tag">{t.top_model}</span>
          ) : (
            <span className="opacity-40">—</span>
          )}
        </td>
        <td>
          <button
            type="button"
            className="nb-chip"
            onClick={(e) => {
              e.stopPropagation();
              onToggle();
            }}
            style={{ background: open ? "var(--color-butter)" : "#fff" }}
          >
            {open ? "hide args" : "sample args"}
          </button>
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={7} style={{ background: "var(--color-mist)" }}>
            <pre className="scrollbar-soft max-h-64 overflow-auto rounded border-2 border-[var(--color-ink)] bg-white p-3 font-mono text-xs">
              {prettyArgs(t.sample_args)}
            </pre>
          </td>
        </tr>
      )}
    </>
  );
}

function prettyArgs(samples: string[] | null): string {
  if (!samples || samples.length === 0) return "(no captured arguments)";
  return samples
    .map((s) => {
      try {
        return JSON.stringify(JSON.parse(s), null, 2);
      } catch {
        return s;
      }
    })
    .join("\n\n---\n\n");
}
