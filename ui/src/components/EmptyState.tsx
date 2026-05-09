type Props = {
  title: string;
  hint?: string;
  curl?: string;
  illustration?: "chart" | "tools" | "users" | "search" | "session";
};

export function EmptyState({
  title,
  hint = "Send a request to start collecting data.",
  curl,
  illustration = "chart",
}: Props) {
  return (
    <div className="grid items-center gap-6 py-6 md:grid-cols-2">
      <div className="grid place-items-center">
        <Illustration kind={illustration} />
      </div>
      <div>
        <h4 className="font-display text-xl font-bold">{title}</h4>
        <p className="mt-1 text-sm opacity-70">{hint}</p>
        {curl && (
          <div
            className="nb-card-flat mt-4 p-3"
            style={{ background: "var(--color-butter)", transform: "rotate(-1.2deg)" }}
          >
            <div className="mb-1 text-[10px] font-bold uppercase tracking-widest opacity-70">
              try this
            </div>
            <pre className="scrollbar-soft overflow-auto rounded bg-white p-2 font-mono text-[11px] leading-snug">
              {curl}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}

function Illustration({ kind }: { kind: NonNullable<Props["illustration"]> }) {
  const stroke = "var(--color-ink)";
  const sw = 3;
  // each illustration: chunky outlined shapes, palette fills.
  if (kind === "tools") {
    return (
      <svg viewBox="0 0 200 160" width="220" height="170">
        <rect x="10" y="40" width="80" height="80" fill="var(--color-rose)" stroke={stroke} strokeWidth={sw} rx="8" />
        <rect x="100" y="20" width="80" height="60" fill="var(--color-butter)" stroke={stroke} strokeWidth={sw} rx="8" />
        <rect x="100" y="90" width="80" height="50" fill="var(--color-mint)" stroke={stroke} strokeWidth={sw} rx="8" />
        <circle cx="50" cy="80" r="14" fill="#fff" stroke={stroke} strokeWidth={sw} />
        <path d="M44 80 L48 84 L58 74" stroke={stroke} strokeWidth={sw} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (kind === "users") {
    return (
      <svg viewBox="0 0 200 160" width="220" height="170">
        <circle cx="70" cy="60" r="22" fill="var(--color-lime)" stroke={stroke} strokeWidth={sw} />
        <path d="M30 130 q40 -40 80 0" fill="var(--color-lime)" stroke={stroke} strokeWidth={sw} strokeLinejoin="round" />
        <circle cx="140" cy="70" r="16" fill="var(--color-sky)" stroke={stroke} strokeWidth={sw} />
        <path d="M115 130 q25 -28 50 0" fill="var(--color-sky)" stroke={stroke} strokeWidth={sw} strokeLinejoin="round" />
      </svg>
    );
  }
  if (kind === "search") {
    return (
      <svg viewBox="0 0 200 160" width="220" height="170">
        <circle cx="80" cy="70" r="38" fill="var(--color-lavender)" stroke={stroke} strokeWidth={sw} />
        <line x1="108" y1="98" x2="160" y2="140" stroke={stroke} strokeWidth={sw + 2} strokeLinecap="round" />
        <circle cx="80" cy="70" r="14" fill="#fff" stroke={stroke} strokeWidth={sw} />
      </svg>
    );
  }
  if (kind === "session") {
    return (
      <svg viewBox="0 0 200 160" width="220" height="170">
        <rect x="20" y="30" width="120" height="36" fill="var(--color-sky)" stroke={stroke} strokeWidth={sw} rx="8" />
        <rect x="60" y="80" width="120" height="36" fill="var(--color-mint)" stroke={stroke} strokeWidth={sw} rx="8" />
        <rect x="20" y="120" width="80" height="20" fill="var(--color-peach)" stroke={stroke} strokeWidth={sw} rx="8" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 200 160" width="220" height="170">
      <rect x="20" y="80" width="22" height="60" fill="var(--color-mint)" stroke={stroke} strokeWidth={sw} />
      <rect x="55" y="50" width="22" height="90" fill="var(--color-butter)" stroke={stroke} strokeWidth={sw} />
      <rect x="90" y="30" width="22" height="110" fill="var(--color-peach)" stroke={stroke} strokeWidth={sw} />
      <rect x="125" y="65" width="22" height="75" fill="var(--color-lavender)" stroke={stroke} strokeWidth={sw} />
      <rect x="160" y="95" width="22" height="45" fill="var(--color-rose)" stroke={stroke} strokeWidth={sw} />
      <line x1="10" y1="140" x2="190" y2="140" stroke={stroke} strokeWidth={sw} />
    </svg>
  );
}
