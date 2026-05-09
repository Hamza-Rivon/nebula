import { Link } from "react-router-dom";
import type { Dataset } from "../../../insights/types";
import { formatUsd, truncate, wasteTypeLabel } from "../../../insights/format";
import { topWasteSessions } from "../../../insights/derive";

interface Props {
  wasteType: string;
  data: Dataset;
}

export function WasteDrawer({ wasteType, data }: Props) {
  const meta = data.aggregates.wasteByType[wasteType] ?? {
    tokens: 0,
    usd: 0,
    sessions: 0,
  };
  const sessions = topWasteSessions(
    data,
    (s) => s.wasteFlags.some((f) => f.type === wasteType),
    8,
  );
  const usersById = new Map(data.users.map((u) => [u.id, u] as const));

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-3 gap-2">
        <Stat label="USD wasted" value={formatUsd(meta.usd, { decimals: 0 })} tone="warn" />
        <Stat label="Sessions" value={String(meta.sessions)} />
        <Stat label="Tokens" value={String(meta.tokens.toLocaleString())} />
      </div>

      <div>
        <div className="mb-2 text-sm opacity-70">
          Pattern: <strong>{wasteTypeLabel(wasteType)}</strong>. Top burning
          sessions:
        </div>
        <ul className="space-y-2">
          {sessions.map((s) => {
            const u = usersById.get(s.userId);
            return (
              <li key={s.sessionId} className="nb-card-flat p-2">
                <Link
                  to={`/sessions/${encodeURIComponent(s.sessionId)}`}
                  className="flex items-start gap-3"
                >
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold truncate">
                      {truncate(s.goal || s.projectName, 60)}
                    </div>
                    <div className="text-xs opacity-70">
                      {u?.displayName ?? "—"} ·{" "}
                      <span className="mono">{s.outcome}</span>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="mono text-sm warm">
                      {formatUsd(s.wasteUsd, { decimals: 1 })}
                    </div>
                    <div className="mono text-[11px] opacity-60">
                      of {formatUsd(s.costUsd, { decimals: 1 })}
                    </div>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "warn";
}) {
  return (
    <div className="nb-card-flat p-2">
      <div className="text-[10px] font-bold uppercase tracking-widest opacity-60">
        {label}
      </div>
      <div className={`text-xl font-bold tabular-nums ${tone === "warn" ? "warm" : ""}`}>
        {value}
      </div>
    </div>
  );
}
