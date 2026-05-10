// In-memory pub/sub for live UI updates over Server-Sent Events.
//
// The gateway calls `publishEvent` after persisting a request; the
// `/api/events` route in api.ts holds an open SSE connection per UI client
// and relays each event as `data: <json>\n\n`.
//
// Single-process only — there's no fan-out across replicas. That's fine for
// Nebula's single-binary deployment model.

type Subscriber = (chunk: string) => void;

const subscribers = new Set<Subscriber>();

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

export type LiveEvent =
  | {
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
    }
  | { type: "job"; job: LiveJob }
  | { type: "job_deleted"; id: string }
  | { type: "ping" };

export function publishEvent(event: LiveEvent): void {
  const chunk = `data: ${JSON.stringify(event)}\n\n`;
  for (const cb of subscribers) {
    try {
      cb(chunk);
    } catch {
      // A failed write usually means the client disconnected; the route's
      // own cleanup will remove the subscriber on the next abort signal.
    }
  }
}

export function subscribe(cb: Subscriber): () => void {
  subscribers.add(cb);
  return () => subscribers.delete(cb);
}

export function subscriberCount(): number {
  return subscribers.size;
}
