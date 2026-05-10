import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { jobsListQuery } from "../../queries";
import { formatDateRange, wasteTypeLabel } from "../../insights/format";
import { PALETTE } from "../../insights/palette";
import { buildTeams } from "../../insights/teams";
import { PulseStrip } from "../../components/insights/PulseStrip";
import {
  MoneyFlow,
  SpendWinScatter,
  type ScatterEntity,
} from "../../components/insights/MoneyFlow";
import { PeopleTable } from "../../components/insights/PeopleTable";
import { TeamsTable } from "../../components/insights/TeamsTable";
import { CapabilityWordMap } from "../../components/insights/CapabilityWordMap";
import { Drawer } from "../../components/insights/Drawer";
import { UserDrawer } from "../../components/insights/drawers/UserDrawer";
import { TeamDrawer } from "../../components/insights/drawers/TeamDrawer";
import { ClusterDrawer } from "../../components/insights/drawers/ClusterDrawer";
import { WasteDrawer } from "../../components/insights/drawers/WasteDrawer";
import type { InsightsHandle } from "../../insights/useInsightsData";

const TEAM_PALETTE = [
  "#7BC9A4",
  "#7AA8E8",
  "#F2B968",
  "#E48A7A",
  "#B8A2E0",
  "#7DC9C2",
  "#E78FB5",
  "#C7D27A",
];

