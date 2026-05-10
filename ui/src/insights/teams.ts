import type { Dataset, Persona, SessionMeta, User } from "./types";

export interface TeamSummary {
  id: string;
  name: string;
  memberCount: number;
  sessionCount: number;
  totalCostUsd: number;
  totalWasteUsd: number;
  totalTokens: number;
  winRate: number;
  costPerWin: number;
  outcomes: User["outcomes"];
  topTools: Record<string, number>;
  topFrictions: Record<string, number>;
  sessionsLast7d: number;
  topFrictionLabel: string;
  personaMix: Record<Persona, number>;
}

const FRICTION_LABEL: Record<string, string> = {
  context_loss: "Context loss",
  retry_loop: "Retry loops",
  wrong_model: "Wrong model",
  abandoned: "Abandoned runs",
  context_bloat: "Context bloat",
  redundant_prompt: "Redundant prompts",
  tool_error: "Tool errors",
  unclear_goal: "Unclear goals",
  scope_creep: "Scope creep",
};

function frictionLabel(key: string): string {
  return FRICTION_LABEL[key] ?? key.replace(/_/g, " ");
}

export function buildTeams(data: Dataset): TeamSummary[] {
  const usersByTeam = new Map<string, User[]>();
  for (const u of data.users) {
    const arr = usersByTeam.get(u.team) ?? [];
    arr.push(u);
    usersByTeam.set(u.team, arr);
  }

  const teams: TeamSummary[] = [];
  for (const [team, members] of usersByTeam) {
    const memberIds = new Set(members.map((m) => m.id));
    const sessions = data.sessions.filter((s) => memberIds.has(s.userId));

    const totalCostUsd = sum(members, (m) => m.totalCostUsd);
    const totalWasteUsd = sum(members, (m) => m.totalWasteUsd);
    const totalTokens = sum(members, (m) => m.totalTokens);

    const outcomes: User["outcomes"] = {
      fully: sum(members, (m) => m.outcomes.fully),
      mostly: sum(members, (m) => m.outcomes.mostly),
      partial: sum(members, (m) => m.outcomes.partial),
      none: sum(members, (m) => m.outcomes.none),
      unclear: sum(members, (m) => m.outcomes.unclear),
    };
    const landed = outcomes.fully + outcomes.mostly;
    const ratedTotal =
      outcomes.fully +
      outcomes.mostly +
      outcomes.partial +
      outcomes.none +
      outcomes.unclear;
    const winRate = ratedTotal > 0 ? landed / ratedTotal : 0;
    const costPerWin = landed > 0 ? totalCostUsd / landed : Infinity;

    const topTools = mergeCounts(members.map((m) => m.topTools));
    const topFrictions = mergeCounts(members.map((m) => m.topFrictions));
    const topFrictionEntry = Object.entries(topFrictions).sort(
      (a, b) => b[1] - a[1],
    )[0];
    const topFrictionLabel = topFrictionEntry
      ? frictionLabel(topFrictionEntry[0])
      : "—";

    const personaMix: Record<Persona, number> = {
      power: 0,
      active: 0,
      stuck: 0,
      misuser: 0,
      lurker: 0,
    };
    for (const m of members) personaMix[m.persona]++;

    teams.push({
      id: team,
      name: team,
      memberCount: members.length,
      sessionCount: sessions.length,
      totalCostUsd,
      totalWasteUsd,
      totalTokens,
      winRate,
      costPerWin,
      outcomes,
      topTools,
      topFrictions,
      sessionsLast7d: sum(members, (m) => m.sessionsLast7d),
      topFrictionLabel,
      personaMix,
    });
  }

  teams.sort((a, b) => b.totalCostUsd - a.totalCostUsd);
  return teams;
}

export function teamSessions(
  data: Dataset,
  teamId: string,
): SessionMeta[] {
  const memberIds = new Set(
    data.users.filter((u) => u.team === teamId).map((u) => u.id),
  );
  return data.sessions.filter((s) => memberIds.has(s.userId));
}

function sum<T>(items: T[], pick: (t: T) => number): number {
  let acc = 0;
  for (const i of items) acc += pick(i);
  return acc;
}

function mergeCounts(maps: Record<string, number>[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const m of maps) {
    for (const [k, v] of Object.entries(m)) {
      out[k] = (out[k] ?? 0) + v;
    }
  }
  return out;
}
