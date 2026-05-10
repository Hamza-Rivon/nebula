// Single EventSource shared across the whole UI. Pages call subscribeLive()
// to react to proxy events (request captured, etc.). The connection is
// opened lazily on first subscribe and reconnects on hard close.
//
// EventSource auto-reconnects on transient errors; we only manually recreate
// when the browser puts the source into the CLOSED state.

export type LiveRequestEvent = {
  type: "request";
  request_id: string;
  session_id: string;
  user_id: string | null;
  provider: string;
  model: string;
  status: "ok" | "error";
  cost: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  latency_ms: number | null;
  started_at: number;
  finished_at: number | null;
};

export type LiveJob = {
  id: string;
  scope: string;
  status: "queued" | "running" | "done" | "error" | "cancelled";
  stage: string | null;
  total: number | null;
  done: number | null;
  error: string | null;
  started_at: number;
  finished_at: number | null;
};

export type LiveJobEvent = { type: "job"; job: LiveJob };
export type LiveJobDeletedEvent = { type: "job_deleted"; id: string };
// Backend emits this once when a fan-out adds many job rows in one shot
// (e.g. "Re-analyze all" inserts 1k+ session tasks). The bridge translates
// it into a single throttled invalidate, which avoids the per-row event
// storm that used to hang the browser during a manual fan-out.
export type LiveJobsBulkChangedEvent = {
  type: "jobs_bulk_changed";
  count: number;
};
// The proxy emits these as session-level analyze tasks complete and as the
// cross-corpus rollup finishes. The bridge uses them to patch the Insights
// dataset cache progressively, so users watch sessions land instead of
// staring at a spinner.
export type LiveSessionAnalyzedEvent = {
  type: "session_analyzed";
  // SessionMeta — typed as `unknown` here so the live-event surface stays
  // schema-free; the bridge casts to the dashboard's shared shape.
  session: unknown;
};
export type LiveAggregatesUpdatedEvent = { type: "aggregates_updated" };

export type LiveEvent =
  | LiveRequestEvent
  | LiveJobEvent
  | LiveJobDeletedEvent
  | LiveJobsBulkChangedEvent
  | LiveSessionAnalyzedEvent
  | LiveAggregatesUpdatedEvent
  | { type: "ping" };

type Handler = (e: LiveEvent) => void;
type OpenHandler = (info: { reconnect: boolean }) => void;

const subscribers = new Set<Handler>();
const openSubscribers = new Set<OpenHandler>();
let es: EventSource | null = null;
let reconnectTimer: number | null = null;
// Tracks whether we've ever observed a successful EventSource open. The first
// open is the initial connection; every subsequent one is a reconnect after
// a drop (proxy restart, sleep/wake, transient network failure). Subscribers
// use this signal to refetch state — events that fired while the stream was
// down are not replayed by the browser.
let everConnected = false;

function connect(): void {
  if (es) return;
  try {
    es = new EventSource("/api/events");
  } catch {
    scheduleReconnect();
    return;
  }
  es.onopen = () => {
    const reconnect = everConnected;
    everConnected = true;
    for (const cb of openSubscribers) {
      try {
        cb({ reconnect });
      } catch {
        // never let a bad subscriber break the bus
      }
    }
  };
  es.onmessage = (msg) => {
    if (!msg.data) return;
    let parsed: LiveEvent;
    try {
      parsed = JSON.parse(msg.data) as LiveEvent;
    } catch {
      return;
    }
    for (const cb of subscribers) {
      try {
        cb(parsed);
      } catch {
        // never let a bad subscriber break the bus
      }
    }
  };
  es.onerror = () => {
    // EventSource automatically retries; only intervene when it gives up.
    if (!es) return;
    if (es.readyState === EventSource.CLOSED) {
      es.close();
      es = null;
      scheduleReconnect();
    }
  };
}

function scheduleReconnect(): void {
  if (reconnectTimer != null) return;
  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = null;
    if (subscribers.size > 0) connect();
  }, 2000);
}

export function subscribeLive(cb: Handler): () => void {
  subscribers.add(cb);
  connect();
  return () => {
    subscribers.delete(cb);
    // Keep the connection open even if subscribers temporarily hits 0 — the
    // user might be navigating between tabs and we'd rather avoid teardown
    // churn for sub-second gaps.
  };
}

// Subscribe to EventSource open transitions. The handler receives
// `{ reconnect: true }` after the stream successfully reopens following a
// disconnect, and `{ reconnect: false }` on the very first connection. This
// is the hook to use when you need to resync server state that may have
// changed silently while the SSE channel was down.
export function subscribeOpen(cb: OpenHandler): () => void {
  openSubscribers.add(cb);
  connect();
  return () => {
    openSubscribers.delete(cb);
  };
}
