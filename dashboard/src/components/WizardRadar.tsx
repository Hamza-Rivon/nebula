import type { SessionMeta, User } from "../types";
import { deriveRadar } from "../derive";

interface Props {
  user: User;
  sessions: SessionMeta[];
  size?: number;
}

const AXIS_LABELS = [
  "Throughput",
  "First-shot",
  "Cache hit",
  "Edit precision",
  "Model IQ",
] as const;

export default function WizardRadar({ user, sessions, size = 220 }: Props) {
  const r = deriveRadar(user, sessions);
  const values = [
    r.throughput,
    r.firstShot,
    r.cacheHit,
    r.editEfficiency,
    r.modelIQ,
  ];

  const cx = size / 2;
  const cy = size / 2;
  const radius = (size / 2) * 0.72;

  const n = values.length;
  const angle = (i: number) => -Math.PI / 2 + (i * Math.PI * 2) / n;

  const point = (i: number, mag: number) => {
    const a = angle(i);
    return [cx + Math.cos(a) * radius * mag, cy + Math.sin(a) * radius * mag] as const;
  };

  const valuePoints = values.map((v, i) => point(i, v));
  const path =
    valuePoints.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ") +
    " Z";

  const rings = [0.25, 0.5, 0.75, 1.0];

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      style={{ display: "block" }}
    >
      <defs>
        <radialGradient id="radarFill" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#2563EB" stopOpacity="0.32" />
          <stop offset="100%" stopColor="#2563EB" stopOpacity="0.04" />
        </radialGradient>
      </defs>

      {/* concentric rings as polygons (pentagonal grid) */}
      {rings.map((r, idx) => {
        const ringPts = Array.from({ length: n }, (_, i) => point(i, r));
        const d =
          ringPts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ") + " Z";
        return (
          <path
            key={idx}
            d={d}
            stroke="#e4e7ed"
            strokeWidth={1}
            fill="none"
          />
        );
      })}

      {/* axes */}
      {Array.from({ length: n }).map((_, i) => {
        const [x, y] = point(i, 1);
        return (
          <line
            key={i}
            x1={cx}
            y1={cy}
            x2={x}
            y2={y}
            stroke="#e4e7ed"
            strokeWidth={1}
          />
        );
      })}

      {/* value polygon */}
      <path d={path} fill="url(#radarFill)" stroke="#2563EB" strokeWidth={1.4} />

      {/* vertices */}
      {valuePoints.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={2.6} fill="#2563EB" />
      ))}

      {/* labels */}
      {AXIS_LABELS.map((label, i) => {
        const [x, y] = point(i, 1.18);
        const v = values[i].toFixed(2);
        const a = angle(i);
        const align: "start" | "middle" | "end" =
          Math.cos(a) > 0.2 ? "start" : Math.cos(a) < -0.2 ? "end" : "middle";
        return (
          <g key={label}>
            <text
              x={x}
              y={y}
              fill="#969aa3"
              fontSize="10"
              fontFamily="Geist, sans-serif"
              textAnchor={align}
              dominantBaseline="middle"
              style={{
                letterSpacing: "0.06em",
                textTransform: "uppercase",
              }}
            >
              {label}
            </text>
            <text
              x={x}
              y={y + 12}
              fill="#14171d"
              fontSize="11"
              fontFamily='"Geist Mono", monospace'
              textAnchor={align}
              dominantBaseline="middle"
              style={{ fontFeatureSettings: '"tnum"', fontWeight: 500 }}
            >
              {v}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
