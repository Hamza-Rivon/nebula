import type { Cluster, Dataset, SessionMeta, User } from "./types";

export function userSparkline(
  user: User,
  sessions: SessionMeta[],
): { sessionId: string; score: number; startedAt: string }[] {
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

export function affectedUserCount(d: Dataset): number {
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

export function dominantWasteType(s: SessionMeta): string | null {
  if (!s.wasteFlags.length) return null;
  return s.wasteFlags
    .slice()
    .sort((a, b) => b.usdWasted - a.usdWasted)[0].type;
}
