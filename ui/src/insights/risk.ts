// Risk-forensics framing for waste numbers.
//
// The underlying signals (waste flags, $ wasted) are derived from LLM
// extracts + heuristic rules — confident-looking percentages like
// "23% wasted" overstate the certainty. Manager-facing surfaces present
// the same numbers as a fraud-style risk score with bucketed labels:
// `clean / watch / flag / audit`. Hard percentages are kept internally
// for engineering-grade screens (session detail, etc.) but the headline
// vocabulary becomes "X% of spend at risk" with a forensic chip per row.
//
// All thresholds live here so we can tune them in one place.

import type { SessionMeta } from "./types";

export type RiskBucket = "clean" | "watch" | "flag" | "audit";

// 0-100 score derived from the share of the session's cost that the
// pipeline labelled as wasteful, lightly amplified by the count of
// independent flags (multi-evidence sessions get a bump, capped). The
// underlying invariant `wasteUsd ≤ costUsd` is enforced server-side, so
// `wasteRatio` is always in [0,1] — no defensive clamping needed beyond
// the cost==0 guard.
export function sessionRiskScore(s: SessionMeta): number {
  if (s.costUsd <= 0) return 0;
  const wasteRatio = Math.min(1, s.wasteUsd / s.costUsd);
  const flagFactor = Math.min(1, s.wasteFlags.length / 3);
  const score = 100 * (0.75 * wasteRatio + 0.25 * wasteRatio * flagFactor);
  return Math.round(Math.max(0, Math.min(100, score)));
}

export function bucketOf(score: number): RiskBucket {
  if (score >= 80) return "audit";
  if (score >= 50) return "flag";
  if (score >= 20) return "watch";
  return "clean";
}

export function sessionRiskBucket(s: SessionMeta): RiskBucket {
  return bucketOf(sessionRiskScore(s));
}

// Manager-readable label + color for a bucket. Colors map onto the existing
// palette tokens so the page styling stays consistent.
export const BUCKET_META: Record<
  RiskBucket,
  { label: string; bg: string; fg: string; tone: "ok" | "warm" | "warn" | "neutral" }
> = {
  clean: { label: "clean", bg: "var(--color-mint)", fg: "var(--color-ink)", tone: "ok" },
  watch: {
    label: "watch",
    bg: "var(--color-mist)",
    fg: "var(--color-ink)",
    tone: "neutral",
  },
  flag: {
    label: "flag",
    bg: "var(--color-butter)",
    fg: "var(--color-ink)",
    tone: "warm",
  },
  audit: { label: "audit", bg: "var(--color-rose)", fg: "var(--color-ink)", tone: "warn" },
};

// Headline metric: how much of total spend sits in `flag` or `audit`. This
// replaces the raw "% wasted" number, which read as accounting truth.
export function firmRiskExposure(sessions: SessionMeta[]): {
  spendAtRisk: number;
  totalSpend: number;
  pct: number; // 0..100
  flaggedSessions: number;
} {
  let spendAtRisk = 0;
  let totalSpend = 0;
  let flaggedSessions = 0;
  for (const s of sessions) {
    totalSpend += s.costUsd;
    const b = sessionRiskBucket(s);
    if (b === "flag" || b === "audit") {
      spendAtRisk += s.costUsd;
      flaggedSessions++;
    }
  }
  const pct = totalSpend > 0 ? Math.round((spendAtRisk / totalSpend) * 100) : 0;
  return { spendAtRisk, totalSpend, pct, flaggedSessions };
}
