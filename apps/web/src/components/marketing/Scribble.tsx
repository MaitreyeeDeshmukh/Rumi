import type { CSSProperties } from "react";

/** Hand-drawn strokes that draw in once (see .ld-draw in the home page CSS). Always decorative. */
type Kind = "circle" | "arrow-down" | "sparkle" | "wave" | "path" | "ground";

const SHAPES: Record<Kind, { vb: string; d: string[] }> = {
  circle: { vb: "0 0 300 110", d: ["M168 10C92 2 14 22 8 56c-6 36 70 50 146 48 76-2 140-22 138-54C290 18 214 4 132 12"] },
  "arrow-down": { vb: "0 0 60 70", d: ["M8 6c18 6 30 22 32 52", "M28 46c4 6 8 10 12 14 4-6 8-12 14-16"] },
  sparkle: {
    vb: "0 0 40 40",
    d: ["M20 4c1 8 2 12 4 15 3 2 7 2 12 2-5 1-9 2-12 4-2 3-3 7-4 12-1-5-2-9-4-12-3-2-7-3-12-4 5 0 9 0 12-2 2-3 3-7 4-15Z"],
  },
  wave: { vb: "0 0 1200 40", d: ["M0 24C80 8 140 34 220 20s150-16 230 2 160 14 240-2 160-18 240 0 160 16 270-4"] },
  path: { vb: "0 0 1000 120", d: ["M40 70C140 10 230 110 330 64s160-58 260-14 170 64 270 8 90-30 120-20"] },
  ground: { vb: "0 0 1200 30", d: ["M10 16c120-6 260 6 400 0s300-8 420 2 240 4 360-4"] },
};

export function Scribble({ kind, className = "" }: { kind: Kind; className?: string }) {
  const s = SHAPES[kind];
  return (
    <svg
      className={`ld-scribble ld-scribble-${kind} ${className}`}
      viewBox={s.vb}
      aria-hidden="true"
      focusable="false"
      preserveAspectRatio="none"
    >
      {s.d.map((d, n) => (
        <path key={n} className="ld-draw" d={d} pathLength={1} style={{ "--d": n } as CSSProperties} />
      ))}
    </svg>
  );
}
