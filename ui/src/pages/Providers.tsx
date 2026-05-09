import { useEffect, useState } from "react";
import { api, type Provider } from "../api";

export function ProvidersPage() {
  const [list, setList] = useState<Provider[]>([]);

  useEffect(() => {
    api.providers().then((p) => setList(p.providers));
  }, []);

  return (
    <div className="space-y-4">
      <h2 className="font-display text-2xl font-bold">Providers</h2>
      <p className="text-sm opacity-70">
        Configure provider keys via environment variables (see <code>.env</code>). Model
        prefix is the provider id, e.g. <span className="nb-tag">openai/gpt-4o-mini</span>,
        <span className="nb-tag ml-1">anthropic/claude-sonnet-4-5</span>.
      </p>
      <div className="grid gap-4 md:grid-cols-3">
        {list.map((p) => (
          <div
            key={p.id}
            className="nb-card p-5"
            style={{
              background: p.configured ? "var(--color-mint)" : "var(--color-mist)",
            }}
          >
            <div className="flex items-center justify-between">
              <span className="font-display text-xl font-bold capitalize">{p.id}</span>
              <span
                className="nb-chip"
                style={{
                  background: p.configured ? "#fff" : "var(--color-rose)",
                }}
              >
                {p.configured ? "configured" : "missing key"}
              </span>
            </div>
            <div className="mt-2 break-all font-mono text-xs opacity-70">{p.base_url}</div>
            <div className="mt-3 text-xs opacity-70">
              env:&nbsp;
              <code className="nb-tag">{p.id.toUpperCase()}_API_KEY</code>
            </div>
          </div>
        ))}
      </div>

      <div className="nb-card p-5" style={{ background: "var(--color-butter)" }}>
        <h3 className="font-display text-lg font-bold">Quick test</h3>
        <pre className="scrollbar-soft mt-2 overflow-auto rounded bg-white p-3 font-mono text-xs">
{`curl http://localhost:8080/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "x-nebula-session: demo-1" \\
  -d '{
    "model": "openai/gpt-4o-mini",
    "messages": [{"role":"user","content":"Hello, Nebula!"}]
  }'`}
        </pre>
      </div>
    </div>
  );
}
