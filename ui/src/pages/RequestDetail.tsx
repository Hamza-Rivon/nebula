import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { type JsonValue, type RequestDetail } from "../api";
import { ConversationView, extractEvents } from "../components/ConversationView";
import { RequestTimeline } from "../components/RequestTimeline";
import { fmt } from "../format";
import { requestDetailQuery } from "../queries";

// =============================================================================
// Page
// =============================================================================

export function RequestDetailPage() {
  const { id = "" } = useParams();
  const nav = useNavigate();
  const [copied, setCopied] = useState(false);

  const query = useQuery(requestDetailQuery(id));
  const r = query.data ?? null;
  const err = query.error ? String(query.error) : null;

  const curl = useMemo(() => (r ? buildCurl(r) : ""), [r]);

  const copyCurl = async () => {
    if (!curl) return;
    try {
      await navigator.clipboard.writeText(curl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  };

  if (err)
    return (
      <div className="nb-card p-5" style={{ background: "var(--color-rose)" }}>
        {err}
      </div>
    );
  if (!r) return <div className="nb-card p-5">Loading…</div>;

  const events = extractEvents(r);
  const exportHref = `/api/sessions/${encodeURIComponent(r.session_id)}/export.jsonl`;
  const shortId = r.id.length > 12 ? r.id.slice(0, 12) : r.id;

  // Sampling parameter keys we want to surface.
  const sampling = collectSampling(r.request);
  const toolNames = collectToolNames(r.request);

  return (
    <div className="space-y-3">
      {/* ---- header ---- */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => nav(-1)}
          className="nb-btn"
          data-variant="ghost"
          type="button"
        >
          ← Back
        </button>
        <h2 className="font-display text-xl font-bold">Request</h2>
        <span className="nb-tag">{shortId}</span>
        <span className="nb-chip">
          session ·{" "}
          <Link to={`/sessions/${encodeURIComponent(r.session_id)}`}>
            {r.session_id.slice(0, 10)}
          </Link>
        </span>
        <Link
          to={`/sessions/${encodeURIComponent(r.session_id)}`}
          className="nb-btn"
          style={{ background: "var(--color-sky)", padding: ".4rem .8rem" }}
          title="Jump to session timeline"
        >
          ↩ session: {r.session_id.length > 16 ? r.session_id.slice(0, 16) + "…" : r.session_id}
        </Link>
        <span
          className="nb-chip"
          style={{
            background:
              r.status === "ok" ? "var(--color-mint)" : "var(--color-rose)",
          }}
        >
          {r.status}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <a
            href={exportHref}
            download={`session-${r.session_id}.jsonl`}
            className="nb-btn"
            style={{ background: "var(--color-lime)", padding: ".4rem .8rem" }}
          >
            Export JSONL
          </a>
          <button
            onClick={copyCurl}
            type="button"
            className="nb-btn"
            style={{
              background: copied ? "var(--color-mint)" : "var(--color-butter)",
              padding: ".4rem .8rem",
            }}
          >
            {copied ? "copied!" : "Copy as cURL"}
          </button>
        </div>
      </div>

      {/* ---- compact metric strip ---- */}
      <div className="nb-card-flat px-4 py-2">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 font-mono text-[12px] tabular-nums">
          <Metric label="model" value={r.model} />
          <Sep />
          <Metric label="provider" value={r.provider} />
          <Sep />
          <Metric
            label="tokens"
            value={`${fmt.num(r.input_tokens ?? 0)}→${fmt.num(r.output_tokens ?? 0)}`}
          />
          <Sep />
          <Metric label="cost" value={fmt.cost(r.cost)} />
          <Sep />
          <Metric label="latency" value={fmt.ms(r.latency_ms)} />
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px]">
          <span
            className="nb-chip"
            style={{ background: "var(--color-mist)" }}
            title="Finish reason"
          >
            finish · {r.finish_reason ?? "—"}
          </span>
          {r.streamed ? (
            <span
              className="nb-chip"
              style={{ background: "var(--color-sky)" }}
            >
              streamed
            </span>
          ) : (
            <span className="nb-chip">non-streamed</span>
          )}
          <span className="font-mono opacity-60">{fmt.date(r.started_at)}</span>
        </div>
      </div>

      {/* ---- per-request lifecycle timeline ---- */}
      <div className="nb-card p-4">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="font-display text-sm font-bold uppercase tracking-widest opacity-70">
            Request lifecycle
          </h3>
          <div className="font-mono text-[11px] opacity-60">
            one chat turn · {r.streamed ? "streamed" : "non-streamed"}
          </div>
        </div>
        <RequestTimeline detail={r} />
      </div>

      {r.error && (
        <div className="nb-card p-4" style={{ background: "var(--color-rose)" }}>
          <div className="text-xs uppercase opacity-70">Error</div>
          <pre className="mt-1 whitespace-pre-wrap font-mono text-sm">{r.error}</pre>
        </div>
      )}

      {/* ---- two-column layout: conversation 2/3 + sticky right rail ---- */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="nb-card p-5 lg:col-span-2">
          <h3 className="mb-3 font-display text-sm font-bold uppercase tracking-widest opacity-70">
            Conversation
          </h3>
          <ConversationView
            events={events}
            caption="Output offsets are anchored to finished_at (no intra-stream timestamps captured)."
          />
        </div>

        <aside className="lg:col-span-1">
          <div className="nb-card space-y-5 p-5 lg:sticky lg:top-4">
            {/* parameters */}
            <section>
              <h3 className="mb-2 font-display text-xs font-bold uppercase tracking-widest opacity-70">
                Parameters
              </h3>
              {sampling.length === 0 ? (
                <div className="text-[11px] opacity-60">
                  No sampling parameters set.
                </div>
              ) : (
                <dl className="grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-[11px] tabular-nums">
                  {sampling.map((s) => (
                    <Param key={s.k} k={s.k} v={s.v} />
                  ))}
                </dl>
              )}
            </section>

            {/* tools available */}
            <section>
              <h3 className="mb-2 font-display text-xs font-bold uppercase tracking-widest opacity-70">
                Tools available
              </h3>
              {toolNames.length === 0 ? (
                <div className="text-[11px] opacity-60">
                  No tools provided in request.
                </div>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {toolNames.map((t) => (
                    <span
                      key={t}
                      className="nb-tag"
                      style={{ background: "var(--color-peach)" }}
                    >
                      {t}
                    </span>
                  ))}
                </div>
              )}
            </section>

            {/* raw payload */}
            <section>
              <h3 className="mb-2 font-display text-xs font-bold uppercase tracking-widest opacity-70">
                Raw payload
              </h3>
              <details className="mt-1">
                <summary className="cursor-pointer text-[12px] font-semibold">
                  ▸ Request
                </summary>
                <pre className="scrollbar-soft mt-2 max-h-72 overflow-auto rounded border-2 border-[var(--color-ink)] bg-[var(--color-mist)] p-2 font-mono text-[11px]">
                  {JSON.stringify(r.request, null, 2)}
                </pre>
              </details>
              <details className="mt-1">
                <summary className="cursor-pointer text-[12px] font-semibold">
                  ▸ Response
                </summary>
                <pre className="scrollbar-soft mt-2 max-h-72 overflow-auto rounded border-2 border-[var(--color-ink)] bg-[var(--color-mist)] p-2 font-mono text-[11px]">
                  {JSON.stringify(r.response, null, 2)}
                </pre>
              </details>
              <details className="mt-1">
                <summary className="cursor-pointer text-[12px] font-semibold">
                  ▸ cURL
                </summary>
                <pre className="scrollbar-soft mt-2 max-h-72 overflow-auto rounded border-2 border-[var(--color-ink)] bg-[var(--color-mist)] p-2 font-mono text-[11px]">
                  {curl}
                </pre>
              </details>
            </section>
          </div>
        </aside>
      </div>
    </div>
  );
}

// =============================================================================
// Subcomponents
// =============================================================================

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className="text-[10px] uppercase opacity-60">{label}</span>
      <span className="font-bold">{value}</span>
    </span>
  );
}

