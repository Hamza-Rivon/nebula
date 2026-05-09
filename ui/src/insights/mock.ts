import type { Dataset } from "./types";

// Dev-time fallback so the manager view never looks empty during a demo.
// Used when /api/insights returns 404 (no analyze pass has run yet).
export function makeMock(): Dataset {
  const now = new Date();
  const start = new Date(now.getTime() - 7 * 86400000);
  return {
    generatedAt: now.toISOString(),
    schemaVersion: 1,
    config: {
      maxSessions: null,
      users: 6,
      model: "mock",
      embeddingModel: null,
      apiBaseUrl: "mock",
    },
    users: [
      mkUser("u1", "Alex Chen", "Platform", "power", 24, 12.4, 1.1, 0.83, 7),
      mkUser("u2", "Mira Patel", "Infra", "active", 19, 8.7, 0.5, 0.71, 5),
      mkUser("u3", "Jonas Weber", "Frontend", "stuck", 11, 9.1, 3.6, 0.32, 3),
      mkUser("u4", "Priya Rao", "Data", "power", 22, 10.3, 0.6, 0.78, 6),
      mkUser("u5", "Tomás García", "Backend", "misuser", 14, 17.4, 7.2, 0.41, 4),
      mkUser("u6", "Sara Okonkwo", "ML", "lurker", 3, 0.7, 0.05, 0.5, 1),
    ],
    sessions: [
      mkSession("s1", "u1", "fully", 0.4, 0.0, "Refactor auth flow"),
      mkSession("s2", "u3", "none", 1.8, 1.2, "Fix retry loop in webhook"),
      mkSession("s3", "u5", "partial", 4.2, 2.7, "Migrate to gRPC", ["wrong_model"]),
      mkSession("s4", "u2", "mostly", 0.9, 0.1, "Add Prometheus metrics"),
      mkSession("s5", "u4", "fully", 0.5, 0.0, "Backfill schema"),
      mkSession("s6", "u3", "unclear", 2.1, 1.4, "Debug TS narrowing", ["retry_loop"]),
    ],
    clusters: [
      mkCluster("c1", "Webhook retry idempotency", "code", "unresolved", 0.82, 11, 4, [-1.2, 0.6]),
      mkCluster("c2", "GraphQL N+1 patterns", "code", "ask", 0.55, 7, 3, [0.9, -0.5]),
      mkCluster("c3", "Migration playbook gaps", "ops", "unresolved", 0.74, 5, 3, [-0.4, -1.1]),
      mkCluster("c4", "Type narrowing in unions", "code", "ask", 0.41, 9, 4, [1.1, 1.0]),
      mkCluster("c5", "Test seed determinism", "code", "unresolved", 0.62, 4, 2, [-1.4, -0.7]),
    ],
    aggregates: {
      totalSessions: 6,
      totalUsers: 6,
      totalTokens: 4_800_000,
      totalCostUsd: 58.6,
      totalWasteUsd: 13.05,
      productiveUsd: 45.55,
      firmWinRate: 0.55,
      adoptionPct: 0.82,
      costPerLandedOutcome: 14.6,
      prevPeriodCostUsd: 41.2,
      dateRange: { start: start.toISOString(), end: now.toISOString() },
      toolCounts: { Read: 420, Edit: 240, Bash: 180, Write: 95, Grep: 60 },
      modelMix: { "claude-sonnet-4-6": 230, "claude-opus-4-7": 80 },
      outcomeMix: { fully: 2, mostly: 1, partial: 1, none: 1, unclear: 1 },
      frictionMix: { tool_loop: 3, missing_context: 2, model_mismatch: 1 },
      wasteByType: {
        wrong_model: { tokens: 1_200_000, usd: 6.2, sessions: 2 },
        retry_loop: { tokens: 800_000, usd: 4.1, sessions: 2 },
        context_bloat: { tokens: 600_000, usd: 1.7, sessions: 1 },
        abandoned: { tokens: 400_000, usd: 1.05, sessions: 1 },
      },
    },
  };
}

