import { useMemo, useState } from "react";
import type { JsonValue, RequestDetail, ToolCall } from "../api";
import { Markdown } from "./Markdown";

// =============================================================================
// Types
// =============================================================================

type Role = "system" | "user" | "assistant" | "tool" | "tool_result" | "thinking";

type EventBase = {
  id: string;
  role: Role;
  // millisecond offset from t0 (request start). For the demo we anchor
  // user inputs to t0 and outputs (text/tool_use/result) to finished_at,
  // because we don't have intra-stream timestamps.
  offsetMs: number;
};

export type ConvEvent =
  | (EventBase & { kind: "text"; text: string; markdown: boolean })
  | (EventBase & { kind: "thinking"; text: string; redacted: boolean })
  | (EventBase & {
      kind: "tool_use";
      toolName: string;
      toolCallId: string;
      args: JsonValue | string;
    })
  | (EventBase & {
      kind: "tool_result";
      toolCallId: string;
      content: JsonValue | string;
      isError: boolean;
    })
  | (EventBase & {
      kind: "image";
      mediaType?: string;
      width?: number;
      height?: number;
    });

const ROLE_BG: Record<Role, string> = {
  system: "var(--color-mist)",
  user: "var(--color-sky)",
  assistant: "var(--color-mint)",
  tool: "var(--color-peach)",
  tool_result: "var(--color-peach)",
  thinking: "var(--color-lavender)",
};

const ROLE_LABEL: Record<Role, string> = {
  system: "SYSTEM",
  user: "USER",
  assistant: "ASSISTANT",
  tool: "TOOL",
  tool_result: "TOOL",
  thinking: "THINKING",
};

// Tinted (10% opacity) background for expanded rows
const ROLE_TINT: Record<Role, string> = {
  system: "rgba(242, 238, 224, 0.45)",
  user: "rgba(160, 231, 255, 0.25)",
  assistant: "rgba(184, 245, 201, 0.25)",
  tool: "rgba(255, 183, 168, 0.25)",
  tool_result: "rgba(255, 183, 168, 0.25)",
  thinking: "rgba(200, 182, 255, 0.25)",
};

// =============================================================================
// Type guards
// =============================================================================

