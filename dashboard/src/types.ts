// Shared schema between the analyze pipeline (scripts/analyze.ts) and the
// frontend (src/**). Field names are load-bearing — renaming will break the UI.

export type Persona = "power" | "active" | "stuck" | "lurker" | "misuser";

export interface User {
  id: string; // "u1".."uN"
  displayName: string;
  team: string; // "Strategy" | "Operations" | "Technology" | "Financial" | "Research"
  avatarSeed: string; // = id
  sessionCount: number;
  totalTokens: number;
  totalCostUsd: number;
  totalWasteUsd: number;
  wizardScore: number; // 0..1
  outcomes: {
    fully: number;
    mostly: number;
    partial: number;
    none: number;
    unclear: number;
  };
  topTools: Record<string, number>; // top 5
  topFrictions: Record<string, number>; // top 5

  // Manager-facing derived metrics
  winRate: number; // (fully + mostly) / total outcomes, 0..1
  costPerWin: number; // totalCostUsd / max(1, fully + mostly)
  lastActiveAt: string; // ISO of most recent session start
  sessionsLast7d: number; // sessions whose start ≥ dateRange.end - 7d
  persona: Persona;
  topFrictionLabel: string; // human-readable, e.g. "uses Opus on trivial tasks"
}

export interface SessionMeta {
  sessionId: string;
  userId: string;
  filePath: string;
  projectName: string;
  startedAt: string; // ISO
  endedAt: string;
  durationMinutes: number;
  userMessageCount: number;
  assistantMessageCount: number;
  turns: number;
  tokens: {
    input: number;
    output: number;
    cacheRead: number;
    cacheCreate: number;
  };
  models: Record<string, number>; // model id -> turn count
  tools: Record<string, number>;
  toolErrors: number;
  toolErrorCategories: Record<string, number>;
  userInterruptions: number;
  branchPoints: number;
  retryLoops: number;
  abandoned: boolean;
  linesAdded: number;
  linesRemoved: number;
  filesModified: number;
  costUsd: number;
  wasteUsd: number;
  wasteFlags: WasteFlag[];
  wizardScore: number; // 0..1
  goal: string;
  outcome: "fully" | "mostly" | "partial" | "none" | "unclear";
  sessionType:
    | "single_task"
    | "multi_task"
    | "iterative"
    | "exploration"
    | "quick_q";
  friction: string[];
  primarySuccess: string;
  briefSummary: string;
  asks: Ask[];
  unresolved: Unresolved[];
  firstPrompt: string;
}

export interface Ask {
  intent: string;
  artifact: string;
  text: string;
  clusterId?: string;
}

export interface Unresolved {
  topic: string;
  framing: string;
  clusterId?: string;
}

export interface WasteFlag {
  type:
    | "wrong_model"
    | "retry_loop"
    | "abandoned"
    | "context_bloat"
    | "redundant_prompt";
  tokensWasted: number;
  usdWasted: number;
  evidence?: string;
}

export interface Cluster {
  id: string;
  label: string;
  domain: "strategy" | "code" | "research" | "writing" | "data" | "ops" | "other";
  type: "ask" | "unresolved";
  size: number;
  sessionCount: number;
  userCount: number;
  avgOutcomeScore: number;
  unresolvedCount: number;
  severity: number;
  topFrictions: string[];
  centroid3d: [number, number, number];
  members: string[];
}

export interface Aggregates {
  totalSessions: number;
  totalUsers: number;
  totalTokens: number;
  totalCostUsd: number;
  totalWasteUsd: number;
  productiveUsd: number; // totalCostUsd - totalWasteUsd
  firmWinRate: number; // 0..1
  adoptionPct: number; // % of users with ≥2 sessions in last 7d window
  costPerLandedOutcome: number; // totalCostUsd / max(1, fully + mostly)
  prevPeriodCostUsd: number | null; // null until we ingest a comparison window
  dateRange: { start: string; end: string };
  toolCounts: Record<string, number>;
  modelMix: Record<string, number>;
  outcomeMix: Record<string, number>;
  frictionMix: Record<string, number>;
  wasteByType: Record<
    string,
    { tokens: number; usd: number; sessions: number }
  >;
}

export interface TranscriptEvent {
  t: string; // ISO timestamp
  type: "user" | "assistant" | "tool_use" | "tool_result" | "thinking" | "interrupt";
  text?: string;
  tool?: string;
  input?: unknown;
  result?: string;
  isError?: boolean;
  model?: string;
}

export interface Transcript {
  sessionId: string;
  events: TranscriptEvent[];
  truncated: boolean;
}

export interface Dataset {
  generatedAt: string;
  schemaVersion: 1;
  config: {
    maxSessions: number | null;
    users: number;
    model: string;
    embeddingModel: string | null;
    apiBaseUrl: string;
  };
  users: User[];
  sessions: SessionMeta[];
  clusters: Cluster[];
  aggregates: Aggregates;
}
