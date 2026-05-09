// Client-side derivations from the Dataset. Anything not stored in
// public/sessions.json but needed by the UI is computed here.

import type { Cluster, Dataset, SessionMeta, User } from "./types";

export interface RadarAxes {
  throughput: number;
  firstShot: number;
  cacheHit: number;
  editEfficiency: number;
  modelIQ: number;
}

/**
 * Derive a 5-axis "wizard signature" for a user from User + their sessions.
 *
 * Heuristics (all clamped to [0,1]):
 *  - throughput     : avg (linesAdded + linesRemoved) per session, log-normalized
 *  - firstShot      : share of outcomes that landed "fully" or "mostly"
 *  - cacheHit       : cacheRead / (cacheRead + input + output) across sessions
 *  - editEfficiency : (Edit + Write tool uses) / (Bash tool uses + 1) — favors users
 *                     who edit precisely vs. shell-thrashing
 *  - modelIQ        : 1 - share of waste that's `wrong_model`. Penalizes mismatched
 *                     model selection.
 *
 * NOTE: per-axis scores are not stored in the dataset; analyze.ts could emit
 * these in a future pass. Tweaks here only change the visual signature.
 */
export function deriveRadar(user: User, sessions: SessionMeta[]): RadarAxes {
  const userSessions = sessions.filter((s) => s.userId === user.id);
  const n = Math.max(1, userSessions.length);

  const linesPerSession =
    userSessions.reduce((a, s) => a + s.linesAdded + s.linesRemoved, 0) / n;
  const throughput = clamp01(Math.log10(linesPerSession + 1) / 2.5);

  const goodOutcomes = (user.outcomes.fully ?? 0) + (user.outcomes.mostly ?? 0);
  const totalOutcomes =
    (user.outcomes.fully ?? 0) +
    (user.outcomes.mostly ?? 0) +
    (user.outcomes.partial ?? 0) +
    (user.outcomes.none ?? 0) +
    (user.outcomes.unclear ?? 0);
  const firstShot = totalOutcomes > 0 ? goodOutcomes / totalOutcomes : 0;

  const tot = userSessions.reduce(
    (acc, s) => {
      acc.cacheRead += s.tokens.cacheRead;
      acc.input += s.tokens.input;
      acc.output += s.tokens.output;
      return acc;
    },
    { cacheRead: 0, input: 0, output: 0 },
  );
  const cacheDenom = tot.cacheRead + tot.input + tot.output + 1;
  const cacheHit = clamp01(tot.cacheRead / cacheDenom);

  const editTool =
    (user.topTools.Edit ?? 0) + (user.topTools.Write ?? 0);
  const bashTool = user.topTools.Bash ?? 0;
  const editEfficiency = clamp01(editTool / (editTool + bashTool * 0.6 + 1));

  const wrongModelWaste = userSessions.reduce(
    (a, s) =>
      a +
      s.wasteFlags
        .filter((f) => f.type === "wrong_model")
        .reduce((b, f) => b + f.usdWasted, 0),
    0,
  );
  const totalWaste = user.totalWasteUsd || 0;
  const wrongModelShare =
    totalWaste > 0 ? wrongModelWaste / totalWaste : 0;
  const modelIQ = clamp01(1 - wrongModelShare);

  return {
    throughput,
    firstShot,
    cacheHit,
    editEfficiency,
    modelIQ,
  };
}

function clamp01(x: number): number {
  if (!isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

export interface UserSparkPoint {
  sessionId: string;
  score: number; // wizardScore for that session
  startedAt: string;
}

export function userSparkline(
  user: User,
  sessions: SessionMeta[],
): UserSparkPoint[] {
  return sessions
    .filter((s) => s.userId === user.id)
    .sort(
      (a, b) =>
        new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime(),
    )
    .map((s) => ({
      sessionId: s.sessionId,
      score: s.wizardScore,
      startedAt: s.startedAt,
    }));
}

/**
 * Pick the most "interesting" cluster for the kicker caption — by default the
 * unresolved cluster with highest severity * userCount.
 */
export function topUnresolvedCluster(clusters: Cluster[]): Cluster | undefined {
  return clusters
    .filter((c) => c.type === "unresolved")
    .slice()
    .sort(
      (a, b) =>
        b.severity * Math.max(1, b.userCount) -
        a.severity * Math.max(1, a.userCount),
    )[0];
}

/** Affected consultant count across all unresolved clusters. */
export function affectedConsultantCount(d: Dataset): number {
  const unresolvedSessionIds = new Set<string>();
  for (const c of d.clusters) {
    if (c.type !== "unresolved") continue;
    for (const m of c.members) unresolvedSessionIds.add(m);
  }
  const userIds = new Set<string>();
  for (const s of d.sessions) {
    if (unresolvedSessionIds.has(s.sessionId)) userIds.add(s.userId);
  }
  return userIds.size;
}

/** A heuristic suggested-action string per cluster. */
export function suggestedAction(cluster: Cluster): string {
  const label = cluster.label.replace(/[`*_]/g, "").trim();
  if (cluster.type === "unresolved") {
    if (cluster.domain === "code")
      return `Author a CLAUDE.md playbook covering "${truncateLabel(label)}" and circulate to the affected team.`;
    if (cluster.domain === "ops")
      return `Run a 30-min ops walkthrough on "${truncateLabel(label)}" and capture the runbook.`;
    if (cluster.domain === "strategy")
      return `Pair-prompt session: senior + AI on "${truncateLabel(label)}".`;
    return `Workshop: "${truncateLabel(label)}" — pair the strongest answerer with the stuck cohort.`;
  }
  return `Promote a shared prompt-template for "${truncateLabel(label)}" — high reuse signal.`;
}

function truncateLabel(s: string): string {
  return s.length > 60 ? s.slice(0, 59).trimEnd() + "…" : s;
}

/** Sessions sorted by waste descending. */
export function topWasteSessions(
  d: Dataset,
  filter?: (s: SessionMeta) => boolean,
  n = 3,
): SessionMeta[] {
  return d.sessions
    .filter((s) => s.wasteUsd > 0 && (!filter || filter(s)))
    .sort((a, b) => b.wasteUsd - a.wasteUsd)
    .slice(0, n);
}

/** A short waste type label for a session — its dominant waste flag. */
export function dominantWasteType(s: SessionMeta): string | null {
  if (!s.wasteFlags.length) return null;
  return s.wasteFlags
    .slice()
    .sort((a, b) => b.usdWasted - a.usdWasted)[0].type;
}
