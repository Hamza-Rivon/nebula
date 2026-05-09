export function formatUsd(n: number, opts: { decimals?: number } = {}): string {
  const decimals = opts.decimals ?? (n >= 100 ? 0 : n >= 10 ? 1 : 2);
  const sign = n < 0 ? "-" : "";
  const v = Math.abs(n);
  return `${sign}$${v.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function formatDateRange(start: string, end: string): string {
  const a = new Date(start);
  const b = new Date(end);
  const sameMonth =
    a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear();
  if (sameMonth) {
    return `${a.toLocaleDateString("en-US", { month: "short" })} ${a.getDate()}–${b.getDate()}, ${b.getFullYear()}`;
  }
  return `${formatDate(start)} – ${formatDate(end)}, ${b.getFullYear()}`;
}

export function titleCase(s: string): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1).trimEnd() + "…";
}

export function wasteTypeLabel(t: string): string {
  switch (t) {
    case "wrong_model":
      return "Wrong model";
    case "retry_loop":
      return "Retry loops";
    case "abandoned":
      return "Abandoned sessions";
    case "context_bloat":
      return "Context bloat";
    case "redundant_prompt":
      return "Redundant prompts";
    default:
      return titleCase(t);
  }
}