function isObj(v: unknown): v is Record<string, JsonValue> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function asString(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

function looksLikeMarkdown(s: string): boolean {
  if (!s) return false;
  return (
    /(^|\n)#{1,6}\s/.test(s) ||
    /\*\*[^*]+\*\*/.test(s) ||
    /```/.test(s) ||
    /(^|\n)\s*[-*]\s+/.test(s) ||
    /\[[^\]]+\]\([^)]+\)/.test(s)
  );
}

function prettyArgs(v: JsonValue | string | undefined): string {
  if (v == null) return "(no args)";
  if (typeof v === "string") {
    try {
      return JSON.stringify(JSON.parse(v), null, 2);
    } catch {
      return v;
    }
  }
  return JSON.stringify(v, null, 2);
}

/** Extract a useful one-line preview from a (possibly multi-paragraph, code-fenced) text blob. */
export function firstLine(s: string, maxLen = 120): string {
  if (!s) return "";
  // Strip leading whitespace & code fences
  let cleaned = s.replace(/^\s+/, "");
  cleaned = cleaned.replace(/^```[a-zA-Z0-9_-]*\s*\n?/, "");
  // Take first non-empty line
  const lines = cleaned.split(/\r?\n/);
  let line = "";
  for (const l of lines) {
    const t = l.trim();
    if (t && !/^```/.test(t)) {
      line = t;
      break;
    }
  }
  if (!line) line = cleaned.trim();
  if (line.length <= maxLen) return line;
  return line.slice(0, maxLen - 1).trimEnd() + "…";
}

function argsPreview(args: JsonValue | string | undefined): string {
  if (args == null) return "(no args)";
  let obj: JsonValue | string = args;
  if (typeof args === "string") {
    try {
      obj = JSON.parse(args);
    } catch {
      const s = args.trim();
      return s.length > 80 ? s.slice(0, 79) + "…" : s;
    }
  }
  if (isObj(obj)) {
    const keys = Object.keys(obj);
    const totalChars = JSON.stringify(obj).length;
    const allShort = keys.every((k) => k.length <= 16);
    if (keys.length === 0) return "{}";
    if (keys.length <= 4 && allShort) {
      return `{ ${keys.join(", ")} }`;
    }
    return `<${keys.length} args, ${totalChars} chars>`;
  }
  if (Array.isArray(obj)) {
    return `<array, ${obj.length} items>`;
  }
  return String(obj);
}

function toolResultPreview(content: JsonValue | string): { text: string; chars: number } {
  let raw = "";
  if (typeof content === "string") {
    raw = content;
  } else if (Array.isArray(content)) {
    raw = content
      .map((b) => {
        if (typeof b === "string") return b;
        if (isObj(b) && typeof b.text === "string") return b.text;
        return asString(b);
      })
      .join("\n\n");
  } else {
    raw = asString(content);
  }
  return { text: firstLine(raw, 120), chars: raw.length };
}

// =============================================================================
// Event extraction from raw provider payloads
// =============================================================================

/** Extract events from a single RequestDetail. Returns events in conversation order. */
export function extractEvents(detail: RequestDetail): ConvEvent[] {
  const events: ConvEvent[] = [];
  const t0 = detail.started_at;
  const tEnd = detail.finished_at ?? detail.started_at;
  const reqOffset = 0;
  const respOffset = Math.max(0, tEnd - t0);

  const req = detail.request;
  const resp = detail.response;

  // ---- system (Anthropic top-level) ----
  if (isObj(req) && req.system != null) {
    const sys = req.system;
    if (typeof sys === "string" && sys.trim()) {
      events.push({
        id: `${detail.id}:sys`,
        kind: "text",
        role: "system",
        offsetMs: reqOffset,
        text: sys,
        markdown: looksLikeMarkdown(sys),
      });
    } else if (Array.isArray(sys)) {
      const joined = sys
        .map((b) => (isObj(b) && typeof b.text === "string" ? b.text : ""))
        .filter(Boolean)
        .join("\n\n");
      if (joined.trim()) {
        events.push({
          id: `${detail.id}:sys`,
          kind: "text",
          role: "system",
          offsetMs: reqOffset,
          text: joined,
          markdown: looksLikeMarkdown(joined),
        });
      }
    }
  }

  // ---- request.messages (both shapes) ----
  if (isObj(req) && Array.isArray(req.messages)) {
    req.messages.forEach((m, mi) => {
      if (!isObj(m)) return;
      const role = (typeof m.role === "string" ? m.role : "user") as string;
      const baseId = `${detail.id}:m${mi}`;

      // OpenAI tool message: role=tool, content is string, tool_call_id present.
      if (role === "tool") {
        events.push({
          id: baseId,
          kind: "tool_result",
          role: "tool_result",
          offsetMs: reqOffset,
          toolCallId: typeof m.tool_call_id === "string" ? m.tool_call_id : "",
          content: (m.content ?? "") as JsonValue,
          isError: false,
        });
        return;
      }

      // Generic content handling.
      const content = m.content;
      if (typeof content === "string") {
        if (content.trim()) {
          events.push({
            id: baseId,
            kind: "text",
            role: normalizeRole(role),
            offsetMs: reqOffset,
            text: content,
            markdown: looksLikeMarkdown(content),
          });
        }
      } else if (Array.isArray(content)) {
        content.forEach((blk, bi) => {
          pushBlock(events, blk, normalizeRole(role), `${baseId}:b${bi}`, reqOffset);
        });
      }

      // OpenAI assistant tool_calls on request side.
      if (Array.isArray(m.tool_calls)) {
        (m.tool_calls as unknown as ToolCall[]).forEach((tc, ti) => {
          events.push({
            id: `${baseId}:tc${ti}`,
            kind: "tool_use",
            role: "tool",
            offsetMs: reqOffset,
            toolName: tc.function?.name ?? "tool",
            toolCallId: tc.id ?? `tc-${mi}-${ti}`,
            args: (tc.function?.arguments ?? "") as JsonValue | string,
          });
        });
      }
    });
  }

  // ---- response (both shapes) ----
  if (isObj(resp)) {
    // OpenAI: response.choices[0].message
    if (Array.isArray(resp.choices) && resp.choices.length > 0) {
      const first = resp.choices[0];
      if (isObj(first) && isObj(first.message)) {
        const msg = first.message;
        const role = typeof msg.role === "string" ? msg.role : "assistant";
        const content = msg.content;
        if (typeof content === "string" && content.trim()) {
          events.push({
            id: `${detail.id}:resp`,
            kind: "text",
            role: normalizeRole(role),
            offsetMs: respOffset,
            text: content,
            markdown: looksLikeMarkdown(content),
          });
        } else if (Array.isArray(content)) {
          content.forEach((blk, bi) => {
            pushBlock(events, blk, normalizeRole(role), `${detail.id}:resp:b${bi}`, respOffset);
          });
        }
        if (Array.isArray(msg.tool_calls)) {
          (msg.tool_calls as unknown as ToolCall[]).forEach((tc, ti) => {
            events.push({
              id: `${detail.id}:resp:tc${ti}`,
              kind: "tool_use",
              role: "tool",
              offsetMs: respOffset,
              toolName: tc.function?.name ?? "tool",
              toolCallId: tc.id ?? `resp-tc-${ti}`,
              args: (tc.function?.arguments ?? "") as JsonValue | string,
            });
          });
        }
      }
    }
    // Anthropic: response.content (array of blocks)
    if (Array.isArray(resp.content)) {
      resp.content.forEach((blk, bi) => {
        pushBlock(events, blk, "assistant", `${detail.id}:resp:b${bi}`, respOffset);
      });
    }
  }

  return events;
}

function normalizeRole(r: string): Role {
  if (r === "system" || r === "user" || r === "assistant") return r;
  if (r === "tool") return "tool_result";
  return "assistant";
}

function pushBlock(
  out: ConvEvent[],
  blk: JsonValue,
  role: Role,
  id: string,
  offsetMs: number,
) {
  if (typeof blk === "string") {
    if (blk.trim()) {
      out.push({
        id,
        kind: "text",
        role,
        offsetMs,
        text: blk,
        markdown: looksLikeMarkdown(blk),
      });
    }
    return;
  }
  if (!isObj(blk)) return;
  const t = typeof blk.type === "string" ? blk.type : "";
  switch (t) {
    case "text": {
      const text = typeof blk.text === "string" ? blk.text : asString(blk.text);
      if (text.trim()) {
        out.push({
          id,
          kind: "text",
          role,
          offsetMs,
          text,
          markdown: looksLikeMarkdown(text),
        });
      }
      return;
    }
    case "thinking":
    case "redacted_thinking": {
      const text =
        typeof blk.thinking === "string"
          ? blk.thinking
          : typeof blk.text === "string"
            ? blk.text
            : asString(blk.data ?? blk.thinking ?? "");
      out.push({
        id,
        kind: "thinking",
        role: "thinking",
        offsetMs,
        text,
        redacted: t === "redacted_thinking",
      });
      return;
    }
    case "tool_use": {
      out.push({
        id,
        kind: "tool_use",
        role: "tool",
        offsetMs,
        toolName: typeof blk.name === "string" ? blk.name : "tool",
        toolCallId: typeof blk.id === "string" ? blk.id : id,
        args: (blk.input ?? {}) as JsonValue,
      });
      return;
    }
    case "tool_result": {
      out.push({
        id,
        kind: "tool_result",
        role: "tool_result",
        offsetMs,
        toolCallId:
          typeof blk.tool_use_id === "string"
            ? blk.tool_use_id
            : typeof blk.tool_call_id === "string"
              ? blk.tool_call_id
              : "",
        content: (blk.content ?? "") as JsonValue,
        isError: blk.is_error === true,
      });
      return;
    }
    case "image": {
      const src = isObj(blk.source) ? blk.source : null;
      out.push({
        id,
        kind: "image",
        role,
        offsetMs,
        mediaType:
          src && typeof src.media_type === "string" ? src.media_type : undefined,
      });
      return;
    }
    default: {
      // Unknown block type — fall back to a JSON dump as a "text" block but
      // keep it monospace by NOT rendering markdown.
      out.push({
        id,
        kind: "text",
        role,
        offsetMs,
        text: asString(blk),
        markdown: false,
      });
    }
  }
}

// =============================================================================
// Formatting helpers
// =============================================================================

function fmtOffset(ms: number): string {
  if (ms < 1000) return `+${ms}ms`;
  return `+${(ms / 1000).toFixed(1)}s`;
}

// =============================================================================
// Components
// =============================================================================

export function ConversationView({
  events,
  caption,
}: {
  events: ConvEvent[];
  caption?: string;
}) {
  // Per-event expand state, stable across re-renders within this view.
  const [expanded, setExpanded] = useState<Map<string, boolean>>(new Map());
  // Default ON: hide system prompts.
  const [hideSystem, setHideSystem] = useState(true);
  // Tracks override for "show system anyway" when hideSystem is true.
  const [systemRevealed, setSystemRevealed] = useState(false);

  const systemEvents = useMemo(
    () => events.filter((e) => e.role === "system"),
    [events],
  );
  const visibleEvents = useMemo(() => {
    if (hideSystem && !systemRevealed) {
      return events.filter((e) => e.role !== "system");
    }
    return events;
  }, [events, hideSystem, systemRevealed]);

  if (events.length === 0) {
    return <div className="text-sm opacity-60">No conversation events captured.</div>;
  }

  const setOne = (id: string, val: boolean) => {
    setExpanded((prev) => {
      const next = new Map(prev);
      next.set(id, val);
      return next;
    });
  };

  const expandAll = () => {
    const next = new Map<string, boolean>();
    for (const ev of events) next.set(ev.id, true);
    setExpanded(next);
  };
  const collapseAll = () => setExpanded(new Map());

  return (
    <div className="space-y-2">
      {/* group controls */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={expandAll}
          className="nb-btn"
          data-variant="ghost"
          style={{ padding: ".3rem .65rem", fontSize: ".75rem" }}
        >
          Expand all
        </button>
        <button
          type="button"
          onClick={collapseAll}
          className="nb-btn"
          data-variant="ghost"
          style={{ padding: ".3rem .65rem", fontSize: ".75rem" }}
        >
          Collapse all
        </button>
        <button
          type="button"
          onClick={() => {
            setHideSystem((v) => !v);
            setSystemRevealed(false);
          }}
          className="nb-btn"
          data-variant="ghost"
          style={{
            padding: ".3rem .65rem",
            fontSize: ".75rem",
            background: hideSystem ? "var(--color-mist)" : "transparent",
            borderColor: "var(--color-ink)",
            boxShadow: hideSystem ? "3px 3px 0 0 var(--color-ink)" : "none",
          }}
        >
          {hideSystem ? "System: hidden" : "System: shown"}
        </button>
        <span className="ml-auto font-mono text-[10px] opacity-50">
          {events.length} event{events.length === 1 ? "" : "s"}
        </span>
      </div>

      {/* hidden-system one-liner */}
      {hideSystem && !systemRevealed && systemEvents.length > 0 && (
        <button
          type="button"
          onClick={() => setSystemRevealed(true)}
          className="nb-card-flat block w-full p-2 text-left font-mono text-[11px] hover:bg-[var(--color-mist)]"
          style={{ background: "#fff", borderStyle: "dashed", cursor: "pointer" }}
        >
          system prompts hidden · {systemEvents.length} message
          {systemEvents.length === 1 ? "" : "s"} · click to show
        </button>
      )}

      <ul className="space-y-1.5">
        {visibleEvents.map((ev) => (
          <li key={ev.id}>
            <EventRow
              ev={ev}
              expanded={expanded.get(ev.id) === true}
              onToggle={() => setOne(ev.id, !(expanded.get(ev.id) === true))}
            />
          </li>
        ))}
      </ul>
      {caption && (
        <div className="mt-3 text-[11px] italic opacity-50">{caption}</div>
      )}
    </div>
  );
}

// =============================================================================
// EventRow — collapsible single row
// =============================================================================

function EventRow({
  ev,
  expanded,
  onToggle,
}: {
  ev: ConvEvent;
  expanded: boolean;
  onToggle: () => void;
}) {
  const role = ev.role;
  const roleColor = ROLE_BG[role];
  const summary = useMemo(() => buildSummary(ev), [ev]);
  const isImage = ev.kind === "image";
  const isThinking = ev.kind === "thinking";

  const headerStyle: React.CSSProperties = {
    background: expanded ? ROLE_TINT[role] : "#fff",
    borderColor: "var(--color-ink)",
    borderLeft: `8px solid ${roleColor}`,
    borderStyle: isThinking ? "dashed" : "solid",
  };

  const label = isImage ? "IMG" : ROLE_LABEL[role];

  return (
    <div
      id={`ev-${ev.id}`}
      className="nb-card-flat"
      style={{ ...headerStyle, padding: 0, overflow: "hidden", scrollMarginTop: 80 }}
    >
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left"
        style={{ cursor: "pointer", background: "transparent" }}
        aria-expanded={expanded}
      >
        <span
          className="flex-shrink-0 font-mono text-[10px] font-bold"
          style={{
            background: roleColor,
            border: "2px solid var(--color-ink)",
            borderRadius: 4,
            padding: "0 .35rem",
            letterSpacing: ".05em",
          }}
        >
          {label}
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-[12px]">
          {summary}
        </span>
        <span className="flex-shrink-0 font-mono text-[10px] opacity-50 tabular-nums">
          {fmtOffset(ev.offsetMs)}
        </span>
        <span
          className="flex-shrink-0 font-mono text-[11px] opacity-60"
          aria-hidden
        >
          {expanded ? "▾" : "▸"}
        </span>
      </button>
      {expanded && (
        <div
          className="border-t-[3px] border-[var(--color-ink)] p-3"
          style={{ background: "#fff" }}
        >
          <ExpandedBody ev={ev} />
        </div>
      )}
    </div>
  );
}

function buildSummary(ev: ConvEvent): string {
  switch (ev.kind) {
    case "text":
      return firstLine(ev.text, 120) || "(empty)";
    case "thinking":
      return firstLine(ev.text, 80) || (ev.redacted ? "(redacted reasoning)" : "(empty reasoning)");
    case "tool_use":
      return `tool: ${ev.toolName} · ${argsPreview(ev.args)}`;
    case "tool_result": {
      const { text, chars } = toolResultPreview(ev.content);
      const prefix = ev.isError ? "error · " : "";
      const body = text || "(empty)";
      return `${prefix}${body} · ${chars} chars`;
    }
    case "image": {
      const parts = ["image"];
      if (ev.mediaType) parts.push(ev.mediaType);
      if (ev.width && ev.height) parts.push(`${ev.width}×${ev.height}`);
      return parts.join(" · ");
    }
  }
}

// =============================================================================
// Expanded body — capped at 480px with "Show all" affordance
// =============================================================================

function ExpandedBody({ ev }: { ev: ConvEvent }) {
  const [uncapped, setUncapped] = useState(false);
  const maxStyle: React.CSSProperties = uncapped
    ? {}
    : { maxHeight: 480, overflow: "auto" };

  let body: React.ReactNode = null;

  if (ev.kind === "text") {
    body = ev.markdown ? (
      <Markdown source={ev.text} />
    ) : (
      <pre className="whitespace-pre-wrap break-words font-display text-sm">{ev.text}</pre>
    );
  } else if (ev.kind === "thinking") {
    body = (
      <pre className="whitespace-pre-wrap break-words font-mono text-xs">
        {ev.text || "(no reasoning content)"}
      </pre>
    );
  } else if (ev.kind === "tool_use") {
    const pretty = prettyArgs(ev.args);
    body = (
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="nb-tag">tool · {ev.toolName}</span>
          {ev.toolCallId && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                const el = document.getElementById(`tr-${ev.toolCallId}`);
                if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
              }}
              className="font-mono text-[10px] opacity-60 underline-offset-2 hover:underline"
              title="Jump to result"
            >
              {ev.toolCallId.slice(0, 18)}
              {ev.toolCallId.length > 18 ? "…" : ""}
            </button>
          )}
        </div>
        <pre
          id={`tu-${ev.toolCallId}`}
          className="scrollbar-soft overflow-auto rounded border-2 border-[var(--color-ink)] bg-[var(--color-mist)] p-2 font-mono text-[11px]"
        >
          {pretty}
        </pre>
      </div>
    );
  } else if (ev.kind === "tool_result") {
    const c = ev.content;
    let rendered = "";
    if (Array.isArray(c)) {
      rendered = c
        .map((b) => {
          if (typeof b === "string") return b;
          if (isObj(b) && typeof b.text === "string") return b.text;
          return asString(b);
        })
        .join("\n\n");
    } else if (typeof c === "string") {
      rendered = c;
    } else {
      rendered = asString(c);
    }
    const isMd = looksLikeMarkdown(rendered);
    body = (
      <div
        id={`tr-${ev.toolCallId}`}
        className="space-y-2"
      >
        <div className="flex flex-wrap items-center gap-2">
          <span
            className="nb-tag"
            style={{ background: ev.isError ? "var(--color-rose)" : "#fff" }}
          >
            {ev.isError ? "tool error" : "tool result"}
          </span>
          {ev.toolCallId && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                const el = document.getElementById(`tu-${ev.toolCallId}`);
                if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
              }}
              className="font-mono text-[10px] opacity-60 underline-offset-2 hover:underline"
              title="Jump to call"
            >
              ↑ {ev.toolCallId.slice(0, 18)}
              {ev.toolCallId.length > 18 ? "…" : ""}
            </button>
          )}
        </div>
        {isMd ? (
          <div className="rounded border-2 border-[var(--color-ink)] bg-[var(--color-mist)] p-2">
            <Markdown source={rendered} />
          </div>
        ) : (
          <pre className="scrollbar-soft overflow-auto whitespace-pre-wrap break-words rounded border-2 border-[var(--color-ink)] bg-[var(--color-mist)] p-2 font-mono text-[11px]">
            {rendered || "(empty result)"}
          </pre>
        )}
      </div>
    );
  } else {
    // image
    body = (
      <div className="text-sm">
        <span className="nb-tag">image</span>
        {ev.mediaType && <span className="ml-2 font-mono text-xs">{ev.mediaType}</span>}
        {ev.width && ev.height && (
          <span className="ml-2 font-mono text-xs opacity-60">
            {ev.width}×{ev.height}
          </span>
        )}
      </div>
    );
  }

  return (
    <div>
      <div style={maxStyle} className={uncapped ? "" : "scrollbar-soft"}>
        {body}
      </div>
      {!uncapped && (
        <ShowAllAffordance onClick={() => setUncapped(true)} />
      )}
    </div>
  );
}

/** Renders a "Show all" button only if the parent body actually overflowed. */
function ShowAllAffordance({ onClick }: { onClick: () => void }) {
  // Always show as a small unobtrusive control — cap is 480 so anything
  // longer benefits, anything shorter still works fine and the button is harmless.
  return (
    <div className="mt-2 flex">
      <button
        type="button"
        onClick={onClick}
        className="nb-chip"
        style={{ cursor: "pointer", background: "var(--color-butter)" }}
      >
        Show all
      </button>
    </div>
  );
}
