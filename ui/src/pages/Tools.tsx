import { useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api, type ToolUsage } from "../api";
import { EmptyState } from "../components/EmptyState";
import { fmt } from "../format";

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
  const [tools, setTools] = useState<ToolUsage[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());

  useEffect(() => {
    let alive = true;
    const tick = () =>
      api
        .tools()
        .then((r) => alive && setTools(r.tools))
        .catch((e) => alive && setErr(String(e)));
    tick();
    const id = setInterval(tick, 6000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const toggle = (n: string) => {
    setOpen((s) => {
      const next = new Set(s);
      if (next.has(n)) next.delete(n);
      else next.add(n);
      return next;
    });
  };

  if (err)
    return (
      <div className="nb-card p-5" style={{ background: "var(--color-rose)" }}>
        Couldn't load tools: {err}
      </div>
    );

  const top = tools.slice(0, 10).map((t, i) => ({
    name: t.name,
    count: t.count,
    fill: PALETTE[i % PALETTE.length],
  }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline gap-3">
        <h2 className="font-display text-2xl font-bold">Tools</h2>
        <span className="nb-chip" style={{ background: "var(--color-rose)" }}>
          {tools.length} unique
        </span>
        <p className="ml-2 text-sm opacity-70">
          Function-call usage across the gateway. Useful for spotting which AI
          workflows are real.
        </p>
      </div>

      <div className="nb-card nb-hover p-5">
        <h3 className="font-display text-lg font-bold">Top tools by call count</h3>
        {top.length === 0 ? (
          <EmptyState
            title="No tool calls yet"
            hint="Send a request whose model invokes a function to populate this view."
            curl={CURL_DEMO}
            illustration="tools"
          />
        ) : (
          <div className="mt-3" style={{ height: 320 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={top} margin={{ top: 8, right: 12, left: -10, bottom: 30 }}>
                <CartesianGrid vertical={false} strokeDasharray="0" />
                <XAxis dataKey="name" tickLine={false} angle={-25} textAnchor="end" interval={0} />
                <YAxis tickLine={false} allowDecimals={false} />
                <Tooltip />
                <Bar
                  dataKey="count"
                  stroke="#111"
                  strokeWidth={2}
                  radius={2}
                  isAnimationActive={false}
                >
                  {top.map((d, i) => (
                    <Cell key={i} fill={d.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

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
            {tools.map((t) => (
              <Row key={t.name} t={t} open={open.has(t.name)} onToggle={() => toggle(t.name)} />
            ))}
            {!tools.length && (
              <tr>
                <td colSpan={7} className="py-10 text-center opacity-60">
                  No tools recorded yet.
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
          {t.top_model ? <span className="nb-tag">{t.top_model}</span> : <span className="opacity-40">—</span>}
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

function prettyArgs(a: string | null): string {
  if (!a) return "(no captured arguments)";
  try {
    return JSON.stringify(JSON.parse(a), null, 2);
  } catch {
    return a;
  }
}
