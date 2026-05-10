import { useMemo } from "react";
import { formatDateRange, wasteTypeLabel } from "../../insights/format";
import { PulseStrip } from "../../components/insights/PulseStrip";
import { MoneyFlow, SpendWinScatter } from "../../components/insights/MoneyFlow";
import { PeopleTable } from "../../components/insights/PeopleTable";
import { GapMap, GapMapCaption } from "../../components/insights/GapMap";
import { Drawer } from "../../components/insights/Drawer";
import { UserDrawer } from "../../components/insights/drawers/UserDrawer";
import { ClusterDrawer } from "../../components/insights/drawers/ClusterDrawer";
import { WasteDrawer } from "../../components/insights/drawers/WasteDrawer";
import type { InsightsHandle } from "../../insights/useInsightsData";

// T1 — Soft-Pop neobrutalist (the original). Cream + bold ink + hard shadows.
export function T1Insights({ handle }: { handle: InsightsHandle }) {
  const {
    data,
    selectedUserId,
    setSelectedUserId,
    drawer,
    openUser,
    openCluster,
    openWaste,
    closeDrawer,
  } = handle;

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
    if (drawer.kind === "cluster") {
      const c = data.clusters.find((c) => c.id === drawer.clusterId);
      if (!c) return null;
      return {
        eyebrow: c.type === "ask" ? "Demand cluster" : "Capability gap",
        title: c.label,
        subtitle: `${c.domain} · ${c.sessionCount} sessions · ${c.userCount} engineers`,
        body: <ClusterDrawer cluster={c} data={data} />,
      };
    }
    if (drawer.kind === "waste") {
      return {
        eyebrow: "Waste category",
        title: wasteTypeLabel(drawer.wasteType),
        subtitle: "Detected pattern across the org",
        body: <WasteDrawer wasteType={drawer.wasteType} data={data} />,
      };
    }
    return null;
  }, [data, drawer]);

  if (!data) {
    return <div className="nb-card p-5">Loading capability intel…</div>;
  }
  const a = data.aggregates;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="page-eyebrow">Capability intel · CTO brief</div>
          <h1 className="page-title">Insights overview</h1>

        </div>
        <div className="daterange">
          <span className="daterange-dot" />
          <span>{formatDateRange(a.dateRange.start, a.dateRange.end)}</span>
        </div>
      </div>

      <div className="page-body">
        <PulseStrip data={data} />
        <MoneyFlow data={data} onOpenWaste={openWaste} onOpenUser={openUser} />
        <section className="panel">
          <div className="panel-header">
            <div>
              <div className="panel-sub">Q2b — Spend vs. outcome</div>
              <h3 className="panel-title">Per-engineer view</h3>
            </div>
            <div className="panel-meta">click a dot to drill in</div>
          </div>
          <div className="panel-body">
            <SpendWinScatter data={data} onOpenUser={openUser} />
          </div>
        </section>
        <PeopleTable
          data={data}
          selectedUserId={selectedUserId}
          onSelectUser={setSelectedUserId}
          onOpenUser={openUser}
        />
        <section className="panel">
          <div className="panel-header">
            <div>
              <div className="panel-sub">Q3 — What the org isn't learning</div>
              <h3 className="panel-title">Capability gap map</h3>
            </div>
            <div className="panel-meta">
              {data.clusters.length} clusters · hover for detail · click to
              inspect
            </div>
          </div>
          <div className="panel-gapmap">
            <GapMap data={data} onSelect={openCluster} />
          </div>
          <GapMapCaption data={data} />
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
