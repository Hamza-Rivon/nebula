import { useMemo, useState } from "react";
import type { JsonValue, RequestDetail, ToolCall } from "../api";

// =============================================================================
// Types
// =============================================================================

type InputCounts = {
  system: number;
  user: number;
  assistant: number;
  tool: number;
};

type OutputBlock = {
  kind: "text" | "tool_use" | "thinking";
  count: number;
};

type ToolMarker = {
  name: string;
  callId: string;
  argsPreview: string;
};

// =============================================================================
// Helpers
// =============================================================================

function isObj(v: unknown): v is Record<string, JsonValue> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function fmtMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const sec = Math.round((ms % 60_000) / 1000);
  return `${m}m ${sec}s`;
}

function fmtTokens(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

function argsPreviewFor(args: JsonValue | string | undefined): string {
  if (args == null) return "(no args)";
  let obj: JsonValue | string = args;
  if (typeof args === "string") {
    try {
      obj = JSON.parse(args);
    } catch {
      const s = args.trim();
      return s.length > 60 ? s.slice(0, 59) + "…" : s;
    }
  }
  if (isObj(obj)) {
    const keys = Object.keys(obj);
    const totalChars = JSON.stringify(obj).length;
    if (keys.length === 0) return "{}";
    const allShort = keys.every((k) => k.length <= 14);
    if (keys.length <= 4 && allShort) return `{ ${keys.join(", ")} }`;
    return `<${keys.length} args, ${totalChars} chars>`;
  }
  if (Array.isArray(obj)) return `<array, ${obj.length} items>`;
  return String(obj);
}

function countInputs(req: JsonValue): InputCounts {
  const out: InputCounts = { system: 0, user: 0, assistant: 0, tool: 0 };
  if (!isObj(req)) return out;
  // Anthropic-style top-level system
  if (req.system != null) {
    if (typeof req.system === "string" && req.system.trim()) out.system += 1;
    else if (Array.isArray(req.system) && req.system.length > 0) out.system += 1;
  }
  if (Array.isArray(req.messages)) {
    for (const m of req.messages) {
      if (!isObj(m)) continue;
      const role = typeof m.role === "string" ? m.role : "user";
      if (role === "system") out.system += 1;
      else if (role === "user") out.user += 1;
      else if (role === "assistant") out.assistant += 1;
      else if (role === "tool") out.tool += 1;
      // Anthropic user messages may carry tool_result content blocks
      if (role === "user" && Array.isArray(m.content)) {
        for (const blk of m.content) {
          if (isObj(blk) && blk.type === "tool_result") {
            out.tool += 1;
            // don't double-count user message
            break;
          }
        }
      }
    }
  }
  return out;
}

function countOutputBlocks(resp: JsonValue): OutputBlock[] {
  const counts = { text: 0, tool_use: 0, thinking: 0 };
  if (!isObj(resp)) return [];

  // Anthropic
  if (Array.isArray(resp.content)) {
    for (const blk of resp.content) {
      if (!isObj(blk)) continue;
      const t = typeof blk.type === "string" ? blk.type : "";
      if (t === "text") counts.text += 1;
      else if (t === "tool_use") counts.tool_use += 1;
      else if (t === "thinking" || t === "redacted_thinking") counts.thinking += 1;
    }
  }
  // OpenAI
  if (Array.isArray(resp.choices) && resp.choices.length > 0) {
    const first = resp.choices[0];
    if (isObj(first) && isObj(first.message)) {
      const msg = first.message;
      if (typeof msg.content === "string" && msg.content.trim()) counts.text += 1;
      else if (Array.isArray(msg.content)) {
        for (const blk of msg.content) {
          if (typeof blk === "string" && blk.trim()) counts.text += 1;
          else if (isObj(blk)) {
            const t = typeof blk.type === "string" ? blk.type : "";
            if (t === "text") counts.text += 1;
          }
        }
      }
      if (Array.isArray(msg.tool_calls)) {
        counts.tool_use += msg.tool_calls.length;
      }
    }
  }

  const out: OutputBlock[] = [];
  if (counts.text > 0) out.push({ kind: "text", count: counts.text });
  if (counts.tool_use > 0) out.push({ kind: "tool_use", count: counts.tool_use });
  if (counts.thinking > 0) out.push({ kind: "thinking", count: counts.thinking });
  return out;
}

function collectToolMarkers(detail: RequestDetail): ToolMarker[] {
  const markers: ToolMarker[] = [];
  const resp = detail.response;
  if (isObj(resp)) {
    // Anthropic: resp.content tool_use blocks (in order)
    if (Array.isArray(resp.content)) {
      for (const blk of resp.content) {
        if (isObj(blk) && blk.type === "tool_use") {
          markers.push({
            name: typeof blk.name === "string" ? blk.name : "tool",
            callId: typeof blk.id === "string" ? blk.id : "",
            argsPreview: argsPreviewFor(blk.input as JsonValue),
          });
        }
      }
    }
    // OpenAI: resp.choices[0].message.tool_calls
    if (Array.isArray(resp.choices) && resp.choices.length > 0) {
      const first = resp.choices[0];
      if (isObj(first) && isObj(first.message) && Array.isArray(first.message.tool_calls)) {
        for (const tc of first.message.tool_calls as unknown as ToolCall[]) {
          markers.push({
            name: tc.function?.name ?? "tool",
            callId: tc.id ?? "",
            argsPreview: argsPreviewFor(tc.function?.arguments),
          });
        }
      }
    }
  }
  // Fallback to detail.tool_calls if response didn't yield any
  if (markers.length === 0 && Array.isArray(detail.tool_calls)) {
    for (const tc of detail.tool_calls) {
      markers.push({
        name: tc.function?.name ?? "tool",
        callId: tc.id ?? "",
        argsPreview: argsPreviewFor(tc.function?.arguments),
      });
    }
  }
  return markers;
}

function findFirstAssistantTextEventId(detail: RequestDetail): string | null {
  // Mirrors the id scheme used by ConversationView.extractEvents for response side.
  const resp = detail.response;
  if (!isObj(resp)) return null;
  if (Array.isArray(resp.choices) && resp.choices.length > 0) {
    const first = resp.choices[0];
    if (isObj(first) && isObj(first.message)) {
      const msg = first.message;
      if (typeof msg.content === "string" && msg.content.trim()) {
        return `${detail.id}:resp`;
      }
      if (Array.isArray(msg.content)) {
        for (let bi = 0; bi < msg.content.length; bi++) {
          const blk = msg.content[bi];
          if (typeof blk === "string" && blk.trim()) {
            return `${detail.id}:resp:b${bi}`;
          }
          if (isObj(blk) && blk.type === "text") {
            return `${detail.id}:resp:b${bi}`;
          }
        }
      }
    }
  }
  if (Array.isArray(resp.content)) {
    for (let bi = 0; bi < resp.content.length; bi++) {
      const blk = resp.content[bi];
      if (isObj(blk) && blk.type === "text") {
        return `${detail.id}:resp:b${bi}`;
      }
    }
  }
  return null;
}

function findFirstToolUseEventId(detail: RequestDetail): string | null {
  const resp = detail.response;
  if (!isObj(resp)) return null;
  if (Array.isArray(resp.content)) {
    for (let bi = 0; bi < resp.content.length; bi++) {
      const blk = resp.content[bi];
      if (isObj(blk) && blk.type === "tool_use") {
        return `${detail.id}:resp:b${bi}`;
      }
    }
  }
  if (Array.isArray(resp.choices) && resp.choices.length > 0) {
    const first = resp.choices[0];
    if (isObj(first) && isObj(first.message) && Array.isArray(first.message.tool_calls)) {
      if (first.message.tool_calls.length > 0) {
        return `${detail.id}:resp:tc0`;
      }
    }
  }
  return null;
}

function scrollToEvent(eventId: string) {
  const el = document.getElementById(`ev-${eventId}`);
  if (el) {
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    // brief flash
    el.animate(
      [
        { boxShadow: "0 0 0 4px var(--color-butter)" },
        { boxShadow: "0 0 0 0 transparent" },
      ],
      { duration: 1200, easing: "ease-out" },
    );
  }
}

// =============================================================================
// Component
// =============================================================================

const OUT_BG: Record<OutputBlock["kind"], string> = {
  text: "var(--color-mint)",
  tool_use: "var(--color-peach)",
  thinking: "var(--color-lavender)",
};

const OUT_LABEL: Record<OutputBlock["kind"], string> = {
  text: "text",
  tool_use: "tool_use",
  thinking: "thinking",
};

export function RequestTimeline({ detail }: { detail: RequestDetail }) {
  const inputs = useMemo(() => countInputs(detail.request), [detail.request]);
  const outputs = useMemo(() => countOutputBlocks(detail.response), [detail.response]);
  const toolMarkers = useMemo(() => collectToolMarkers(detail), [detail]);
  const [hover, setHover] = useState<{
    marker: ToolMarker;
    px: number;
    py: number;
    cw: number;
    ch: number;
  } | null>(null);

  const latency = detail.latency_ms;
  const isError = detail.status === "error";
  const inFlight = latency == null;
  const streamed = !!detail.streamed;

  // Drawable scale: max(latency, 1000ms) so very short bars still show
  const scaleMs = Math.max(latency ?? 0, 1000);

  const halfMs = (latency ?? 0) / 2;

  // Layout values
  const STRIP_H = 96; // px
  const SIDE_PCT = 14; // % width for input/output zones

  return (
    <div className="space-y-2">
      <div
        className="relative"
        style={{ display: "flex", alignItems: "stretch", height: STRIP_H }}
      >
        {/* INPUT zone */}
        <div
          className="flex flex-col justify-center gap-1"
          style={{
            width: `${SIDE_PCT}%`,
            paddingRight: 10,
            borderRight: "3px solid var(--color-ink)",
          }}
        >
          <div className="text-[9px] font-mono uppercase opacity-50 tracking-widest">
            input
          </div>
          <div className="flex flex-wrap gap-1">
            {inputs.system > 0 && (
              <InputChip label={`system · ${inputs.system}`} bg="var(--color-mist)" />
            )}
            {inputs.user > 0 && (
              <InputChip label={`user · ${inputs.user}`} bg="var(--color-sky)" />
            )}
            {inputs.assistant > 0 && (
              <InputChip
                label={`assistant · ${inputs.assistant}`}
                bg="var(--color-mint)"
              />
            )}
            {inputs.tool > 0 && (
              <InputChip label={`tool · ${inputs.tool}`} bg="var(--color-peach)" />
            )}
            {inputs.system + inputs.user + inputs.assistant + inputs.tool === 0 && (
              <span className="font-mono text-[10px] opacity-50">—</span>
            )}
          </div>
          <div className="font-mono text-[10px] tabular-nums opacity-70">
            {fmtTokens(detail.input_tokens)} tok
          </div>
        </div>

        {/* MIDDLE zone — latency band */}
        <div
          className="relative flex-1"
          style={{ padding: "10px 12px" }}
          onMouseLeave={() => setHover(null)}
        >
          <LatencyBand
            latency={latency}
            scaleMs={scaleMs}
            isError={isError}
            inFlight={inFlight}
            streamed={streamed}
            errorMsg={detail.error}
            toolMarkers={toolMarkers}
            onHoverMarker={(m, e, container) => {
              const rect = container.getBoundingClientRect();
              setHover({
                marker: m,
                px: e.clientX - rect.left,
                py: e.clientY - rect.top,
                cw: rect.width,
                ch: rect.height,
              });
            }}
            onLeaveMarker={() => setHover(null)}
          />
          {hover && <ToolHoverCard hover={hover} />}
        </div>

        {/* OUTPUT zone */}
        <div
          className="flex flex-col justify-center gap-1"
          style={{
            width: `${SIDE_PCT}%`,
            paddingLeft: 10,
            borderLeft: "3px solid var(--color-ink)",
          }}
        >
          <div className="text-[9px] font-mono uppercase opacity-50 tracking-widest text-right">
            output
          </div>
          <div className="flex flex-wrap justify-end gap-1">
            {outputs.length === 0 ? (
              <span className="font-mono text-[10px] opacity-50">—</span>
            ) : (
              outputs.map((o) => (
                <button
                  key={o.kind}
                  type="button"
                  onClick={() => {
                    const target =
                      o.kind === "text"
                        ? findFirstAssistantTextEventId(detail)
                        : o.kind === "tool_use"
                          ? findFirstToolUseEventId(detail)
                          : null;
                    if (target) scrollToEvent(target);
                  }}
                  className="nb-chip"
                  style={{
                    background: OUT_BG[o.kind],
                    cursor: "pointer",
                    fontSize: ".64rem",
                    padding: ".1rem .45rem",
                  }}
                  title={`Jump to first ${OUT_LABEL[o.kind]} block`}
                >
                  {OUT_LABEL[o.kind]} · {o.count}
                </button>
              ))
            )}
          </div>
          <div className="font-mono text-[10px] tabular-nums opacity-70 text-right">
            {fmtTokens(detail.output_tokens)} tok
          </div>
        </div>
      </div>

      {/* Time axis */}
      <TimeAxis
        latency={latency}
        scaleMs={scaleMs}
        halfMs={halfMs}
        sidePct={SIDE_PCT}
      />

      {toolMarkers.length > 0 && (
        <div className="font-mono text-[10px] opacity-50">
          tool-call markers shown in arrival order — intra-stream timestamps not yet
          captured
        </div>
      )}
    </div>
  );
}

function InputChip({ label, bg }: { label: string; bg: string }) {
  return (
    <span
      className="nb-chip"
      style={{
        background: bg,
        fontSize: ".64rem",
        padding: ".1rem .45rem",
      }}
    >
      {label}
    </span>
  );
}

// =============================================================================
// Latency band
// =============================================================================

function LatencyBand({
  latency,
  scaleMs,
  isError,
  inFlight,
  streamed,
  errorMsg,
  toolMarkers,
  onHoverMarker,
  onLeaveMarker,
}: {
  latency: number | null;
  scaleMs: number;
  isError: boolean;
  inFlight: boolean;
  streamed: boolean;
  errorMsg: string | null;
  toolMarkers: ToolMarker[];
  onHoverMarker: (
    m: ToolMarker,
    e: React.MouseEvent,
    container: HTMLDivElement,
  ) => void;
  onLeaveMarker: () => void;
}) {
  // Bar width as % of drawable area
  const barPct = inFlight ? 100 : Math.max(2, ((latency ?? 0) / scaleMs) * 100);

  let barBg: string;
  if (isError) {
    barBg = "var(--color-rose)";
  } else if (inFlight) {
    barBg =
      "repeating-linear-gradient(45deg, var(--color-mist) 0 8px, #fff 8px 16px)";
  } else if (streamed) {
    barBg = "var(--color-mint)";
  } else {
    barBg = "var(--color-lavender)";
  }

  const containerRef = (el: HTMLDivElement | null) => {
    // no-op; we capture container via closures below
    void el;
  };

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full"
      style={{ position: "relative" }}
    >
      {/* drawable track */}
      <div
        className="relative"
        style={{
          height: "100%",
          width: "100%",
          position: "relative",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: "50%",
            transform: "translateY(-50%)",
            left: 0,
            width: `${barPct}%`,
            height: 44,
            border: "3px solid var(--color-ink)",
            borderRadius: 8,
            background: barBg,
            boxShadow: "3px 3px 0 0 var(--color-ink)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            overflow: "visible",
          }}
        >
          {/* Centered label */}
          <span
            className="font-mono tabular-nums"
            style={{
              fontSize: 12,
              fontWeight: 700,
              color: "var(--color-ink)",
              textShadow: "0 1px 0 rgba(255,255,255,0.7)",
              padding: "0 8px",
              whiteSpace: "nowrap",
              pointerEvents: "none",
            }}
          >
            {isError && errorMsg
              ? truncate(errorMsg, 60)
              : inFlight
                ? "in flight…"
                : fmtMsLabel(latency ?? 0)}
          </span>

          {/* Right-edge indicator */}
          {!inFlight && !isError && (
            <span
              style={{
                position: "absolute",
                right: 6,
                top: "50%",
                transform: "translateY(-50%)",
                pointerEvents: "none",
              }}
            >
              {streamed ? (
                <span
                  className="nb-pulse"
                  style={{
                    display: "inline-block",
                    width: 8,
                    height: 8,
                    borderRadius: 999,
                    background: "var(--color-ink)",
                  }}
                />
              ) : (
                <span
                  className="font-mono"
                  style={{ fontSize: 12, fontWeight: 800 }}
                >
                  ▸
                </span>
              )}
            </span>
          )}

          {/* Tool-call markers, evenly distributed inside the bar */}
          {toolMarkers.map((m, i) => {
            const left = ((i + 1) / (toolMarkers.length + 1)) * 100;
            return (
              <button
                key={`${m.callId || "tc"}-${i}`}
                type="button"
                onMouseEnter={(e) => {
                  const container = (e.currentTarget.parentElement
                    ?.parentElement as HTMLDivElement | null);
                  if (container) onHoverMarker(m, e, container);
                }}
                onMouseMove={(e) => {
                  const container = (e.currentTarget.parentElement
                    ?.parentElement as HTMLDivElement | null);
                  if (container) onHoverMarker(m, e, container);
                }}
                onMouseLeave={onLeaveMarker}
                title={`${m.name} · ${m.argsPreview}`}
                aria-label={`tool call ${m.name}`}
                style={{
                  position: "absolute",
                  left: `calc(${left}% - 4px)`,
                  top: "50%",
                  transform: "translateY(-50%)",
                  width: 8,
                  height: 8,
                  background: "var(--color-ink)",
                  border: "0",
                  padding: 0,
                  cursor: "pointer",
                }}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

function fmtMsLabel(ms: number): string {
  if (ms < 1000) return `${Math.round(ms).toLocaleString()} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(2)}s`;
  const m = Math.floor(ms / 60_000);
  const sec = Math.round((ms % 60_000) / 1000);
  return `${m}m ${sec}s`;
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "…";
}

// =============================================================================
// Time axis
// =============================================================================

function TimeAxis({
  latency,
  scaleMs,
  halfMs,
  sidePct,
}: {
  latency: number | null;
  scaleMs: number;
  halfMs: number;
  sidePct: number;
}) {
  const endMs = latency ?? scaleMs;
  // Position percentages within the middle-zone drawable area
  const midWidthPct = 100 - sidePct * 2;

  // The end tick sits at (latency / scaleMs) * 100 of the middle's drawable width
  const endLeftPct =
    sidePct + (Math.min(1, endMs / scaleMs) * midWidthPct);
  const halfLeftPct =
    sidePct + (Math.min(1, halfMs / scaleMs) * midWidthPct);
  const startLeftPct = sidePct;

  return (
    <div className="relative" style={{ height: 22 }}>
      {/* dashed guides */}
      <div
        style={{
          position: "absolute",
          left: `${halfLeftPct}%`,
          top: -4,
          width: 0,
          height: 8,
          borderLeft: "1px dashed rgba(17,17,17,0.25)",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: `${endLeftPct}%`,
          top: -4,
          width: 0,
          height: 8,
          borderLeft: "1px dashed rgba(17,17,17,0.25)",
        }}
      />
      <span
        className="font-mono tabular-nums"
        style={{
          position: "absolute",
          left: `${startLeftPct}%`,
          fontSize: 10,
          opacity: 0.6,
          transform: "translateX(0)",
        }}
      >
        0ms
      </span>
      <span
        className="font-mono tabular-nums"
        style={{
          position: "absolute",
          left: `${halfLeftPct}%`,
          fontSize: 10,
          opacity: 0.6,
          transform: "translateX(-50%)",
        }}
      >
        {fmtMs(halfMs)}
      </span>
      <span
        className="font-mono tabular-nums"
        style={{
          position: "absolute",
          left: `${endLeftPct}%`,
          fontSize: 10,
          opacity: 0.6,
          transform: "translateX(-100%)",
        }}
      >
        {latency == null ? "?" : fmtMs(endMs)}
      </span>
    </div>
  );
}

// =============================================================================
// Hover card
// =============================================================================

function ToolHoverCard({
  hover,
}: {
  hover: {
    marker: ToolMarker;
    px: number;
    py: number;
    cw: number;
    ch: number;
  };
}) {
  const cardW = 220;
  const cardH = 70;
  let left = hover.px + 12;
  if (left + cardW > hover.cw - 4) left = Math.max(4, hover.px - cardW - 12);
  if (left < 4) left = 4;
  let top = hover.py - cardH - 8;
  if (top < 4) top = hover.py + 14;
  if (top + cardH > hover.ch - 4) top = Math.max(4, hover.ch - cardH - 4);
  return (
    <div
      className="nb-card-flat pointer-events-none absolute z-20 p-2 font-mono text-[11px]"
      style={{
        left,
        top,
        background: "#fff",
        width: cardW,
      }}
    >
      <div className="truncate font-bold">tool: {hover.marker.name}</div>
      <div className="mt-0.5 truncate opacity-70">{hover.marker.argsPreview}</div>
      {hover.marker.callId && (
        <div className="mt-1 truncate opacity-50">{hover.marker.callId}</div>
      )}
    </div>
  );
}
