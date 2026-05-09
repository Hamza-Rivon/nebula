// Mirrors the Dataset contract produced by the proxy's analyze pipeline.
// The proxy serves this from GET /api/insights.

export type Persona = "power" | "active" | "stuck" | "lurker" | "misuser";

export interface User {
  id: string;
  displayName: string;
  team: string;
  avatarSeed: string;
  sessionCount: number;
  totalTokens: number;
  totalCostUsd: number;
  totalWasteUsd: number;
  wizardScore: number;
  outcomes: {
    fully: number;
    mostly: number;
    partial: number;
    none: number;
    unclear: number;
  };
  topTools: Record<string, number>;
  topFrictions: Record<string, number>;
  winRate: number;
  costPerWin: number;
  lastActiveAt: string;
  sessionsLast7d: number;
  persona: Persona;
  topFrictionLabel: string;
}

export interface SessionMeta {
  sessionId: string;
  userId: string;
  filePath: string;
  projectName: string;
  startedAt: string;
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
  models: Record<string, number>;
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
  wizardScore: number;
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
  productiveUsd: number;
  firmWinRate: number;
  adoptionPct: number;
  costPerLandedOutcome: number;
  prevPeriodCostUsd: number | null;
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
  t: string;
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

export type Job = {
  id: string;
  scope: string;
  status: "queued" | "running" | "done" | "error";
  stage: string | null;
  total: number | null;
  done: number | null;
  error: string | null;
  started_at: number;
  finished_at: number | null;
};
