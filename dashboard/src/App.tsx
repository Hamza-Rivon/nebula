import { useCallback, useEffect, useMemo, useState } from "react";
import type { Cluster, Dataset, SessionMeta } from "./types";
import Sidebar, { type Page } from "./components/Sidebar";
import InsightsPage from "./pages/InsightsPage";
import SessionsPage from "./pages/SessionsPage";
import LabPage from "./pages/LabPage";
import Drawer from "./components/Drawer";
import UserDrawer from "./components/drawers/UserDrawer";
import ClusterDrawer from "./components/drawers/ClusterDrawer";
import WasteDrawer from "./components/drawers/WasteDrawer";
import SessionDrawer from "./components/drawers/SessionDrawer";
import TranscriptViewer from "./components/TranscriptViewer";
import { wasteTypeLabel } from "./format";
import { mockDataset } from "./mockData";

type DrawerState =
  | { kind: "user"; userId: string }
  | { kind: "cluster"; clusterId: string }
  | { kind: "waste"; wasteType: string }
  | { kind: "session"; sessionId: string }
  | null;

export default function App() {
  const [data, setData] = useState<Dataset | null>(null);
  const [page, setPage] = useState<Page>("insights");
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<DrawerState>(null);
  const [transcriptId, setTranscriptId] = useState<string | null>(null);

  useEffect(() => {
    const apply = (d: Dataset) => {
      setData(d);
      const top = [...d.users].sort((a, b) => b.wizardScore - a.wizardScore)[0];
      if (top) setSelectedUserId(top.id);
    };
    fetch("/sessions.json")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d: Dataset) => apply(d))
      .catch(() => {
        console.warn("/sessions.json not found — using mock data");
        apply(mockDataset);
      });
  }, []);

  const closeDrawer = useCallback(() => setDrawer(null), []);
  const openUser = useCallback(
    (userId: string) => setDrawer({ kind: "user", userId }),
    [],
  );
  const openCluster = useCallback(
    (c: Cluster) => setDrawer({ kind: "cluster", clusterId: c.id }),
    [],
  );
  const openWaste = useCallback(
    (wasteType: string) => setDrawer({ kind: "waste", wasteType }),
    [],
  );
  const openSession = useCallback(
    (s: SessionMeta) => setDrawer({ kind: "session", sessionId: s.sessionId }),
    [],
  );
  const openTranscript = useCallback(
    (s: SessionMeta) => setTranscriptId(s.sessionId),
    [],
  );
  const closeTranscript = useCallback(() => setTranscriptId(null), []);

  const drawerProps = useMemo(() => {
    if (!data || !drawer) return null;

    if (drawer.kind === "user") {
      const user = data.users.find((u) => u.id === drawer.userId);
      if (!user) return null;
      return {
        eyebrow: "Consultant profile",
        title: user.displayName,
        subtitle: `${user.team} · ${user.sessionCount} sessions`,
        body: <UserDrawer user={user} data={data} onOpenSession={openSession} />,
      };
    }

    if (drawer.kind === "cluster") {
      const c = data.clusters.find((c) => c.id === drawer.clusterId);
      if (!c) return null;
      return {
        eyebrow: c.type === "ask" ? "Demand cluster" : "Capability gap",
        title: c.label,
        subtitle: `${c.domain} · ${c.sessionCount} sessions · ${c.userCount} consultants`,
        body: (
          <ClusterDrawer
            cluster={c}
            data={data}
            onOpenSession={openSession}
            onOpenUser={openUser}
          />
        ),
      };
    }

    if (drawer.kind === "waste") {
      return {
        eyebrow: "Waste category",
        title: wasteTypeLabel(drawer.wasteType),
        subtitle: "Detected pattern across the firm",
        body: (
          <WasteDrawer
            wasteType={drawer.wasteType}
            data={data}
            onOpenSession={openSession}
          />
        ),
      };
    }

    if (drawer.kind === "session") {
      const s = data.sessions.find((x) => x.sessionId === drawer.sessionId);
      if (!s) return null;
      return {
        eyebrow: "Session",
        title: s.projectName,
        subtitle: s.goal,
        body: (
          <SessionDrawer
            session={s}
            data={data}
            onOpenUser={openUser}
            onOpenCluster={openCluster}
            onOpenTranscript={openTranscript}
          />
        ),
      };
    }

    return null;
  }, [data, drawer, openCluster, openSession, openTranscript, openUser]);

  const transcriptSession = useMemo(() => {
    if (!data || !transcriptId) return null;
    return data.sessions.find((s) => s.sessionId === transcriptId) ?? null;
  }, [data, transcriptId]);

  if (!data) {
    return (
      <div className="app">
        <div className="loading">Loading capability intel…</div>
      </div>
    );
  }

  return (
    <div className="app">
      <Sidebar data={data} page={page} onNavigate={setPage} />
      <main className="main">
        {page === "insights" && (
          <InsightsPage
            data={data}
            selectedUserId={selectedUserId}
            onSelectUser={setSelectedUserId}
            onOpenUser={openUser}
            onOpenWaste={openWaste}
            onOpenSession={openSession}
            onSelectCluster={openCluster}
          />
        )}
        {page === "sessions" && (
          <SessionsPage data={data} onOpenSession={openSession} />
        )}
        {page === "lab" && <LabPage data={data} />}
      </main>

      <Drawer
        open={drawer !== null && drawerProps !== null}
        onClose={closeDrawer}
        eyebrow={drawerProps?.eyebrow}
        title={drawerProps?.title}
        subtitle={drawerProps?.subtitle}
      >
        {drawerProps?.body}
      </Drawer>

      {transcriptSession && (
        <TranscriptViewer
          session={transcriptSession}
          open={transcriptId !== null}
          onClose={closeTranscript}
        />
      )}
    </div>
  );
}
