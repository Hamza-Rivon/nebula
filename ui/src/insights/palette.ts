// Single palette for SVG-driven components. CSS handles all chrome; this is
// the minimum the SVG renderers need (axis text, gridlines, sankey nodes,
// scatter dots, GapMap interpolation endpoints).
export interface Palette {
  axisText: string;
  gridLine: string;
  axisLine: string;
  total: string;
  productive: string;
  wasted: string;
  productiveSoft: string;
  wastedSoft: string;
  link: { productive: string; wasted: string };
  gapmapLow: string;
  gapmapHigh: string;
  persona: {
    power: string;
    active: string;
    stuck: string;
    misuser: string;
    lurker: string;
  };
  outline: string;
}

// Soft-pop neobrutalist — cream/ink with a green/red split.
export const PALETTE: Palette = {
  axisText: "#111111",
  gridLine: "rgba(17, 17, 17, 0.08)",
  axisLine: "#111111",
  total: "#111111",
  productive: "#1F7A3A",
  wasted: "#B23A1F",
  productiveSoft: "#B8F5C9",
  wastedSoft: "#FFB7A8",
  link: { productive: "#1F7A3A", wasted: "#B23A1F" },
  gapmapLow: "#2C68C8",
  gapmapHigh: "#B23A1F",
  persona: {
    power: "#1F7A3A",
    active: "#2C68C8",
    stuck: "#B47A12",
    misuser: "#B23A1F",
    lurker: "#888888",
  },
  outline: "#111111",
};
