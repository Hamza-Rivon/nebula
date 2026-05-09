import type { Cluster, Dataset, SessionMeta } from "../types";
import PulseStrip from "../components/PulseStrip";
import MoneyFlow, { SpendWinScatter } from "../components/MoneyFlow";
import PeopleTable from "../components/PeopleTable";
import GapMap, { GapMapCaption } from "../components/GapMap";
import { formatDateRange } from "../format";

interface Props {
  data: Dataset;
  selectedUserId: string | null;
  onSelectUser: (id: string) => void;
  onOpenUser: (id: string) => void;
  onOpenWaste: (type: string) => void;
  onOpenSession: (s: SessionMeta) => void;
  onSelectCluster: (c: Cluster) => void;
}

export default function InsightsPage({
  data,
  selectedUserId,
  onSelectUser,
  onOpenUser,
  onOpenWaste,
  onSelectCluster,
}: Props) {
  const a = data.aggregates;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="page-eyebrow">Capability intel · partner brief</div>
          <h1 className="page-title">Insights overview</h1>
          <p className="page-subtitle">
            Three answers from the firm's session log: who extracts value, where
            spend is leaking, and what no one has figured out yet.
          </p>
        </div>
        <div className="daterange">
          <span className="daterange-dot" />
          <span>{formatDateRange(a.dateRange.start, a.dateRange.end)}</span>
        </div>
      </div>

      <div className="page-body">
        <PulseStrip data={data} />

        <MoneyFlow
          data={data}
          onOpenWaste={onOpenWaste}
          onOpenUser={onOpenUser}
        />

        <section className="panel">
          <div className="panel-header">
            <div>
              <div className="panel-sub">Q2b — Spend vs. outcome</div>
              <h3 className="panel-title">Per-consultant view</h3>
            </div>
            <div className="panel-meta">click a dot to drill in</div>
          </div>
          <div className="panel-body">
            <SpendWinScatter data={data} onOpenUser={onOpenUser} />
          </div>
        </section>

        <PeopleTable
          data={data}
          selectedUserId={selectedUserId}
          onSelectUser={onSelectUser}
          onOpenUser={onOpenUser}
        />

        <section className="panel">
          <div className="panel-header">
            <div>
              <div className="panel-sub">Q3 — What the firm isn't learning</div>
              <h3 className="panel-title">Capability gap map</h3>
            </div>
            <div className="panel-meta">
              {data.clusters.length} clusters · hover for detail · click to inspect
            </div>
          </div>
          <div className="panel-gapmap">
            <GapMap data={data} onSelect={onSelectCluster} />
          </div>
          <GapMapCaption data={data} />
        </section>
      </div>
    </div>
  );
}
