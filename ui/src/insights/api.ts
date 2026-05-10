import type { Cluster, Dataset, Job, SessionMeta, Transcript, User } from "./types";

async function j<T>(r: Response): Promise<T> {
  if (!r.ok) {
    const txt = await r.text().catch(() => "");
    throw new Error(`${r.status} ${txt}`);
  }
  return r.json();
}

export const insightsApi = {
  // Returns null if backend has not run an analyze pass yet (404).
  async getDataset(): Promise<Dataset | null> {
    const r = await fetch("/api/insights");
    if (r.status === 404) return null;
    return j<Dataset>(r);
  },
  getUser: (id: string) =>
    fetch(`/api/insights/users/${encodeURIComponent(id)}`).then(j<User>),
  getCluster: (id: string) =>
    fetch(`/api/insights/clusters/${encodeURIComponent(id)}`).then(j<Cluster>),
  getSession: (sessionId: string) =>
    fetch(`/api/insights/sessions/${encodeURIComponent(sessionId)}`).then(
      j<{ session: SessionMeta; transcript: Transcript | null }>,
    ),
  postAnalyze: (body: { all?: boolean; sessionId?: string; force?: boolean }) =>
    fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(j<Job>),
  getJob: (id: string) =>
    fetch(`/api/jobs/${encodeURIComponent(id)}`).then(j<Job>),
  listJobs: (params?: {
    scopePrefix?: string;
    status?: string;
    limit?: number;
    offset?: number;
  }) => {
    const q = new URLSearchParams();
    if (params?.scopePrefix) q.set("scope", params.scopePrefix);
    if (params?.status) q.set("status", params.status);
    if (params?.limit != null) q.set("limit", String(params.limit));
    if (params?.offset != null) q.set("offset", String(params.offset));
    const qs = q.toString();
    return fetch(`/api/jobs${qs ? `?${qs}` : ""}`).then(
      j<{ jobs: Job[]; total?: number; counts?: Record<string, number> }>,
    );
  },
  cancelJob: (id: string) =>
    fetch(`/api/jobs/${encodeURIComponent(id)}/cancel`, { method: "POST" }).then(
      j<Job>,
    ),
  deleteJob: (id: string) =>
    fetch(`/api/jobs/${encodeURIComponent(id)}`, { method: "DELETE" }).then(
      j<{ ok: true }>,
    ),
  clear: () => fetch("/api/insights", { method: "DELETE" }).then(j<{ ok: true }>),
  getSettings: () => fetch("/api/settings").then(j<{ autoDrain: boolean }>),
  setAutoDrain: (autoDrain: boolean) =>
    fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ autoDrain }),
    }).then(j<{ autoDrain: boolean }>),
};