function Sep() {
  return <span className="opacity-30">·</span>;
}

function Param({ k, v }: { k: string; v: string }) {
  return (
    <>
      <dt className="opacity-60">{k}</dt>
      <dd className="truncate text-right">{v}</dd>
    </>
  );
}

// =============================================================================
// Helpers
// =============================================================================

function isObj(v: unknown): v is Record<string, JsonValue> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

const SAMPLING_KEYS = [
  "model",
  "max_tokens",
  "max_completion_tokens",
  "temperature",
  "top_p",
  "top_k",
  "frequency_penalty",
  "presence_penalty",
  "stop",
  "stream",
  "n",
  "seed",
  "tool_choice",
  "response_format",
  "reasoning_effort",
];

function collectSampling(req: JsonValue): { k: string; v: string }[] {
  if (!isObj(req)) return [];
  const out: { k: string; v: string }[] = [];
  for (const k of SAMPLING_KEYS) {
    if (k in req) {
      const v = req[k];
      if (v == null) continue;
      let s: string;
      if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
        s = String(v);
      } else {
        s = JSON.stringify(v);
      }
      if (s.length > 40) s = s.slice(0, 39) + "…";
      out.push({ k, v: s });
    }
  }
  return out;
}

function collectToolNames(req: JsonValue): string[] {
  if (!isObj(req)) return [];
  const out: string[] = [];
  const tools = req.tools;
  if (Array.isArray(tools)) {
    for (const t of tools) {
      if (!isObj(t)) continue;
      // OpenAI: { type: "function", function: { name } }
      if (isObj(t.function) && typeof t.function.name === "string") {
        out.push(t.function.name);
        continue;
      }
      // Anthropic: { name }
      if (typeof t.name === "string") {
        out.push(t.name);
      }
    }
  }
  return out;
}

function buildCurl(r: RequestDetail): string {
  const body = isObj(r.request) ? JSON.stringify(r.request, null, 2) : "{}";
  const escaped = body.replace(/'/g, "'\\''");
  return [
    "curl http://localhost:8080/v1/chat/completions \\",
    `  -H 'Content-Type: application/json' \\`,
    `  -H 'x-nebula-session: ${r.session_id}' \\`,
    r.user_id ? `  -H 'x-nebula-user: ${r.user_id}' \\` : null,
    `  -d '${escaped}'`,
  ]
    .filter(Boolean)
    .join("\n");
}
