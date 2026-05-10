import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { EmptyState } from "../components/EmptyState";
import { fmt } from "../format";
import { jobsListQuery, qk } from "../queries";
import { insightsApi } from "../insights/api";
import type { Job } from "../insights/types";

const STATUS_COLOR: Record<Job["status"], string> = {
  queued: "var(--color-mist)",
  running: "var(--color-butter)",
  done: "var(--color-mint)",
  error: "var(--color-rose)",
  cancelled: "var(--color-mist)",
};

// Re-renders the page once a second while a job is running, so the duration
// and ETA columns tick down between SSE progress events.
function useNow(active: boolean, intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [active, intervalMs]);
  return now;
}

export function JobsPage() {
  const qc = useQueryClient();
  const query = useQuery(jobsListQuery());
  const jobs = query.data?.jobs ?? [];
  const hasRunning = jobs.some((j) => j.status === "running");
  const now = useNow(hasRunning);

  const counts = useMemo(() => {
    const c = { queued: 0, running: 0, done: 0, error: 0, cancelled: 0 };
    for (const j of jobs) c[j.status] += 1;
    return c;
  }, [jobs]);

  const startAnalyze = useMutation({
    mutationFn: () => insightsApi.postAnalyze({ all: true }),
    onSuccess: () => {
      // Live SSE will patch the cache, but optimistically refresh too.
      qc.invalidateQueries({ queryKey: qk.jobs.root });
    },
    onError: (e) => alert(`Failed to start analyze: ${String(e)}`),
  });

  const clearInsights = useMutation({
    mutationFn: () => insightsApi.clear(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.insights.root });
    },
    onError: (e) => alert(`Failed to clear insights: ${String(e)}`),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline gap-3">
        <h2 className="font-display text-2xl font-bold">Analyze queue</h2>
        <span className="nb-chip" style={{ background: "var(--color-mint)" }}>
          <span className="inline-block h-2 w-2 rounded-full bg-[var(--color-ok)] nb-pulse" />
          live
        </span>
        <div className="ml-auto flex gap-2">
          <button
            type="button"
            className="nb-btn"
            onClick={() => startAnalyze.mutate()}
            disabled={startAnalyze.isPending}
            style={{ background: "var(--color-butter)" }}
          >
            {startAnalyze.isPending ? "Queuing…" : "Re-analyze all"}
          </button>
          <button
            type="button"
            className="nb-btn"
            data-variant="ghost"
            onClick={() => {
              if (confirm("Clear all analyzed insights? This cannot be undone."))
                clearInsights.mutate();
            }}
            disabled={clearInsights.isPending}
          >
            {clearInsights.isPending ? "Clearing…" : "Clear insights"}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Queued" value={counts.queued} bg="var(--color-mist)" />
        <Stat label="Running" value={counts.running} bg="var(--color-butter)" />
        <Stat label="Done" value={counts.done} bg="var(--color-mint)" />
        <Stat label="Errored" value={counts.error} bg="var(--color-rose)" />
      </div>

      {jobs.length === 0 && !query.isLoading ? (
        <div className="nb-card p-5">
          <EmptyState
            title="No analyze passes have run yet"
            hint="Click Re-analyze all to score every captured session against the insights pipeline."
            illustration="chart"
          />
        </div>
      ) : (
        <div className="nb-card overflow-hidden">
          <table className="nb-table">
            <thead>
              <tr>
                <th>Job</th>
                <th>Scope</th>
                <th>Status</th>
                <th>Stage</th>
                <th className="text-right">Progress</th>
                <th>Started</th>
                <th className="text-right">Duration</th>
                <th className="text-right">ETA</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((j) => (
                <Row key={j.id} job={j} now={now} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Row({ job, now }: { job: Job; now: number }) {
  const pct =
    job.total != null && job.total > 0
      ? Math.min(100, Math.round(((job.done ?? 0) / job.total) * 100))
      : null;
  const duration =
    job.finished_at != null
      ? job.finished_at - job.started_at
      : job.status === "running"
        ? now - job.started_at
        : null;
  // ETA: extrapolate remaining time from observed throughput. Only meaningful
  // while running with at least one item completed.
  const eta =
    job.status === "running" &&
    job.total != null &&
    job.total > 0 &&
    job.done != null &&
    job.done > 0 &&
    job.done < job.total
      ? Math.max(0, ((job.total - job.done) * (now - job.started_at)) / job.done)
      : null;
  return (
    <tr>
      <td>
        <span className="nb-tag font-mono">{job.id.slice(0, 10)}</span>
      </td>
      <td>
        <span className="nb-tag">{job.scope}</span>
      </td>
      <td>
        <span className="nb-chip" style={{ background: STATUS_COLOR[job.status] }}>
          {job.status === "running" && (
            <span
              className="mr-1 inline-block h-2 w-2 rounded-full bg-[var(--color-warn)] nb-pulse"
              aria-hidden
            />
          )}
          {job.status}
        </span>
      </td>
      <td className="text-xs opacity-80">
        {job.stage ?? <span className="opacity-40">—</span>}
        {job.error && (
          <div className="mt-1 truncate text-[11px]" style={{ color: "var(--color-err)" }}>
            {job.error}
          </div>
        )}
      </td>
      <td className="text-right">
        {pct == null ? (
          <span className="opacity-40">—</span>
        ) : (
          <div className="flex items-center justify-end gap-2">
            <div
              className="h-2 w-32 border-2 border-[var(--color-ink)]"
              style={{ background: "#fff" }}
            >
              <div
                style={{
                  width: `${pct}%`,
                  height: "100%",
                  background:
                    job.status === "error"
                      ? "var(--color-rose)"
                      : job.status === "done"
                        ? "var(--color-mint)"
                        : "var(--color-butter)",
                }}
              />
            </div>
            <span className="font-mono text-xs tabular-nums opacity-70">
              {job.done ?? 0}/{job.total}
            </span>
          </div>
        )}
      </td>
      <td className="opacity-80 whitespace-nowrap">{fmt.rel(job.started_at)}</td>
      <td className="text-right tabular-nums">
        {duration == null ? (
          <span className="opacity-40">—</span>
        ) : (
          msLabel(duration)
        )}
      </td>
      <td className="text-right tabular-nums">
        {eta == null ? (
          <span className="opacity-40">—</span>
        ) : (
          <span title={`${msLabel(eta)} remaining`}>~{msLabel(eta)}</span>
        )}
      </td>
      <td className="text-right">
        <RowActions job={job} />
      </td>
    </tr>
  );
}

function RowActions({ job }: { job: Job }) {
  const cancelMut = useMutation({
    mutationFn: () => insightsApi.cancelJob(job.id),
    onError: (e) => alert(`Cancel failed: ${String(e)}`),
  });
  const deleteMut = useMutation({
    mutationFn: () => insightsApi.deleteJob(job.id),
    onError: (e) => alert(`Delete failed: ${String(e)}`),
  });

  if (job.status === "running") {
    return (
      <button
        type="button"
        className="nb-chip"
        onClick={() => cancelMut.mutate()}
        disabled={cancelMut.isPending}
        title="Stop this running job"
        style={{
          background: "var(--color-rose)",
          cursor: "pointer",
        }}
      >
        <StopIcon />
        {cancelMut.isPending ? "stopping…" : "stop"}
      </button>
    );
  }

  return (
    <button
      type="button"
      className="nb-chip"
      onClick={() => deleteMut.mutate()}
      disabled={deleteMut.isPending}
      title="Remove this job from the queue"
      style={{ cursor: "pointer" }}
      aria-label="delete"
    >
      <TrashIcon />
      {deleteMut.isPending ? "…" : "delete"}
    </button>
  );
}

function TrashIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      width="11"
      height="11"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden
    >
      <path d="M3 4h10M6.5 4V2.5h3V4M5 4v9.5a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1V4M7 7v5M9 7v5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg viewBox="0 0 16 16" width="9" height="9" aria-hidden>
      <rect x="3" y="3" width="10" height="10" fill="currentColor" />
    </svg>
  );
}

function Stat({ label, value, bg }: { label: string; value: number; bg: string }) {
  return (
    <div className="nb-card p-3" style={{ background: bg }}>
      <div className="text-[10px] font-bold uppercase tracking-widest opacity-70">
        {label}
      </div>
      <div className="font-display text-2xl font-bold tabular-nums">
        {fmt.num(value)}
      </div>
    </div>
  );
}

function msLabel(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3_600_000) return `${(ms / 60_000).toFixed(1)}m`;
  return `${(ms / 3_600_000).toFixed(1)}h`;
}