function mkUser(
  id: string,
  displayName: string,
  team: string,
  persona: "power" | "active" | "stuck" | "lurker" | "misuser",
  sessionCount: number,
  totalCostUsd: number,
  totalWasteUsd: number,
  winRate: number,
  sessionsLast7d: number,
): Dataset["users"][number] {
  const fully = Math.round(sessionCount * winRate * 0.6);
  const mostly = Math.round(sessionCount * winRate * 0.4);
  const partial = Math.round(sessionCount * (1 - winRate) * 0.5);
  const none = sessionCount - fully - mostly - partial;
  return {
    id,
    displayName,
    team,
    avatarSeed: id,
    sessionCount,
    totalTokens: sessionCount * 60_000,
    totalCostUsd,
    totalWasteUsd,
    wizardScore: winRate * 0.9,
    outcomes: { fully, mostly, partial, none: Math.max(0, none), unclear: 0 },
    topTools: { Read: 30, Edit: 18, Bash: 12 },
    topFrictions: persona === "stuck" ? { tool_loop: 4 } : {},
    winRate,
    costPerWin: totalCostUsd / Math.max(1, fully + mostly),
    lastActiveAt: new Date().toISOString(),
    sessionsLast7d,
    persona,
    topFrictionLabel:
      persona === "stuck"
        ? "gets stuck in tool loops"
        : persona === "misuser"
          ? "uses Opus on trivial tasks"
          : "—",
  };
}

function mkSession(
  sessionId: string,
  userId: string,
  outcome: Dataset["sessions"][number]["outcome"],
  costUsd: number,
  wasteUsd: number,
  goal: string,
  wasteTypes: ("wrong_model" | "retry_loop" | "abandoned" | "context_bloat" | "redundant_prompt")[] = [],
): Dataset["sessions"][number] {
  const now = Date.now();
  return {
    sessionId,
    userId,
    filePath: `mock/${sessionId}.jsonl`,
    projectName: "demo",
    startedAt: new Date(now - Math.random() * 6 * 86400000).toISOString(),
    endedAt: new Date().toISOString(),
    durationMinutes: 30,
    userMessageCount: 8,
    assistantMessageCount: 9,
    turns: 8,
    tokens: { input: 150_000, output: 30_000, cacheRead: 80_000, cacheCreate: 20_000 },
    models: { "claude-sonnet-4-6": 6, "claude-opus-4-7": 2 },
    tools: { Read: 12, Edit: 6, Bash: 4 },
    toolErrors: outcome === "none" ? 3 : 0,
    toolErrorCategories: outcome === "none" ? { "Edit Failed": 2, "Command Failed": 1 } : {},
    userInterruptions: outcome === "none" ? 1 : 0,
    branchPoints: 0,
    retryLoops: wasteTypes.includes("retry_loop") ? 2 : 0,
    abandoned: outcome === "none",
    linesAdded: 80,
    linesRemoved: 22,
    filesModified: 4,
    costUsd,
    wasteUsd,
    wasteFlags: wasteTypes.map((t) => ({
      type: t,
      tokensWasted: 200_000,
      usdWasted: wasteUsd / Math.max(1, wasteTypes.length),
      evidence: "mock",
    })),
    wizardScore: outcome === "fully" ? 0.85 : outcome === "mostly" ? 0.65 : 0.3,
    goal,
    outcome,
    sessionType: "iterative",
    friction: outcome === "none" ? ["tool_loop"] : [],
    primarySuccess: outcome === "fully" ? "Shipped change" : "",
    briefSummary: `Mock session: ${goal}.`,
    asks: [{ intent: "implement", artifact: "change", text: goal }],
    unresolved: outcome === "none" ? [{ topic: goal, framing: "Failed to land" }] : [],
    firstPrompt: goal,
  };
}

function mkCluster(
  id: string,
  label: string,
  domain: Dataset["clusters"][number]["domain"],
  type: "ask" | "unresolved",
  severity: number,
  sessionCount: number,
  userCount: number,
  centroid: [number, number],
): Dataset["clusters"][number] {
  return {
    id,
    label,
    domain,
    type,
    size: sessionCount,
    sessionCount,
    userCount,
    avgOutcomeScore: 1 - severity,
    unresolvedCount: type === "unresolved" ? sessionCount : 0,
    severity,
    topFrictions: type === "unresolved" ? ["tool_loop", "missing_context"] : [],
    centroid3d: [centroid[0], centroid[1], 0],
    members: Array.from({ length: sessionCount }, (_, i) => `s${i + 1}`),
  };
}
