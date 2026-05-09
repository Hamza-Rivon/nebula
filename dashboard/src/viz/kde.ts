// Minimal kernel density helpers (d3-style, no extra dep).

export function kernelDensityEstimator(
  kernel: (v: number) => number,
  X: number[],
) {
  return function (V: number[]): [number, number][] {
    return X.map((x) => [x, sum(V.map((v) => kernel(x - v))) / Math.max(1, V.length)]);
  };
}

export function kernelEpanechnikov(k: number) {
  return function (v: number): number {
    const u = v / k;
    return Math.abs(u) <= 1 ? (0.75 * (1 - u * u)) / k : 0;
  };
}

function sum(xs: number[]): number {
  let s = 0;
  for (const x of xs) s += x;
  return s;
}
