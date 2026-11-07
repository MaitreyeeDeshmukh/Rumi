/** The Rumi face drawn in the same ink style as the illustrations. Decorative. Eyes follow the pointer (HomeMotion). */
export function RumiSketch({ size = 120, className = "" }: { size?: number; className?: string }) {
  return (
    <svg className={`ld-rumi ${className}`} width={size} height={size} viewBox="0 0 120 120" aria-hidden="true" focusable="false">
      <g className="ld-rumi-body">
        <path
          d="M61 10c23 0 46 15 47 41 1 28-18 55-48 56-30 1-50-22-48-50 2-27 26-47 49-47Z"
          fill="var(--rumi-fill)"
          stroke="var(--art-ink)"
          strokeWidth="3.4"
          strokeLinejoin="round"
        />
        <path d="M30 34c6-8 14-12 22-14" stroke="#FFFFFF" strokeWidth="4" strokeLinecap="round" fill="none" opacity=".7" />
        <ellipse cx="36" cy="73" rx="7" ry="4" fill="#F4A3B4" opacity=".7" />
        <ellipse cx="86" cy="73" rx="7" ry="4" fill="#F4A3B4" opacity=".7" />
        <g className="ld-eyes">
          <rect className="ld-eye" x="44" y="52" width="7" height="11" rx="3.5" fill="var(--art-ink)" />
          <rect className="ld-eye" x="69" y="52" width="7" height="11" rx="3.5" fill="var(--art-ink)" />
        </g>
        <path d="M52 74c4 5 12 5 16 0" stroke="var(--art-ink)" strokeWidth="3.2" strokeLinecap="round" fill="none" />
      </g>
    </svg>
  );
}
