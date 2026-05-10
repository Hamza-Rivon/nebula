// Single bridge between the SSE event stream and the React Query cache.
// Mounted once at the app root. Each event invalidates the relevant key roots;
// active queries refetch in the background, idle queries get refetched the
// next time they're observed.
//
// Throttled to coalesce bursts (50 captured requests/s should result in maybe
// 2 invalidation passes, not 50).

import { useEffect, useRef, useState } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import {
  subscribeLive,
  subscribeOpen,
  type LiveEvent,
  type LiveJob,
} from "./liveEvents";
import { qk } from "./queries";
import type { Dataset, Job, SessionMeta } from "./insights/types";

const THROTTLE_MS = 600;

function invalidateForRequestEvent(qc: QueryClient): void {
  qc.invalidateQueries({ queryKey: qk.requests.root });
  qc.invalidateQueries({ queryKey: qk.sessions.root });
  qc.invalidateQueries({ queryKey: qk.tools.root });
  qc.invalidateQueries({ queryKey: qk.users.root });
  qc.invalidateQueries({ queryKey: qk.stats });
  qc.invalidateQueries({ queryKey: qk.latency });
  qc.invalidateQueries({ queryKey: ["timeseries"] });
  qc.invalidateQueries({ queryKey: ["heatmap"] });
}

// On SSE reconnect, the cache may be stale: we missed every event that
// fired while the stream was down (proxy restart, sleep/wake, etc.). Hit
// every live-driven root key so React Query refetches the truth from the
// proxy. The classic symptom this fixes: a job that errored while we were
// disconnected stays "running" in the UI forever.
function invalidateForReconnect(qc: QueryClient): void {
  qc.invalidateQueries({ queryKey: qk.jobs.root });
  qc.invalidateQueries({ queryKey: qk.requests.root });
  qc.invalidateQueries({ queryKey: qk.sessions.root });
  qc.invalidateQueries({ queryKey: qk.tools.root });
  qc.invalidateQueries({ queryKey: qk.users.root });
  qc.invalidateQueries({ queryKey: qk.stats });
  qc.invalidateQueries({ queryKey: qk.latency });
  qc.invalidateQueries({ queryKey: qk.insights.root });
  qc.invalidateQueries({ queryKey: ["timeseries"] });
  qc.invalidateQueries({ queryKey: ["heatmap"] });
}

// Job events carry the full row, so we patch the cache directly — no extra
// HTTP roundtrip — and the Jobs page updates instantly. We also patch the
// per-id detail key for the analyze polling in Layout.
function applyJobEvent(qc: QueryClient, job: LiveJob): void {
  qc.setQueryData<Job>(qk.jobs.detail(job.id), job as Job);
  qc.setQueryData<{ jobs: Job[] } | undefined>(
    qk.jobs.list,
    (prev) => {
      const next = prev?.jobs ? [...prev.jobs] : [];
      const idx = next.findIndex((j) => j.id === job.id);
      if (idx >= 0) next[idx] = job as Job;
      else next.unshift(job as Job);
      // Recent first; mirrors `selectRecentStmt` ORDER BY started_at DESC.
      next.sort((a, b) => b.started_at - a.started_at);
      return { jobs: next };
    },
  );
  // The Layout polls a single ["jobs", id] key for the active analyze; keep
  // it in sync too so the sidebar progress chip updates without polling.
  qc.setQueryData<Job | null>(["jobs", job.id], job as Job);
  // When an analyze pass terminates, the dataset has changed.
  if (job.status === "done") {
    qc.invalidateQueries({ queryKey: qk.insights.root });
  }
}

// Patch the cached Insights Dataset with a freshly analyzed session so the
// page re-renders without a refetch. Upserts the session by id, bumps user
// totals optimistically, and recomputes a few corpus-wide counters live.
// The rollup pass overwrites everything with authoritative numbers — these
// patches only need to look right between checkpoints.
function applySessionAnalyzedEvent(qc: QueryClient, raw: unknown): void {
  if (!raw || typeof raw !== "object") return;
  const session = raw as SessionMeta;
  qc.setQueryData<Dataset | null | undefined>(qk.insights.dataset, (prev) => {
    if (!prev) {
      // No dataset cached yet — invalidate so the next read pulls the fresh
      // partial dataset that now exists server-side.
      qc.invalidateQueries({ queryKey: qk.insights.root });
      return prev;
    }
    const idx = prev.sessions.findIndex((s) => s.sessionId === session.sessionId);
    const sessions =
      idx >= 0
        ? prev.sessions.map((s, i) => (i === idx ? session : s))
        : [...prev.sessions, session];
    const next: Dataset = {
      ...prev,
      sessions,
      aggregates: {
        ...prev.aggregates,
        totalSessions: sessions.length,
      },
    };
    return next;
  });
}