// T1 — Soft-Pop neobrutalist (the original). Cream + bold ink + hard shadows.
export function T1Insights({ handle }: { handle: InsightsHandle }) {
  const {
    data,
    anonymized,
    setAnonymized,
    drawer,
    openUser,
    openTeam,
    openCluster,
    openWaste,
    closeDrawer,
  } = handle;

  const teams = useMemo(() => (data ? buildTeams(data) : []), [data]);
  const teamColor = useMemo(() => {
    const m = new Map<string, string>();
    teams.forEach((t, i) => m.set(t.id, TEAM_PALETTE[i % TEAM_PALETTE.length]!));
    return m;
  }, [teams]);

  const scatterEntities: ScatterEntity[] = useMemo(() => {
    if (!data) return [];
    if (anonymized) {
      return teams.map((t) => ({
        id: t.id,
        label: t.name,
        spend: t.totalCostUsd,
        winRate: t.winRate,
        size: t.sessionCount,
        color: teamColor.get(t.id) ?? PALETTE.persona.active,
      }));
    }
    const personaColor = (p: string) =>
      p === "power"
        ? PALETTE.persona.power
        : p === "active"
          ? PALETTE.persona.active
          : p === "stuck"
            ? PALETTE.persona.stuck
            : p === "misuser"
              ? PALETTE.persona.misuser
              : PALETTE.persona.lurker;
    return data.users.map((u) => ({
      id: u.id,
      label: u.displayName,
      spend: u.totalCostUsd,
      winRate: u.winRate,
      size: u.sessionCount,
      color: personaColor(u.persona),
    }));
  }, [data, anonymized, teams, teamColor]);

  const drawerProps = useMemo(() => {
    if (!data || !drawer) return null;
    if (drawer.kind === "user") {
      const user = data.users.find((u) => u.id === drawer.userId);
      if (!user) return null;
      return {
        eyebrow: "Engineer profile",
        title: user.displayName,
        subtitle: `${user.team} · ${user.sessionCount} sessions`,
        body: <UserDrawer user={user} data={data} />,
      };
    }
    if (drawer.kind === "team") {
      const team = teams.find((t) => t.id === drawer.teamId);
      if (!team) return null;
      return {
        eyebrow: "Team profile",
        title: team.name,
        subtitle: `${team.memberCount} engineers · ${team.sessionCount} sessions`,
        body: <TeamDrawer team={team} data={data} />,
      };
    }
    if (drawer.kind === "cluster") {
      const c = data.clusters.find((c) => c.id === drawer.clusterId);
      if (!c) return null;
      const teamCount = (() => {
        const teamByUser = new Map(
          data.users.map((u) => [u.id, u.team] as const),
        );
        const memberSet = new Set(c.members);
        const ts = new Set<string>();
        for (const s of data.sessions) {
          if (memberSet.has(s.sessionId)) {
            const t = teamByUser.get(s.userId);
            if (t) ts.add(t);
          }
        }
        return ts.size;
      })();
      const subtitle = anonymized
        ? `${c.domain} · ${c.sessionCount} sessions · ${teamCount} teams`
        : `${c.domain} · ${c.sessionCount} sessions · ${c.userCount} engineers`;
      return {
        eyebrow: c.type === "ask" ? "Demand cluster" : "Capability gap",
        title: c.label,
        subtitle,
        body: <ClusterDrawer cluster={c} data={data} anonymized={anonymized} />,
      };
    }
    if (drawer.kind === "waste") {
      return {
        eyebrow: "Waste category",
        title: wasteTypeLabel(drawer.wasteType),
        subtitle: "Detected pattern across the org",
        body: (
          <WasteDrawer
            wasteType={drawer.wasteType}
            data={data}
            anonymized={anonymized}
          />
        ),
      };
    }
    return null;
  }, [data, drawer, teams, anonymized]);

  // Lightweight live progress query. Driven by SSE-invalidated jobs cache; no
  // polling. The Insights page renders progressively (sessions land via the
  // session_analyzed event, partial aggregates compute on the fly), so we
  // only block the page when there's literally nothing to show yet.
  const jobsQuery = useQuery({
    ...jobsListQuery({ scopePrefix: "session:", limit: 1 }),
  });
  const counts = jobsQuery.data?.counts ?? {};
  const inFlight = (counts.queued ?? 0) + (counts.running ?? 0);

  if (!data) {
    return (
      <div className="nb-card p-5">
        {inFlight > 0
          ? `Analyzing capability intel — ${inFlight} session task${inFlight === 1 ? "" : "s"} in flight…`
          : "Loading capability intel…"}
      </div>
    );
  }
  const a = data.aggregates;

  return (
    <div className="page">
      {inFlight > 0 && (
        <div
          className="nb-card mb-3 flex items-center gap-3 p-3"
          style={{ background: "var(--color-butter)" }}
        >
          <span
            className="inline-block h-2 w-2 rounded-full bg-[var(--color-warn)] nb-pulse"
            aria-hidden
          />
          <span className="text-sm font-bold">
            Analyzing live — {inFlight} session task{inFlight === 1 ? "" : "s"} in flight
          </span>
          <span className="ml-auto text-xs opacity-70">
            Showing {data.sessions.length} session{data.sessions.length === 1 ? "" : "s"} so far · provisional aggregates until rollup
          </span>
        </div>
      )}
      <div className="page-head">
        <div>
          <div className="page-eyebrow">Capability intel · CTO brief</div>
          <h1 className="page-title">Insights overview</h1>
        </div>
        <div className="page-head-controls">
          <AnonymizedToggle
            value={anonymized}
            onChange={setAnonymized}
          />
          <div className="daterange">
            <span className="daterange-dot" />
            <span>{formatDateRange(a.dateRange.start, a.dateRange.end)}</span>
          </div>
        </div>
      </div>

      <div className="page-body">
        <PulseStrip data={data} anonymized={anonymized} />
        <MoneyFlow
          data={data}
          anonymized={anonymized}
          onOpenWaste={openWaste}
          onOpenUser={openUser}
          onOpenTeam={openTeam}
        />
        <section className="panel">
          <div className="panel-header">
            <div>
              <div className="panel-sub">Q2b — Spend vs. outcome</div>
              <h3 className="panel-title">
                {anonymized ? "Per-team view" : "Per-engineer view"}
              </h3>
            </div>
            <div className="panel-meta">
              {anonymized
                ? "click a team to drill in"
                : "click a dot to drill in"}
            </div>
          </div>
          <div className="panel-body">
            <SpendWinScatter
              entities={scatterEntities}
              onOpen={anonymized ? openTeam : openUser}
            />
          </div>
        </section>
        {anonymized ? (
          <TeamsTable data={data} onOpenTeam={openTeam} />
        ) : (
          <PeopleTable data={data} onOpenUser={openUser} />
        )}
        <section className="panel">
          <div className="panel-header">
            <div>
              <div className="panel-sub">Q3 — What the org isn't learning</div>
              <h3 className="panel-title">Capability map · grouped by domain</h3>
            </div>
            <CapabilityLegend />
          </div>
          <div className="panel-wordmap">
            <CapabilityWordMap data={data} onSelect={openCluster} />
          </div>
        </section>
      </div>

      <Drawer
        open={drawer !== null && drawerProps !== null}
        onClose={closeDrawer}
        eyebrow={drawerProps?.eyebrow}
        title={drawerProps?.title}
        subtitle={drawerProps?.subtitle}
      >
        {drawerProps?.body}
      </Drawer>
    </div>
  );
}

function CapabilityLegend() {
  return (
    <div className="capmap-legend" aria-label="legend">
      <span className="capmap-legend-item">
        <span className="capmap-legend-swatch dashed" />
        demand
      </span>
      <span className="capmap-legend-item">
        <span className="capmap-legend-swatch solid" />
        gap
      </span>
      <span className="capmap-legend-divider" />
      <span className="capmap-legend-item">
        <span className="capmap-legend-grad" />
        <span className="capmap-legend-grad-labels">
          <span>low</span>
          <span>severity</span>
          <span>high</span>
        </span>
      </span>
    </div>
  );
}

function AnonymizedToggle({
  value,
  onChange,
}: {
  value: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={value}
      className={`anon-toggle ${value ? "on" : ""}`}
      onClick={() => onChange(!value)}
      title={
        value
          ? "Showing aggregated team metrics. Toggle off to see individuals."
          : "Showing per-engineer metrics. Toggle on for anonymized team view."
      }
    >
      <span className="anon-toggle-label">Anonymized · team view</span>
      <span className="anon-toggle-switch" aria-hidden="true">
        <span className="anon-toggle-thumb" />
      </span>
    </button>
  );
}
