import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Cluster, Dataset, SessionMeta } from "./types";
import { insightsDatasetQuery } from "../queries";

export type DrawerState =
  | { kind: "user"; userId: string }
  | { kind: "cluster"; clusterId: string }
  | { kind: "waste"; wasteType: string }
  | null;

export interface InsightsHandle {
  data: Dataset | null;
  selectedUserId: string | null;
  setSelectedUserId: (id: string | null) => void;
  drawer: DrawerState;
  openUser: (userId: string) => void;
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
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<DrawerState>(null);

  const data: Dataset | null = query.data ?? null;

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
  const openSession = useCallback((s: SessionMeta) => {
    window.location.assign(`/sessions/${encodeURIComponent(s.sessionId)}`);
  }, []);

  return useMemo(
    () => ({
      data,
      selectedUserId,
      setSelectedUserId,
      drawer,
      openUser,
      openCluster,
      openWaste,
      openSession,
      closeDrawer,
    }),
    [
      data,
      selectedUserId,
      drawer,
      openUser,
      openCluster,
      openWaste,
      openSession,
      closeDrawer,
    ],
  );
}
