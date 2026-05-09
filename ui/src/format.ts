export const fmt = {
  cost: (n: number | null | undefined) =>
    n == null ? "—" : `$${n < 0.01 ? n.toFixed(5) : n.toFixed(4)}`,
  num: (n: number | null | undefined) =>
    n == null ? "—" : new Intl.NumberFormat().format(n),
  ms: (n: number | null | undefined) => (n == null ? "—" : `${n}ms`),
  date: (ts: number) => new Date(ts).toLocaleString(),
  rel: (ts: number) => {
    const s = Math.round((Date.now() - ts) / 1000);
    if (s < 60) return `${s}s ago`;
    if (s < 3600) return `${Math.round(s / 60)}m ago`;
    if (s < 86400) return `${Math.round(s / 3600)}h ago`;
    return `${Math.round(s / 86400)}d ago`;
  },
};
