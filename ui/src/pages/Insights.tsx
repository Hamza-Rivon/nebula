import { useCallback, useEffect, useMemo, useState } from "react";
import type { Cluster, Dataset } from "../insights/types";
import { insightsApi } from "../insights/api";
import { makeMock } from "../insights/mock";
import { formatDateRange } from "../insights/format";
import { PulseStrip } from "../components/insights/PulseStrip";
import { MoneyFlow, SpendWinScatter } from "../components/insights/MoneyFlow";
import { PeopleTable } from "../components/insights/PeopleTable";
import { GapMap, GapMapCaption } from "../components/insights/GapMap";
import { Drawer } from "../components/insights/Drawer";
import { UserDrawer } from "../components/insights/drawers/UserDrawer";
import { ClusterDrawer } from "../components/insights/drawers/ClusterDrawer";
import { WasteDrawer } from "../components/insights/drawers/WasteDrawer";
import { wasteTypeLabel } from "../insights/format";

type DrawerState =
  | { kind: "user"; userId: string }
  | { kind: "cluster"; clusterId: string }
  | { kind: "waste"; wasteType: string }
  | null;

export function InsightsPage() {
  const [data, setData] = useState<Dataset | null>(null);
  const [usingMock, setUsingMock] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<DrawerState>(null);

  // Load /api/insights; on 404, fall back to mock so the demo always renders.
  useEffect(() => {
    let alive = true;
    insightsApi
      .getDataset()
      .then((d) => {
        if (!alive) return;
        if (!d) {
          setData(makeMock());
          setUsingMock(true);
        } else {
          setData(d);
          setUsingMock(false);
        }
      })
      .catch((e) => {
        console.warn("insights load failed", e);
        if (alive) {
          setData(makeMock());
          setUsingMock(true);
        }
      });
    return () => {
      alive = false;
    };
  }, []);

  // Pick a default selected user (top by wizardScore) once data lands.
  useEffect(() => {
    if (!data || selectedUserId) return;
    const top = [...data.users].sort((a, b) => b.wizardScore - a.wizardScore)[0];
    if (top) setSelectedUserId(top.id);
  }, [data, selectedUserId]);

  const closeDrawer = useCallback(() => setDrawer(null), []);
  const openUser = useCallback((userId: string) => {
    setDrawer({ kind: "user", userId });
  }, []);
  const openCluster = useCallback((c: Cluster) => {
    setDrawer({ kind: "cluster", clusterId: c.id });
  }, []);
  const openWaste = useCallback((wasteType: string) => {
    setDrawer({ kind: "waste", wasteType });
  }, []);

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
    return (
      <div className="nb-card p-5">Loading capability intel…</div>
    );
  }

  const a = data.aggregates;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="page-eyebrow">Capability intel · CTO brief</div>
          <h1 className="page-title">Insights overview</h1>
          <p className="page-subtitle">
            Three answers from the org's session log: who extracts value, where
            spend is leaking, and what no one has figured out yet.
            {usingMock && (
              <span className="ml-2 nb-chip" style={{ background: "var(--color-butter)" }}>
                using mock — POST /api/analyze to populate
              </span>
            )}
          </p>
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
              {data.clusters.length} clusters · hover for detail · click to inspect
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
