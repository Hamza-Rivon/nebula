// Number, date, and string formatting helpers used throughout the dashboard.
// Tabular numbers are achieved via CSS font-feature-settings; these helpers
// just produce the strings.

export function formatUsd(n: number, opts: { decimals?: number } = {}): string {
  const decimals = opts.decimals ?? (n >= 100 ? 0 : n >= 10 ? 1 : 2);
  const sign = n < 0 ? "-" : "";
  const v = Math.abs(n);
  return `${sign}$${v.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
}

export function formatInt(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })} · ${d
    .toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: false })}`;
}

export function formatDateRange(start: string, end: string): string {
  const a = new Date(start);
  const b = new Date(end);
  const sameMonth = a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear();
  if (sameMonth) {
    return `${a.toLocaleDateString("en-US", { month: "short" })} ${a.getDate()}–${b.getDate()}, ${b.getFullYear()}`;
  }
  return `${formatDate(start)} – ${formatDate(end)}, ${b.getFullYear()}`;
}

export function daysBetween(start: string, end: string): number {
  const a = new Date(start).getTime();
  const b = new Date(end).getTime();
  return Math.max(1, (b - a) / 86_400_000);
}

export function titleCase(s: string): string {
  return s
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// Truncate with single-character ellipsis (no triple-dot dingbat for cleanliness).
export function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1).trimEnd() + "…";
}

// Make a redacted/cleaned-up version of a user prompt for display.
export function redactPrompt(s: string, max = 240): string {
  // strip code blocks and excessive whitespace; truncate.
  const stripped = s
    .replace(/```[\s\S]*?```/g, "[code block]")
    .replace(/\s+/g, " ")
    .trim();
  return truncate(stripped, max);
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
