import { useCallback, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Cluster, Dataset, SessionMeta } from "./types";
import { insightsDatasetQuery } from "../queries";

export type DrawerState =
  | { kind: "user"; userId: string }
  | { kind: "team"; teamId: string }
  | { kind: "cluster"; clusterId: string }
  | { kind: "waste"; wasteType: string }
  | null;

export interface InsightsHandle {
  data: Dataset | null;
  anonymized: boolean;
  setAnonymized: (next: boolean) => void;
  drawer: DrawerState;
  openUser: (userId: string) => void;
  openTeam: (teamId: string) => void;
  openCluster: (c: Cluster) => void;
  openWaste: (wasteType: string) => void;
  // Routes a session to the engineer-grade detail page.
  openSession: (s: SessionMeta) => void;
  closeDrawer: () => void;
}

// Single source of truth. Each template renders its own UI but shares data
// fetching + drawer state via this hook.
export function useInsightsData(): InsightsHandle {
  const query = useQuery(insightsDatasetQuery());
  const [drawer, setDrawer] = useState<DrawerState>(null);
  const [anonymized, setAnonymized] = useState(false);

  const data: Dataset | null = query.data ?? null;

  const closeDrawer = useCallback(() => setDrawer(null), []);
  const openUser = useCallback((userId: string) => {
    setDrawer({ kind: "user", userId });
  }, []);
  const openTeam = useCallback((teamId: string) => {
    setDrawer({ kind: "team", teamId });
  }, []);
  const openCluster = useCallback((c: Cluster) => {
    setDrawer({ kind: "cluster", clusterId: c.id });
  }, []);
  const openWaste = useCallback((wasteType: string) => {
    setDrawer({ kind: "waste", wasteType });
  }, []);
  const openSession = useCallback((s: SessionMeta) => {
    window.location.assign(`/sessions/${encodeURIComponent(s.sessionId)}`);
  }, []);

  const setAnonymizedAndCloseDrawer = useCallback((next: boolean) => {
    setAnonymized(next);
    setDrawer(null);
  }, []);

  return useMemo(
    () => ({
      data,
      anonymized,
      setAnonymized: setAnonymizedAndCloseDrawer,
      drawer,
      openUser,
      openTeam,
      openCluster,
      openWaste,
      openSession,
      closeDrawer,
    }),
    [
      data,
      anonymized,
      setAnonymizedAndCloseDrawer,
      drawer,
      openUser,
      openTeam,
      openCluster,
      openWaste,
      openSession,
      closeDrawer,
    ],
  );
}