function applyJobDeletedEvent(qc: QueryClient, id: string): void {
  qc.setQueryData<{ jobs: Job[] } | undefined>(qk.jobs.list, (prev) => {
    if (!prev?.jobs) return prev;
    return { jobs: prev.jobs.filter((j) => j.id !== id) };
  });
  qc.removeQueries({ queryKey: qk.jobs.detail(id), exact: true });
  qc.removeQueries({ queryKey: ["jobs", id], exact: true });
}

export function useLiveBridge(): void {
  const qc = useQueryClient();
  const pendingRef = useRef(false);
  const timerRef = useRef<number | null>(null);
  // Job events fire fast during a fan-out (1358 session tasks → 1358 status
  // transitions). The Jobs page now uses paged query keys, so direct cache
  // patching only covers the legacy unfiltered key. Throttle a root-level
  // invalidation here so paged views refetch a page or two per second
  // instead of on every event.
  const jobInvalidatePendingRef = useRef(false);
  const jobInvalidateTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const flush = () => {
      timerRef.current = null;
      pendingRef.current = false;
      invalidateForRequestEvent(qc);
    };
    const flushJobs = () => {
      jobInvalidateTimerRef.current = null;
      jobInvalidatePendingRef.current = false;
      qc.invalidateQueries({ queryKey: qk.jobs.root });
    };
    const onEvent = (e: LiveEvent) => {
      if (e.type === "job") {
        applyJobEvent(qc, e.job);
        if (!jobInvalidatePendingRef.current) {
          jobInvalidatePendingRef.current = true;
          jobInvalidateTimerRef.current = window.setTimeout(flushJobs, THROTTLE_MS);
        }
        return;
      }
      if (e.type === "job_deleted") {
        applyJobDeletedEvent(qc, e.id);
        if (!jobInvalidatePendingRef.current) {
          jobInvalidatePendingRef.current = true;
          jobInvalidateTimerRef.current = window.setTimeout(flushJobs, THROTTLE_MS);
        }
        return;
      }
      if (e.type === "session_analyzed") {
        applySessionAnalyzedEvent(qc, e.session);
        return;
      }
      if (e.type === "aggregates_updated") {
        qc.invalidateQueries({ queryKey: qk.insights.root });
        return;
      }
      if (e.type !== "request") return;
      if (pendingRef.current) return;
      pendingRef.current = true;
      timerRef.current = window.setTimeout(flush, THROTTLE_MS);
    };
    const unsub = subscribeLive(onEvent);
    const unsubOpen = subscribeOpen(({ reconnect }) => {
      if (reconnect) invalidateForReconnect(qc);
    });
    return () => {
      unsub();
      unsubOpen();
      if (timerRef.current != null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      if (jobInvalidateTimerRef.current != null) {
        window.clearTimeout(jobInvalidateTimerRef.current);
        jobInvalidateTimerRef.current = null;
      }
    };
  }, [qc]);
}

// Subscribes to live "request" events and returns the set of ids that arrived
// within the last `flashMs`. Pages use this to flash newly-arrived rows after
// React Query has refetched and rendered them. `pick` extracts the id of
// interest (request_id, session_id, user_id, …) from each request event.
export function useFreshIds(
  pick: (e: LiveEvent) => string | null,
  flashMs = 700,
): Set<string> {
  const [ids, setIds] = useState<Set<string>>(() => new Set());
  const pickRef = useRef(pick);
  pickRef.current = pick;

  useEffect(() => {
    let timer: number | null = null;
    const unsub = subscribeLive((e) => {
      const id = pickRef.current(e);
      if (!id) return;
      setIds((prev) => {
        const next = new Set(prev);
        next.add(id);
        return next;
      });
      if (timer != null) window.clearTimeout(timer);
      timer = window.setTimeout(() => setIds(new Set()), flashMs);
    });
    return () => {
      unsub();
      if (timer != null) window.clearTimeout(timer);
    };
  }, [flashMs]);

  return ids;
}

// Convenience pickers.
export const pickRequestId = (e: LiveEvent): string | null =>
  e.type === "request" ? e.request_id : null;

export const pickSessionId = (e: LiveEvent): string | null =>
  e.type === "request" ? e.session_id : null;
